'use client';

import { useEffect, useState } from 'react';
import { useApiClient } from '@/hooks/useApiClient';

interface DevtoolsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function DevtoolsModal({ open, onClose }: DevtoolsModalProps) {
  const api = useApiClient();
  const [confirming, setConfirming] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [result, setResult] = useState<{ removed: Record<string, number> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [resyncing, setResyncing] = useState(false);
  const [resyncResult, setResyncResult] = useState<{
    perConnection: Array<{ displayName: string | null; inserted: number; skipped: number; accounts: number; error?: string }>;
    categorize: { clustersAnalyzed: number; clustersSkippedCached: number; txnsBackfilled: number };
  } | null>(null);
  const [resyncError, setResyncError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setConfirming(false);
      setWiping(false);
      setResult(null);
      setError(null);
      setResyncing(false);
      setResyncResult(null);
      setResyncError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const wipe = async () => {
    setWiping(true);
    setError(null);
    try {
      const res = await api.wipeFinanceAgent();
      setResult({ removed: res.removed });
      setConfirming(false);
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'Wipe failed');
    } finally {
      setWiping(false);
    }
  };

  const resync = async () => {
    setResyncing(true);
    setResyncError(null);
    setResyncResult(null);
    try {
      const res = await api.resyncFinance();
      setResyncResult({
        perConnection: res.perConnection,
        categorize: res.categorize,
      });
    } catch (err) {
      setResyncError((err as { message?: string })?.message ?? 'Resync failed');
    } finally {
      setResyncing(false);
    }
  };

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.35)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '120px',
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(540px, 92vw)',
          maxHeight: '80vh',
          overflowY: 'auto',
          background: 'var(--bg)',
          border: '1px solid var(--border-light)',
          borderRadius: '14px',
          padding: '24px 24px 20px',
          boxShadow: '0 24px 48px rgba(0,0,0,0.18)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px' }}>
          <div>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 600, margin: 0, color: 'var(--text)' }}>
              Devtools
            </h2>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-dim)', margin: '4px 0 0' }}>
              Developer actions. These bypass normal user flows — use carefully.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              color: 'var(--text-dim)',
              fontSize: '1.2rem',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <section style={{
          border: '1px solid var(--border-light)',
          borderRadius: '10px',
          padding: '16px',
          marginBottom: '14px',
        }}>
          <h3 style={{ fontSize: '0.88rem', fontWeight: 600, margin: '0 0 4px', color: 'var(--text)' }}>
            Re-sync bank connections
          </h3>
          <p style={{ fontSize: '0.76rem', color: 'var(--text-dim)', margin: '0 0 14px', lineHeight: 1.5 }}>
            Pulls the latest transactions from every active Plaid connection, then
            re-categorizes new merchants. Use this if Plaid&apos;s historical backfill
            landed after the initial onboarding sync (you&apos;d see only a few weeks
            of data when expecting more).
          </p>

          {resyncResult ? (
            <div style={{
              fontSize: '0.76rem',
              color: 'var(--text)',
              background: 'color-mix(in srgb, var(--bg), green 6%)',
              border: '1px solid color-mix(in srgb, var(--border-light), green 30%)',
              borderRadius: '8px',
              padding: '12px 14px',
            }}>
              <p style={{ margin: '0 0 8px', fontWeight: 600 }}>Re-sync complete.</p>
              <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {resyncResult.perConnection.map((p, i) => (
                  <li key={i}>
                    {p.displayName ?? '(connection)'}: <strong>+{p.inserted}</strong> new,{' '}
                    {p.skipped} dedup-skipped, {p.accounts} accounts
                    {p.error && <span style={{ color: '#dc2626' }}> — {p.error}</span>}
                  </li>
                ))}
              </ul>
              <p style={{ margin: '10px 0 0', color: 'var(--text-dim)' }}>
                Categorized {resyncResult.categorize.clustersAnalyzed} new merchant cluster(s);
                {resyncResult.categorize.txnsBackfilled} transactions updated.
              </p>
            </div>
          ) : (
            <button
              type="button"
              disabled={resyncing}
              onClick={resync}
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid var(--border-light)',
                background: 'var(--bg)',
                color: 'var(--text)',
                fontSize: '0.82rem',
                fontWeight: 500,
                cursor: resyncing ? 'wait' : 'pointer',
                opacity: resyncing ? 0.7 : 1,
              }}
            >
              {resyncing ? 'Re-syncing…' : 'Re-sync banks'}
            </button>
          )}

          {resyncError && (
            <p style={{ fontSize: '0.76rem', color: '#dc2626', marginTop: '10px' }}>
              {resyncError}
            </p>
          )}
        </section>

        <section style={{
          border: '1px solid var(--border-light)',
          borderRadius: '10px',
          padding: '16px',
        }}>
          <h3 style={{ fontSize: '0.88rem', fontWeight: 600, margin: '0 0 4px', color: 'var(--text)' }}>
            Reset finance agent
          </h3>
          <p style={{ fontSize: '0.76rem', color: 'var(--text-dim)', margin: '0 0 14px', lineHeight: 1.5 }}>
            Wipes every transaction, account, merchant cluster, brief, insight, file
            upload, and bank connection for your finance agent — then deletes the
            agent instance itself. Plaid OAuth tokens are removed; you&apos;ll re-link
            banks during the next onboarding pass. Cannot be undone.
          </p>

          {result ? (
            <div style={{
              fontSize: '0.76rem',
              color: 'var(--text)',
              background: 'color-mix(in srgb, var(--bg), green 6%)',
              border: '1px solid color-mix(in srgb, var(--border-light), green 30%)',
              borderRadius: '8px',
              padding: '12px 14px',
            }}>
              <p style={{ margin: '0 0 8px', fontWeight: 600 }}>Wipe complete.</p>
              <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {Object.entries(result.removed).map(([k, v]) => (
                  <li key={k}>
                    {k}: <strong>{v}</strong>
                  </li>
                ))}
              </ul>
              <p style={{ margin: '10px 0 0', color: 'var(--text-dim)' }}>
                Refresh the app to start onboarding from zero.
              </p>
            </div>
          ) : confirming ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <p style={{
                fontSize: '0.78rem',
                margin: 0,
                padding: '10px 12px',
                background: 'color-mix(in srgb, var(--bg), #dc2626 6%)',
                border: '1px solid color-mix(in srgb, var(--border-light), #dc2626 30%)',
                borderRadius: '8px',
                color: 'var(--text)',
              }}>
                Are you sure? This will delete everything in your finance agent.
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  disabled={wiping}
                  onClick={wipe}
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: 'none',
                    background: '#dc2626',
                    color: 'white',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: wiping ? 'wait' : 'pointer',
                    opacity: wiping ? 0.7 : 1,
                  }}
                >
                  {wiping ? 'Wiping…' : 'Yes, wipe everything'}
                </button>
                <button
                  type="button"
                  disabled={wiping}
                  onClick={() => setConfirming(false)}
                  style={{
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-light)',
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid color-mix(in srgb, var(--border-light), #dc2626 40%)',
                background: 'color-mix(in srgb, var(--bg), #dc2626 4%)',
                color: '#dc2626',
                fontSize: '0.82rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Wipe finance agent
            </button>
          )}

          {error && (
            <p style={{ fontSize: '0.76rem', color: '#dc2626', marginTop: '10px' }}>
              {error}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
