'use client';

import { useEffect, useState } from 'react';
import { useApiClient } from '@/hooks/useApiClient';

interface DevtoolsModalProps {
  open: boolean;
  onClose: () => void;
}

type DebugInfo = {
  transactionCount: number;
  insightCount: number;
  skillRecord: { exists: boolean; lastRunAt?: string };
};

type ActionResult = { ok: true; text: string } | { ok: false; text: string };

export default function DevtoolsModal({ open, onClose }: DevtoolsModalProps) {
  const api = useApiClient();
  const [agentInstanceId, setAgentInstanceId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ActionResult>>({});
  const [debug, setDebug] = useState<DebugInfo | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [confirmWipeChats, setConfirmWipeChats] = useState(false);

  useEffect(() => {
    if (!open) {
      setBusy(null);
      setResults({});
      setDebug(null);
      setConfirmWipe(false);
      setConfirmWipeChats(false);
      return;
    }
    api.getAgentStatus()
      .then((s) => setAgentInstanceId(s.agentInstanceId ?? null))
      .catch(() => setAgentInstanceId(null));
  }, [open, api]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setResults((r) => ({ ...r, [key]: { ok: true, text: '' } }));
    try {
      const text = await fn();
      setResults((r) => ({ ...r, [key]: { ok: true, text } }));
    } catch (err) {
      setResults((r) => ({
        ...r,
        [key]: {
          ok: false,
          text: (err as { message?: string })?.message ?? 'Failed',
        },
      }));
    } finally {
      setBusy(null);
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
        paddingTop: '110px',
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(480px, 92vw)',
          maxHeight: '80vh',
          overflowY: 'auto',
          background: 'var(--bg)',
          border: '1px solid var(--border-light)',
          borderRadius: '14px',
          padding: '20px 22px 16px',
          boxShadow: '0 24px 48px rgba(0, 0, 0, 0.18)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 600, margin: 0, color: 'var(--text)' }}>
            Devtools
          </h2>
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

        <ActionRow
          label="Re-sync banks"
          busy={busy === 'resync'}
          result={results.resync}
          onRun={() =>
            run('resync', async () => {
              const r = await api.resyncFinance();
              const inserted = r.perConnection.reduce((s, p) => s + p.inserted, 0);
              return `+${inserted} new txns · ${r.categorize.clustersAnalyzed} clusters analyzed`;
            })
          }
        />

        <ActionRow
          label="Reset categorization"
          busy={busy === 'reset-cat'}
          result={results['reset-cat']}
          onRun={() =>
            run('reset-cat', async () => {
              const r = await api.resetAllCategories();
              return r.message;
            })
          }
        />

        <ActionRow
          label="Clear insights"
          busy={busy === 'clear-ins'}
          result={results['clear-ins']}
          disabled={!agentInstanceId}
          onRun={() =>
            run('clear-ins', async () => {
              if (!agentInstanceId) throw new Error('No finance agent');
              await api.clearInsights(agentInstanceId);
              return 'Cleared';
            })
          }
        />

        <ActionRow
          label="Show debug info"
          busy={busy === 'debug'}
          result={results.debug}
          disabled={!agentInstanceId}
          buttonLabel="Show"
          onRun={() =>
            run('debug', async () => {
              if (!agentInstanceId) throw new Error('No finance agent');
              const info = await api.getDebugInfo(agentInstanceId);
              setDebug({
                transactionCount: info.transactionCount,
                insightCount: info.insightCount,
                skillRecord: {
                  exists: info.skillRecord.exists,
                  lastRunAt: info.skillRecord.lastRunAt,
                },
              });
              return `${info.transactionCount} txns · ${info.insightCount} insights`;
            })
          }
        />

        {debug && (
          <pre style={{
            margin: '4px 0 12px 0',
            padding: '10px 12px',
            background: 'rgba(0,0,0,0.03)',
            border: '1px solid var(--border-light)',
            borderRadius: '6px',
            fontSize: '0.72rem',
            fontFamily: 'var(--font-mono, ui-monospace, monospace)',
            color: 'var(--text-mid)',
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
          }}>
{JSON.stringify(debug, null, 2)}
          </pre>
        )}

        <div style={{
          marginTop: '14px',
          paddingTop: '14px',
          borderTop: '1px solid var(--border-light)',
        }}>
          {results['wipe-chats']?.ok && results['wipe-chats'].text ? (
            <p style={{
              margin: '0 0 12px 0',
              fontSize: '0.78rem',
              color: 'var(--text-mid)',
            }}>
              {results['wipe-chats'].text} · refresh history to confirm
            </p>
          ) : confirmWipeChats ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
              <p style={{
                margin: 0,
                fontSize: '0.76rem',
                color: 'var(--text-mid)',
                lineHeight: 1.5,
              }}>
                Deletes every conversation and message for your account.
                Memories and connected accounts are kept. Cannot be undone.
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  disabled={busy === 'wipe-chats'}
                  onClick={() =>
                    run('wipe-chats', async () => {
                      const r = await api.wipeAllConversations();
                      setConfirmWipeChats(false);
                      return `Removed ${r.removed} conversation${r.removed === 1 ? '' : 's'}`;
                    })
                  }
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    background: '#dc2626',
                    color: 'white',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: busy === 'wipe-chats' ? 'wait' : 'pointer',
                    opacity: busy === 'wipe-chats' ? 0.7 : 1,
                    fontFamily: 'inherit',
                  }}
                >
                  {busy === 'wipe-chats' ? 'Wiping…' : 'Yes, wipe chat history'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmWipeChats(false)}
                  disabled={busy === 'wipe-chats'}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-light)',
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <ActionRow
              label="Wipe chat history"
              danger
              busy={false}
              result={results['wipe-chats']?.ok === false ? results['wipe-chats'] : undefined}
              onRun={() => setConfirmWipeChats(true)}
              buttonLabel="Wipe"
            />
          )}

          {results.wipe?.ok && results.wipe.text ? (
            <p style={{
              margin: 0,
              fontSize: '0.78rem',
              color: 'var(--text-mid)',
            }}>
              {results.wipe.text} · refresh to start fresh
            </p>
          ) : confirmWipe ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <p style={{
                margin: 0,
                fontSize: '0.76rem',
                color: 'var(--text-mid)',
                lineHeight: 1.5,
              }}>
                Wipes every transaction, account, cluster, brief, insight, file
                upload, and bank connection — then deletes the agent itself.
                Plaid tokens go too. Cannot be undone.
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  disabled={busy === 'wipe'}
                  onClick={() =>
                    run('wipe', async () => {
                      const r = await api.wipeFinanceAgent();
                      const total = Object.values(r.removed).reduce((s, n) => s + n, 0);
                      setConfirmWipe(false);
                      return `Removed ${total} rows across ${Object.keys(r.removed).length} tables`;
                    })
                  }
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    background: '#dc2626',
                    color: 'white',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: busy === 'wipe' ? 'wait' : 'pointer',
                    opacity: busy === 'wipe' ? 0.7 : 1,
                    fontFamily: 'inherit',
                  }}
                >
                  {busy === 'wipe' ? 'Wiping…' : 'Yes, wipe everything'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmWipe(false)}
                  disabled={busy === 'wipe'}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-light)',
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <ActionRow
              label="Wipe finance agent"
              danger
              busy={false}
              result={results.wipe?.ok === false ? results.wipe : undefined}
              onRun={() => setConfirmWipe(true)}
              buttonLabel="Wipe"
            />
          )}
        </div>
      </div>
    </div>
  );
}

