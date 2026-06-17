'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSignIn, useSignUp } from '@clerk/nextjs/legacy';

/**
 * OAuth callback — both sign-in and sign-up paths come through here.
 *
 * Because OAuthButtons always uses `signUp.authenticateWithRedirect`,
 * Clerk's SDK auto-resolves three cases for us:
 *
 *   - New user → signUp.status === 'complete' (or 'missing_requirements'
 *     when the provider didn't return a required field like email — X
 *     does this).
 *   - Existing user → SDK auto-transfers to a signIn under the hood, so
 *     signIn.status === 'complete' on arrival.
 *
 * We just inspect whichever object got populated and finish the flow.
 * Navigations use window.location so the Next router doesn't refuse
 * to flush while a Clerk Promise is still pending.
 */
function SSOCallbackContent() {
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get('redirect_url') || '/';
  const { signIn, isLoaded: signInLoaded, setActive: setActiveSignIn } =
    useSignIn();
  const { signUp, isLoaded: signUpLoaded, setActive: setActiveSignUp } =
    useSignUp();
  const [error, setError] = useState<string | null>(null);

  // Refs so the effect can read the latest Clerk objects without
  // putting them in its deps and re-running mid-await. Writing the
  // ref in a layout effect rather than in render keeps the
  // react-hooks/refs lint rule quiet.
  const siRef = useRef(signIn);
  const suRef = useRef(signUp);
  const setSIRef = useRef(setActiveSignIn);
  const setSURef = useRef(setActiveSignUp);
  useEffect(() => {
    siRef.current = signIn;
    suRef.current = signUp;
    setSIRef.current = setActiveSignIn;
    setSURef.current = setActiveSignUp;
  });
  const ran = useRef(false);

  const hardNav = (url: string) => {
    if (typeof window !== 'undefined') window.location.assign(url);
  };

  useEffect(() => {
    if (!signInLoaded || !signUpLoaded) return;
    if (ran.current) return;
    ran.current = true;

    // Safety net — if every branch silently fails, dump the user at
    // /sign-up so the form can pick up whatever state we got.
    const stall = setTimeout(() => {
      console.warn('[sso-callback] 10s stall, hard-nav /sign-up');
      hardNav('/sign-up');
    }, 10000);

    (async () => {
      const si = siRef.current;
      const su = suRef.current;
      const setSI = setSIRef.current;
      const setSU = setSURef.current;

      console.log('[sso-callback] state', {
        signInStatus: si?.status,
        signUpStatus: su?.status,
        signUpMissingFields: su?.missingFields,
        signUpUnverifiedFields: su?.unverifiedFields,
      });

      try {
        // Existing user (SDK auto-transferred signUp → signIn).
        if (si?.status === 'complete' && si.createdSessionId && setSI) {
          await setSI({ session: si.createdSessionId });
          clearTimeout(stall);
          hardNav(redirectUrl);
          return;
        }

        // New user, signUp finished in one shot.
        if (su?.status === 'complete' && su.createdSessionId && setSU) {
          await setSU({ session: su.createdSessionId });
          clearTimeout(stall);
          hardNav(redirectUrl);
          return;
        }

        // New user, signUp needs more info (provider didn't return
        // email, etc.). /sign-up's form effect detects the in-progress
        // signUp and asks the user for what's missing.
        if (su?.status === 'missing_requirements') {
          clearTimeout(stall);
          hardNav('/sign-up');
          return;
        }

        // Unexpected: have a signUp in some other state — still safer
        // to hand off to /sign-up than to dead-end here.
        if (su) {
          clearTimeout(stall);
          hardNav('/sign-up');
          return;
        }

        clearTimeout(stall);
        setError(
          `Could not finish signing you in (signIn: ${si?.status ?? 'none'}, signUp: none). Try again or use email + password.`,
        );
      } catch (err) {
        clearTimeout(stall);
        console.error('[sso-callback] flow failed:', err);
        setError(
          extractClerkError(err) ??
            'Could not finish signing you in. Try again or use email + password.',
        );
      }
    })();

    return () => {
      clearTimeout(stall);
    };
  }, [signInLoaded, signUpLoaded, redirectUrl]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: 24,
        fontSize: '0.9rem',
        color: 'var(--text-dim)',
        textAlign: 'center',
      }}
    >
      {error ? (
        <>
          <div style={{ color: 'var(--text)', maxWidth: 420 }}>{error}</div>
          <div style={{ display: 'flex', gap: 12 }}>
            <a
              href="/sign-in"
              style={{
                color: 'var(--text)',
                textDecoration: 'underline',
                fontSize: '0.85rem',
              }}
            >
              Back to sign in
            </a>
            <a
              href="/sign-up"
              style={{
                color: 'var(--text)',
                textDecoration: 'underline',
                fontSize: '0.85rem',
              }}
            >
              Create an account
            </a>
          </div>
        </>
      ) : (
        <>Signing you in…</>
      )}
    </div>
  );
}

function extractClerkError(err: unknown): string | null {
  if (
    typeof err === 'object' &&
    err !== null &&
    'errors' in err &&
    Array.isArray((err as { errors: unknown }).errors)
  ) {
    const errs = (
      err as { errors: Array<{ longMessage?: string; message?: string }> }
    ).errors;
    return errs[0]?.longMessage || errs[0]?.message || null;
  }
  return null;
}

export default function SSOCallbackPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh' }} />}>
      <SSOCallbackContent />
    </Suspense>
  );
}
