'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSignIn, useSignUp } from '@clerk/nextjs/legacy';

/**
 * OAuth callback. Follows Clerk's recommended custom-flow pattern:
 * the Clerk SDK auto-populates signIn / signUp from the URL params on
 * mount, we inspect that state and finish the flow ourselves. We do
 * NOT call handleRedirectCallback — when the server returns a
 * "transferable" signIn (new user via /sign-in OAuth), running it
 * eats the verification and the subsequent signUp.create({ transfer })
 * has nothing left to transfer.
 *
 * Navigation always goes through window.location.assign — Next's
 * client router refuses to flush while a Clerk Promise is still
 * pending, and we'd rather just leave the page than juggle that.
 */
function SSOCallbackContent() {
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get('redirect_url') || '/';
  const { signIn, isLoaded: signInLoaded, setActive: setActiveSignIn } =
    useSignIn();
  const { signUp, isLoaded: signUpLoaded, setActive: setActiveSignUp } =
    useSignUp();
  const [error, setError] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<string>('Signing you in…');
  // Imperative refs so the effect can read the latest values without
  // putting the (unstable) Clerk objects in its dependency array, which
  // was re-running the effect mid-await and cancelling our own flow.
  const signInRef = useRef(signIn);
  const signUpRef = useRef(signUp);
  signInRef.current = signIn;
  signUpRef.current = signUp;
  const setActiveSignInRef = useRef(setActiveSignIn);
  const setActiveSignUpRef = useRef(setActiveSignUp);
  setActiveSignInRef.current = setActiveSignIn;
  setActiveSignUpRef.current = setActiveSignUp;
  const ran = useRef(false);

  const hardNav = (url: string) => {
    if (typeof window !== 'undefined') window.location.assign(url);
  };

  useEffect(() => {
    if (!signInLoaded || !signUpLoaded) return;
    if (ran.current) return;
    ran.current = true;

    // 10s safety net — if every branch silently fails, hand off to
    // /sign-up so the user is never permanently stranded.
    const stallGuard = setTimeout(() => {
      console.warn('[sso-callback] stalled, hard-nav /sign-up');
      hardNav('/sign-up');
    }, 10000);

    (async () => {
      const si = signInRef.current;
      const su = signUpRef.current;
      console.log('[sso-callback] initial state', {
        signInStatus: si?.status,
        signInFirstFactor: si?.firstFactorVerification?.status,
        signUpStatus: su?.status,
        signUpMissingFields: su?.missingFields,
        signUpExternalAccountStatus:
          su?.verifications?.externalAccount?.status,
      });

      const setActiveSI = setActiveSignInRef.current;
      const setActiveSU = setActiveSignUpRef.current;

      // 1. Either flow already complete on arrival — set active + go.
      try {
        if (si?.status === 'complete' && si.createdSessionId && setActiveSI) {
          await setActiveSI({ session: si.createdSessionId });
          clearTimeout(stallGuard);
          hardNav(redirectUrl);
          return;
        }
        if (su?.status === 'complete' && su.createdSessionId && setActiveSU) {
          await setActiveSU({ session: su.createdSessionId });
          clearTimeout(stallGuard);
          hardNav(redirectUrl);
          return;
        }
      } catch (err) {
        console.error('[sso-callback] setActive on arrival failed:', err);
      }

      // 2. SignUp already in progress with missing fields — let
      //    /sign-up's form finish it.
      if (su?.status === 'missing_requirements') {
        clearTimeout(stallGuard);
        hardNav('/sign-up');
        return;
      }

      // 3. Transferable signIn (new user via /sign-in OAuth). Convert
      //    to a signUp via Clerk's transfer mechanism.
      const transferable =
        si?.firstFactorVerification?.status === 'transferable';
      if (transferable && su) {
        try {
          setDiagnostic('Creating your account…');
          const created = await su.create({ transfer: true });
          console.log('[sso-callback] transfer result', {
            status: created.status,
            missingFields: created.missingFields,
            unverifiedFields: created.unverifiedFields,
            sessionId: created.createdSessionId,
          });

          if (created.status === 'complete' && created.createdSessionId) {
            try {
              if (setActiveSU) {
                await setActiveSU({ session: created.createdSessionId });
              }
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

          // Anything else (missing_requirements OR unrecognised) → /sign-up.
          clearTimeout(stallGuard);
          hardNav('/sign-up');
          return;
        } catch (err) {
          clearTimeout(stallGuard);
          console.error('[sso-callback] transfer threw:', err);
          setError(
            extractClerkError(err) ??
              'Could not finish creating your account. Try again or use email + password.',
          );
          return;
        }
      }

      // 4. None of the above. If we have ANY signUp at all, send the
      //    user to /sign-up so the form can pick it up. Otherwise show
      //    a real error with the live statuses.
      if (su) {
        clearTimeout(stallGuard);
        hardNav('/sign-up');
        return;
      }
      clearTimeout(stallGuard);
      setError(
        `Could not finish signing you in (signIn: ${si?.status ?? 'none'} / ${
          si?.firstFactorVerification?.status ?? 'none'
        }, signUp: ${su?.status ?? 'none'}). Try again or use email + password.`,
      );
    })();

    return () => {
      clearTimeout(stallGuard);
    };
    // signIn / signUp / setActive intentionally read via refs above so
    // we don't re-run the effect every time Clerk mutates them.
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
