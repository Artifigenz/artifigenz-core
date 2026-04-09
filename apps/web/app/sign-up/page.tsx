'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useSignUp } from '@clerk/nextjs/legacy';
import AuthLayout, { authStyles as styles } from '@/components/auth/AuthLayout';
import OAuthButtons from '@/components/auth/OAuthButtons';

type Step = 'form' | 'continue' | 'verify';

function SignUpContent() {
  const { signUp, setActive, isLoaded } = useSignUp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get('redirect_url') || '/';

  const [step, setStep] = useState<Step>('form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  // Detect in-progress OAuth sign-up that needs additional fields (e.g. X
  // doesn't return email). When we land on /sign-up with an existing
  // signUp that has missing_requirements, switch to the continuation step.
  useEffect(() => {
    if (!isLoaded || !signUp) return;

    if (signUp.status === 'missing_requirements') {
      // If email verification is already pending, go straight to verify step
      if (signUp.unverifiedFields?.includes('email_address') && signUp.emailAddress) {
        setEmail(signUp.emailAddress);
        setStep('verify');
      } else {
        setStep('continue');
      }
    } else if (signUp.status === 'complete' && signUp.createdSessionId) {
      // Edge case: already complete (e.g. user came back on an old link)
      setActive({ session: signUp.createdSessionId }).then(() => {
        router.push(redirectUrl);
      });
    }
    // Intentionally only run when isLoaded changes or signUp ref changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, signUp?.status]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || submitting || !signUp) return;
    setError(null);
    setSubmitting(true);

    try {
      await signUp.create({
        emailAddress: email.trim(),
        password,
      });

      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setStep('verify');
    } catch (err: unknown) {
      setError(extractClerkError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleContinue(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || submitting || !signUp) return;
    setError(null);
    setSubmitting(true);

    try {
      // Attach the missing email to the in-progress OAuth sign-up
      const updated = await signUp.update({
        emailAddress: email.trim(),
      });

      if (updated.status === 'complete' && updated.createdSessionId) {
        await setActive({ session: updated.createdSessionId });
        router.push(redirectUrl);
        return;
      }

      // Email needs verification — send the code
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setStep('verify');
    } catch (err: unknown) {
      setError(extractClerkError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || submitting || !signUp) return;
    setError(null);
    setSubmitting(true);

    try {
      const result = await signUp.attemptEmailAddressVerification({ code: code.trim() });

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        router.push(redirectUrl);
      } else {
        setError('Verification incomplete. Try again.');
      }
    } catch (err: unknown) {
      setError(extractClerkError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (!isLoaded || resending || !signUp) return;
    setResending(true);
    setError(null);
    try {
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
    } catch (err: unknown) {
      setError(extractClerkError(err));
    } finally {
      setResending(false);
    }
  }

  // ─── Step: verify (email code) ──────────────────────────────
  if (step === 'verify') {
    return (
      <AuthLayout
        title="Check your email"
        subtitle={`We sent a 6-digit code to ${email}.`}
      >
        <form className={styles.form} onSubmit={handleVerify} noValidate>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="code">
              Verification code
            </label>
            <input
              id="code"
              className={styles.input}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              disabled={submitting}
              autoFocus
            />
          </div>

          <p className={styles.error}>{error ?? ''}</p>

          <button
            type="submit"
            className={styles.submit}
            disabled={!isLoaded || submitting || code.length < 6}
          >
            {submitting ? 'Verifying…' : 'Verify'}
          </button>

          <div className={styles.resendRow}>
            <button
              type="button"
              className={styles.textButton}
              onClick={() => {
                setStep('form');
                setError(null);
                setCode('');
              }}
              disabled={submitting}
            >
              ← Back
            </button>
            <button
              type="button"
              className={styles.textButton}
              onClick={handleResend}
              disabled={submitting || resending}
            >
              {resending ? 'Sending…' : 'Resend code'}
            </button>
          </div>
        </form>
      </AuthLayout>
    );
  }

  // ─── Step: continue (OAuth needs more info) ─────────────────
  if (step === 'continue') {
    return (
      <AuthLayout
        title="Almost done"
        subtitle="We just need your email to finish setting up your account."
      >
        <form className={styles.form} onSubmit={handleContinue} noValidate>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className={styles.input}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              autoFocus
            />
          </div>

          <p className={styles.error}>{error ?? ''}</p>

          <button
            type="submit"
            className={styles.submit}
            disabled={!isLoaded || submitting || !email}
          >
            {submitting ? 'Finishing…' : 'Continue'}
          </button>
        </form>
      </AuthLayout>
    );
  }

  // ─── Step: form (default: email/password sign-up) ───────────
  return (
    <AuthLayout
      title="Create your account"
      subtitle="Get started in 30 seconds."
      footer={
        <>
          Already have an account?
          <Link
            href={`/sign-in${redirectUrl !== '/' ? `?redirect_url=${encodeURIComponent(redirectUrl)}` : ''}`}
            className={styles.footerLink}
          >
            Sign in
          </Link>
        </>
      }
    >
      <OAuthButtons redirectUrlComplete={redirectUrl} mode="signUp" />

      <form className={styles.form} onSubmit={handleCreate} noValidate>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className={styles.input}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className={styles.input}
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
          />
        </div>

        <p className={styles.error}>{error ?? ''}</p>

        <button
          type="submit"
          className={styles.submit}
          disabled={!isLoaded || submitting || !email || password.length < 8}
        >
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthLayout>
  );
}

function extractClerkError(err: unknown): string {
  if (
    typeof err === 'object' &&
    err !== null &&
    'errors' in err &&
    Array.isArray((err as { errors: unknown }).errors)
  ) {
    const errors = (err as { errors: Array<{ longMessage?: string; message?: string }> }).errors;
    return errors[0]?.longMessage || errors[0]?.message || 'Sign up failed';
  }
  return err instanceof Error ? err.message : 'Sign up failed';
}

export default function SignUpPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh' }} />}>
      <SignUpContent />
    </Suspense>
  );
}