interface ActionRowProps {
  label: string;
  buttonLabel?: string;
  busy: boolean;
  disabled?: boolean;
  danger?: boolean;
  result?: ActionResult;
  onRun: () => void;
}

function ActionRow({
  label,
  buttonLabel = 'Run',
  busy,
  disabled,
  danger,
  result,
  onRun,
}: ActionRowProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      padding: '10px 0',
      borderBottom: '1px solid var(--border-light)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.82rem', fontWeight: 500, color: danger ? '#dc2626' : 'var(--text)' }}>
          {label}
        </div>
        {result && result.text && (
          <div style={{
            fontSize: '0.72rem',
            color: result.ok ? 'var(--text-dim)' : '#dc2626',
            marginTop: '2px',
          }}>
            {result.text}
          </div>
        )}
      </div>
      <button
        type="button"
        disabled={busy || disabled}
        onClick={onRun}
        style={{
          padding: '6px 12px',
          borderRadius: '6px',
          border: danger
            ? '1px solid color-mix(in srgb, var(--border-light), #dc2626 40%)'
            : '1px solid var(--border-light)',
          background: danger ? 'color-mix(in srgb, var(--bg), #dc2626 4%)' : 'var(--bg)',
          color: danger ? '#dc2626' : 'var(--text)',
          fontSize: '0.76rem',
          fontWeight: 500,
          cursor: busy ? 'wait' : disabled ? 'not-allowed' : 'pointer',
          opacity: busy || disabled ? 0.6 : 1,
          fontFamily: 'inherit',
          whiteSpace: 'nowrap',
        }}
      >
        {busy ? '…' : buttonLabel}
      </button>
    </div>
  );
}
