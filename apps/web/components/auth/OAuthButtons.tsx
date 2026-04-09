'use client';

import { useState } from 'react';
import { useSignIn, useSignUp } from '@clerk/nextjs/legacy';
import { authStyles as styles } from './AuthLayout';

type OAuthStrategy = 'oauth_google' | 'oauth_apple' | 'oauth_x';

const PROVIDERS: Array<{
  strategy: OAuthStrategy;
  label: string;
  icon: React.ReactNode;
}> = [
  {
    strategy: 'oauth_google',
    label: 'Google',
    icon: (
      <svg viewBox="0 0 48 48" fill="none">
        <path
          fill="#FFC107"
          d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
        />
        <path
          fill="#FF3D00"
          d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
        />
        <path
          fill="#4CAF50"
          d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
        />
        <path
          fill="#1976D2"
          d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
        />
      </svg>
    ),
  },
  {
    strategy: 'oauth_apple',
    label: 'Apple',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
      </svg>
    ),
  },
  {
    strategy: 'oauth_x',
    label: 'X',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
];

export default function OAuthButtons({
  redirectUrlComplete,
  mode = 'signIn',
}: {
  redirectUrlComplete: string;
  mode?: 'signIn' | 'signUp';
}) {
  const { signIn, isLoaded: signInLoaded } = useSignIn();
  const { signUp, isLoaded: signUpLoaded } = useSignUp();
  const [pending, setPending] = useState<OAuthStrategy | null>(null);

  const isLoaded = mode === 'signUp' ? signUpLoaded : signInLoaded;

  async function handleOAuth(strategy: OAuthStrategy) {
    if (!isLoaded || pending) return;
    setPending(strategy);
    try {
      if (mode === 'signUp' && signUp) {
        await signUp.authenticateWithRedirect({
          strategy,
          redirectUrl: '/sso-callback',
          redirectUrlComplete,
        });
      } else if (signIn) {
        await signIn.authenticateWithRedirect({
          strategy,
          redirectUrl: '/sso-callback',
          redirectUrlComplete,
        });
      }
    } catch {
      setPending(null);
    }
  }

  return (
    <>
      <div className={styles.oauthList}>
        {PROVIDERS.map((p) => (
          <button
            key={p.strategy}
            type="button"
            className={styles.oauthBtn}
            onClick={() => handleOAuth(p.strategy)}
            disabled={!isLoaded || pending !== null}
            data-pending={pending === p.strategy}
            aria-label={`Continue with ${p.label}`}
            title={`Continue with ${p.label}`}
          >
            <span className={styles.oauthIcon}>{p.icon}</span>
          </button>
        ))}
      </div>

      <div className={styles.divider}>
        <div className={styles.dividerLine} />
        <span className={styles.dividerText}>or</span>
        <div className={styles.dividerLine} />
      </div>
    </>
  );
}
