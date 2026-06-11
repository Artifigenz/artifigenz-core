'use client';

/**
 * Plaid OAuth handoff page.
 *
 * OAuth banks (Chase, Capital One, BoA, Wells Fargo, Citi, …) redirect the
 * user's browser to a URL we own after they authorize at the bank. This page
 * resumes Plaid Link with the cached link_token + `receivedRedirectUri` so
 * Link can finish the connection and fire `onSuccess`.
 *
 * The URL path must match the `redirect_uri` registered in the Plaid dashboard.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePlaidLink } from 'react-plaid-link';
import { useApiClient } from '@/hooks/useApiClient';
import {
  clearPlaidPending,
  readPlaidPending,
  type PlaidPending,
} from '@/lib/plaid-pending';

export default function PlaidOAuthPage() {
  const router = useRouter();
  const api = useApiClient();
  const [pending, setPending] = useState<PlaidPending | null>(null);
  const [status, setStatus] = useState<'loading' | 'resuming' | 'finishing' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const p = readPlaidPending();
    if (!p) {
      // No pending link — someone hit this URL directly.
      setStatus('error');
      setError('No pending Plaid connection. Start from the activate page.');
      return;
    }
    setPending(p);
    setStatus('resuming');
  }, []);

  const { open, ready } = usePlaidLink({
    token: pending?.linkToken ?? null,
    receivedRedirectUri: typeof window !== 'undefined' ? window.location.href : undefined,
    onSuccess: async (publicToken, metadata) => {
      if (!pending) return;
      setStatus('finishing');
      try {
        await api.finalizeConnection(pending.agentInstanceId, 'plaid', {
          publicToken,
          metadata: {
            institutionId: metadata.institution?.institution_id,
            institutionName: metadata.institution?.name,
            accounts: metadata.accounts.map((a) => ({
              id: a.id,
              name: a.name,
              mask: a.mask ?? null,
            })),
          },
        });
        // Fire-and-forget sync — transactions will arrive in the background.
        api.syncAgent(pending.agentInstanceId).catch(() => {});
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to finalize');
        setStatus('error');
        return;
      } finally {
        clearPlaidPending();
      }
      router.replace(pending.returnTo || '/finance');
    },
    onExit: () => {
      clearPlaidPending();
      router.replace(pending?.returnTo || '/finance');
    },
  });

  // Auto-open Plaid Link as soon as the SDK is ready with the saved token.
  useEffect(() => {
    if (pending && ready) open();
  }, [pending, ready, open]);

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ maxWidth: '360px', textAlign: 'center' }}>
        {status === 'error' ? (
          <>
            <h1 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '8px' }}>
              Something went wrong
            </h1>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginBottom: '24px' }}>
              {error}
            </p>
            <button
              type="button"
              onClick={() => router.replace('/finance')}
              style={{
                padding: '10px 20px',
                borderRadius: '9999px',
                border: '1px solid var(--border-light)',
                background: 'transparent',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: '0.85rem',
              }}
            >
              Back to app
            </button>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '8px' }}>
              Finishing your bank connection…
            </h1>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
              Just a moment — Plaid is handing you back.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
