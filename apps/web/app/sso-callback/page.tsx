'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useClerk } from '@clerk/nextjs';
import { useSignIn, useSignUp } from '@clerk/nextjs/legacy';

/**
 * OAuth callback that handles every branch the default Clerk component
 * silently dropped on the floor:
 *
 *  1. Existing user signs in via OAuth — set the session, push home.
 *  2. New user via /sign-up OAuth — completed or missing-requirements.
 *  3. New user via /sign-in OAuth — Clerk creates a "transferable"
 *     signIn that we convert into a signUp here.
 *
 * The earlier version returned early after handleRedirectCallback
 * resolved, even when no navigation actually happened — that's how
 * users ended up stuck. This version *always* re-checks the live
 * signIn/signUp state and forces the right redirect.
 */
function SSOCallbackContent() {
  const router = useRouter();
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

  useEffect(() => {
    if (!signInLoaded || !signUpLoaded) return;
    if (ran.current) return;
    ran.current = true;

    let cancelled = false;

    (async () => {
      // Step 1 — let Clerk's official handler take the easy paths. We do
      // NOT trust it to navigate, so we don't return after this; we just
      // let it set state and then make our own decision.
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
        // Not necessarily fatal — could be the "transferable" case which
        // the SDK reports as an error. Let the state inspection below
        // decide what to do.
        console.warn('[sso-callback] handleRedirectCallback threw:', err);
      }

      if (cancelled) return;

      // Step 2 — inspect the live state and finish manually. Note that
      // signIn/signUp here are React stable refs that Clerk mutates;
      // their fields reflect the post-callback state.
      setDiagnostic('Finishing sign-in…');

      // 2a. SignIn already complete? Activate the session and go.
      if (signIn?.status === 'complete' && signIn.createdSessionId) {
        await setActiveSignIn({ session: signIn.createdSessionId });
        if (!cancelled) router.replace(redirectUrl);
        return;
      }

      // 2b. SignUp already complete? Activate and go.
      if (signUp?.status === 'complete' && signUp.createdSessionId) {
        await setActiveSignUp({ session: signUp.createdSessionId });
        if (!cancelled) router.replace(redirectUrl);
        return;
      }

      // 2c. SignUp missing fields (provider didn't return email, etc.).
      // /sign-up's effect detects this status and shows the right step.
      if (signUp?.status === 'missing_requirements') {
        if (!cancelled) router.replace('/sign-up');
        return;
      }

      // 2d. Transferable signIn — this is the broken case. Convert to
      // a signUp via Clerk's transfer mechanism.
      const transferable =
        signIn?.firstFactorVerification?.status === 'transferable';
      if (transferable && signUp) {
        try {
          setDiagnostic('Creating your account…');
          const created = await signUp.create({ transfer: true });
          if (cancelled) return;

          if (created.status === 'complete' && created.createdSessionId) {
            await setActiveSignUp({ session: created.createdSessionId });
            if (!cancelled) router.replace(redirectUrl);
            return;
          }
          if (created.status === 'missing_requirements') {
            if (!cancelled) router.replace('/sign-up');
            return;
          }
          setError(
            `Sign-up didn't finish (status: ${created.status ?? 'unknown'}).`,
          );
          return;
        } catch (err) {
          if (cancelled) return;
          console.error('[sso-callback] transfer failed:', err);
          setError(
            extractClerkError(err) ??
              'Could not finish creating your account. Try again or use email + password.',
          );
          return;
        }
      }

      // 2e. Nothing resolved — show an actionable error rather than
      // hanging on the spinner forever.
      setError(
        `Could not finish signing you in (signIn: ${signIn?.status ?? 'none'}, signUp: ${signUp?.status ?? 'none'}). Try again or use email + password.`,
      );
    })();

    return () => {
      cancelled = true;
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
    router,
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
