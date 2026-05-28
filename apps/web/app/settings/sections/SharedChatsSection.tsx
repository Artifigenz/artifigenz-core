'use client';

import { useCallback, useEffect, useState } from 'react';
import { useApiClient } from '@/hooks/useApiClient';
import type { ApiError, ShareRecord } from '@/lib/api-client';
import styles from '../page.module.css';

/**
 * Inventory of every public share the user has created. Each row offers a
 * Copy (URL) and Revoke. Revoking is final — the public URL 404s immediately.
 * Listed newest-first; revoked shares are not returned by the backend.
 */
export function SharedChatsSection() {
  const api = useApiClient();
  const [shares, setShares] = useState<ShareRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyToken, setBusyToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { shares } = await api.listShares();
      setShares(shares);
    } catch (err) {
      setError((err as ApiError).message ?? 'Failed to load shares');
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const origin =
    typeof window !== 'undefined' ? window.location.origin : '';

  const copy = async (token: string) => {
    if (!origin) return;
    try {
      await navigator.clipboard.writeText(`${origin}/share/${token}`);
      setCopiedToken(token);
      setTimeout(
        () => setCopiedToken((cur) => (cur === token ? null : cur)),
        1500,
      );
    } catch {
      setError('Could not copy. Select the URL and copy manually.');
    }
  };

  const revoke = async (token: string) => {
    if (!confirm('Revoke this share? The link will stop working immediately.'))
      return;
    setBusyToken(token);
    try {
      await api.revokeShare(token);
      setShares((cur) => (cur ?? []).filter((s) => s.shareToken !== token));
    } catch (err) {
      setError((err as ApiError).message ?? 'Failed to revoke');
    } finally {
      setBusyToken(null);
    }
  };

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Shared chats</h2>
        <p className={styles.sectionDesc}>
          Public read-only links to your conversations. Revoke any of them
          here.
        </p>
      </div>

      <div className={styles.card}>
        {error && (
          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <div className={styles.rowName}>Error</div>
            </div>
            <div className={styles.rowControl}>
              <span style={{ color: 'var(--text-mid)' }}>{error}</span>
            </div>
          </div>
        )}

        {shares === null && !error && (
          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <div className={styles.rowHint}>Loading…</div>
            </div>
          </div>
        )}

        {shares?.length === 0 && !error && (
          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <div className={styles.rowName}>No shared chats yet</div>
              <div className={styles.rowHint}>
                Open the history modal, click the menu on any chat, and pick
                “Share link.”
              </div>
            </div>
          </div>
        )}

        {shares?.map((s) => {
          const title = s.title?.trim() || 'Untitled chat';
          const url = `${origin}/share/${s.shareToken}`;
          return (
            <div key={s.id} className={styles.rowAction}>
              <div className={styles.rowLabel}>
                <div className={styles.rowName}>{title}</div>
                <div className={styles.rowHint}>
                  {s.viewCount} {s.viewCount === 1 ? 'view' : 'views'} ·{' '}
                  shared {formatRelative(s.createdAt)}
                </div>
              </div>
              <div
                className={styles.rowControl}
                style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}
              >
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: '0.78rem',
                    color: 'var(--text-mid)',
                    textDecoration: 'none',
                    padding: '6px 10px',
                  }}
                >
                  Open
                </a>
                <button
                  type="button"
                  onClick={() => copy(s.shareToken)}
                  style={{
                    fontSize: '0.78rem',
                    padding: '6px 12px',
                    border: '1px solid var(--border-light)',
                    borderRadius: 999,
                    background: 'transparent',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {copiedToken === s.shareToken ? 'Copied' : 'Copy link'}
                </button>
                <button
                  type="button"
                  onClick={() => revoke(s.shareToken)}
                  disabled={busyToken === s.shareToken}
                  style={{
                    fontSize: '0.78rem',
                    padding: '6px 12px',
                    border: '1px solid currentColor',
                    borderRadius: 999,
                    background: 'transparent',
                    color: '#b1271b',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    opacity: busyToken === s.shareToken ? 0.5 : 1,
                  }}
                >
                  Revoke
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < hr) return `${Math.max(1, Math.round(diff / min))}m ago`;
  if (diff < day) return `${Math.round(diff / hr)}h ago`;
  if (diff < 30 * day) return `${Math.round(diff / day)}d ago`;
  return new Date(iso).toLocaleDateString();
}
