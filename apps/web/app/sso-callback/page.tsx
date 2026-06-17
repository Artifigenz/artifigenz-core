'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useClerk } from '@clerk/nextjs';
import { useSignIn, useSignUp } from '@clerk/nextjs/legacy';

/**
 * OAuth callback. Handles every branch the default Clerk component
 * silently drops on the floor, with hard navigations (window.location)
 * so we never get stuck waiting for Next.js client routing to flush
 * mid-auth.
 */
function SSOCallbackContent() {
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get('redirect_url') || '/';
  const { handleRedirectCallback } = useClerk();
  const { signIn, isLoaded: signInLoaded, setActive: setActiveSignIn } =
    useSignIn();
  const { signUp, isLoaded: signUpLoaded, setActive: setActiveSignUp } =
    useSignUp();
  const [error, setError] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<string>('Signing you in…');
  const ran = useRef(false);

  // Hard navigation — Next.js `router.replace` was failing to flush
  // when called from inside an in-flight Clerk Promise; window.location
  // bypasses the router entirely so we always land where we intend to.
  const hardNav = (url: string) => {
    if (typeof window !== 'undefined') window.location.assign(url);
  };

  useEffect(() => {
    if (!signInLoaded || !signUpLoaded) return;
    if (ran.current) return;
    ran.current = true;

    let cancelled = false;

    // Safety net — if nothing has navigated within 10s, push the user
    // to /sign-up with the in-progress signUp so they're never left
    // staring at "Creating your account…" forever.
    const stallGuard = setTimeout(() => {
      if (cancelled) return;
      console.warn('[sso-callback] stalled, hard-navigating to /sign-up');
      hardNav('/sign-up');
    }, 10000);

    (async () => {
      try {
        setDiagnostic('Processing OAuth response…');
        await handleRedirectCallback({
          signInFallbackRedirectUrl: redirectUrl,
          signUpFallbackRedirectUrl: redirectUrl,
          continueSignUpUrl: '/sign-up',
          firstFactorUrl: '/sign-in',
          secondFactorUrl: '/sign-in',
        });
      } catch (err) {
        console.warn('[sso-callback] handleRedirectCallback threw:', err);
      }

      if (cancelled) return;
      console.log('[sso-callback] post-handle state', {
        signInStatus: signIn?.status,
        signInFirstFactor: signIn?.firstFactorVerification?.status,
        signUpStatus: signUp?.status,
        signUpMissingFields: signUp?.missingFields,
        signUpUnverifiedFields: signUp?.unverifiedFields,
        signUpExternalAccountStatus:
          signUp?.verifications?.externalAccount?.status,
      });

      // 1. Either flow already complete → activate and go home.
      try {
        if (signIn?.status === 'complete' && signIn.createdSessionId) {
          await setActiveSignIn({ session: signIn.createdSessionId });
          clearTimeout(stallGuard);
          hardNav(redirectUrl);
          return;
        }
        if (signUp?.status === 'complete' && signUp.createdSessionId) {
          await setActiveSignUp({ session: signUp.createdSessionId });
          clearTimeout(stallGuard);
          hardNav(redirectUrl);
          return;
        }
      } catch (err) {
        console.error('[sso-callback] setActive failed:', err);
      }

      // 2. SignUp present but waiting on more info — let /sign-up
      //    finish the form work.
      if (signUp?.status === 'missing_requirements') {
        clearTimeout(stallGuard);
        hardNav('/sign-up');
        return;
      }

      // 3. Transferable signIn (new user via /sign-in OAuth). Convert
      //    it to a signUp and re-decide on the resulting status.
      const transferable =
        signIn?.firstFactorVerification?.status === 'transferable';
      if (transferable && signUp) {
        try {
          setDiagnostic('Creating your account…');
          const created = await signUp.create({ transfer: true });
          if (cancelled) return;
          console.log('[sso-callback] transfer result', {
            status: created.status,
            missingFields: created.missingFields,
            unverifiedFields: created.unverifiedFields,
          });

          if (created.status === 'complete' && created.createdSessionId) {
            try {
              await setActiveSignUp({ session: created.createdSessionId });
            } catch (err) {
              console.error(
                '[sso-callback] setActive after transfer failed:',
                err,
              );
            }
            clearTimeout(stallGuard);
            hardNav(redirectUrl);
            return;
          }

          // Anything else after transfer (missing_requirements OR an
          // unrecognised status) → hand off to /sign-up which knows
          // how to finish the signUp it inherits.
          clearTimeout(stallGuard);
          hardNav('/sign-up');
          return;
        } catch (err) {
          if (cancelled) return;
          clearTimeout(stallGuard);
          console.error('[sso-callback] transfer failed:', err);
          setError(
            extractClerkError(err) ??
              'Could not finish creating your account. Try again or use email + password.',
          );
          return;
        }
      }

      // 4. Nothing actionable. Surface the live statuses for triage.
      clearTimeout(stallGuard);
      setError(
        `Could not finish signing you in (signIn: ${signIn?.status ?? 'none'} / ${
          signIn?.firstFactorVerification?.status ?? 'none'
        }, signUp: ${signUp?.status ?? 'none'}). Try again or use email + password.`,
      );
    })();

    return () => {
      cancelled = true;
      clearTimeout(stallGuard);
    };
  }, [
    signInLoaded,
    signUpLoaded,
    handleRedirectCallback,
    signIn,
    signUp,
    setActiveSignIn,
    setActiveSignUp,
    redirectUrl,
  ]);

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
        <>{diagnostic}</>
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
