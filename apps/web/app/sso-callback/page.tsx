'use client';

import { AuthenticateWithRedirectCallback } from '@clerk/nextjs';

export default function SSOCallbackPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '0.85rem',
        color: 'var(--text-dim)',
      }}
    >
      <AuthenticateWithRedirectCallback
        signInFallbackRedirectUrl="/"
        signUpFallbackRedirectUrl="/"
        signInForceRedirectUrl="/"
        signUpForceRedirectUrl="/"
        continueSignUpUrl="/sign-up"
        firstFactorUrl="/sign-in"
        secondFactorUrl="/sign-in"
      />
      Signing you in…
    </div>
  );
}
