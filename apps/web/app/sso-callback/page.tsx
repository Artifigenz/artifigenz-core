'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useClerk } from '@clerk/nextjs';
import { useSignIn, useSignUp } from '@clerk/nextjs/legacy';

/**
 * OAuth callback that handles every branch the default Clerk component
 * silently dropped on the floor:
 *
 *  1. **Existing user signs in via OAuth** — handleRedirectCallback
 *     completes a sign-in session, we set it active, push to redirectUrl.
 *  2. **New user clicks OAuth on the sign-up page** — handleRedirectCallback
 *     creates a signUp. If it's complete, set it active. If it's missing
 *     fields (e.g. provider didn't return email), forward to /sign-up
 *     where the form picks up the in-progress signUp and asks for what's
 *     missing.
 *  3. **New user clicks OAuth on the sign-in page** — Clerk creates a
 *     "transferable" signIn (no matching account exists). This case is
 *     what was getting stuck: `<AuthenticateWithRedirectCallback>` didn't
 *     auto-transfer reliably with our hook setup. We detect it here and
 *     run `signUp.create({ transfer: true })` to convert into a proper
 *     signUp, then follow case 2's logic.
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

  useEffect(() => {
    if (!signInLoaded || !signUpLoaded) return;
    let cancelled = false;

    (async () => {
      try {
        // Let Clerk do its thing for the common cases first — completes
        // a sign-in/up session and navigates internally when it can.
        await handleRedirectCallback({
          signInFallbackRedirectUrl: redirectUrl,
          signUpFallbackRedirectUrl: redirectUrl,
          continueSignUpUrl: '/sign-up',
          firstFactorUrl: '/sign-in',
          secondFactorUrl: '/sign-in',
        });
        return;
      } catch (err) {
        if (cancelled) return;
        console.warn('[sso-callback] primary path failed, falling through', err);
      }

      // ── Fallthrough — Clerk couldn't auto-resolve. Check for the
      // transferable case (new user via sign-in OAuth) and finish it
      // manually so the user isn't stranded.
      if (cancelled) return;
      try {
        const transferable =
          signIn?.firstFactorVerification?.status === 'transferable';

        if (transferable && signUp) {
          const created = await signUp.create({ transfer: true });
          if (created.status === 'complete' && created.createdSessionId) {
            await setActiveSignUp({ session: created.createdSessionId });
            router.replace(redirectUrl);
            return;
          }
          if (created.status === 'missing_requirements') {
            // Send them to /sign-up where the form picks up signUp and
            // asks for the missing field(s).
            router.replace('/sign-up');
            return;
          }
          // Unknown state — surface it.
          setError(
            `Sign-up didn't complete (status: ${created.status ?? 'unknown'}). Try again or use email + password.`,
          );
          return;
        }

        // Sign-in completed without a session being created? Recover by
        // forcing the redirect target.
        if (signIn?.status === 'complete' && signIn.createdSessionId) {
          await setActiveSignIn({ session: signIn.createdSessionId });
          router.replace(redirectUrl);
          return;
        }

        if (signUp?.status === 'complete' && signUp.createdSessionId) {
          await setActiveSignUp({ session: signUp.createdSessionId });
          router.replace(redirectUrl);
          return;
        }
        if (signUp?.status === 'missing_requirements') {
          router.replace('/sign-up');
          return;
        }

        setError(
          'Sign-in didn’t complete. Please try again or use email + password.',
        );
      } catch (err) {
        if (cancelled) return;
        console.error('[sso-callback] manual fallthrough failed', err);
        setError(
          'Could not finish signing you in. Please try again or use email + password.',
        );
      }
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
        <>Signing you in…</>
      )}
    </div>
  );
}

export default function SSOCallbackPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh' }} />}>
      <SSOCallbackContent />
    </Suspense>
  );
}
