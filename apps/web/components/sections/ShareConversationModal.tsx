'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import styles from './ShareConversationModal.module.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface Props {
  open: boolean;
  conversationId: string | null;
  conversationTitle: string | null;
  onClose: () => void;
}

interface CreatedShare {
  shareToken: string;
}

/**
 * Modal that creates (or revokes) a public share link for a single
 * conversation. Generates the link the moment the modal opens so the user
 * sees the URL immediately — no "click to create" friction. The Revoke
 * button kills the link and closes the modal.
 */
export default function ShareConversationModal({
  open,
  conversationId,
  conversationTitle,
  onClose,
}: Props) {
  const { getToken } = useAuth();
  const [share, setShare] = useState<CreatedShare | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Create the share when the modal opens with a new conversation.
  useEffect(() => {
    if (!open || !conversationId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      setShare(null);
      setCopied(false);
      try {
        const token = await getToken();
        if (!token) throw new Error('Not authenticated');
        const res = await fetch(`${API_URL}/api/me/shares`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ conversationId, showOwnerName: true }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(err.error ?? `Failed to share (${res.status})`);
        }
        const data = (await res.json()) as {
          share: { shareToken: string };
        };
        if (!cancelled) {
          setShare({ shareToken: data.share.shareToken });
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to create share',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, conversationId, getToken]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const shareUrl = share
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/share/${share.shareToken}`
    : '';

  const copy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can fail in non-secure contexts; surface gently.
      setError('Could not copy. Select the URL and copy manually.');
    }
  };

  const revoke = async () => {
    if (!share) return;
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(
        `${API_URL}/api/me/shares/${share.shareToken}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok && res.status !== 204) {
        throw new Error(`Failed to revoke (${res.status})`);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.scope}>
      <div className={styles.backdrop} onClick={onClose}>
        <div
          className={styles.modal}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="share-modal-title"
        >
          <header className={styles.header}>
            <h2 id="share-modal-title" className={styles.title}>
              Share this chat
            </h2>
            <button
              type="button"
              className={styles.close}
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          </header>

          <div className={styles.body}>
            <p className={styles.subtitle}>
              {conversationTitle?.trim() || 'Untitled chat'}
            </p>
            <p className={styles.note}>
              Anyone with the link can read this chat. You can revoke access
              anytime. Search engines won&apos;t index it.
            </p>

            {loading && !share && (
              <div className={styles.spinner}>Creating link…</div>
            )}

            {error && <div className={styles.error}>{error}</div>}

            {share && (
              <>
                <div className={styles.urlRow}>
                  <input
                    type="text"
                    readOnly
                    className={styles.urlInput}
                    value={shareUrl}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button
                    type="button"
                    className={styles.copyBtn}
                    onClick={copy}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>

                <div className={styles.actions}>
                  <a
                    href={shareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.previewLink}
                  >
                    Preview →
                  </a>
                  <button
                    type="button"
                    className={styles.revoke}
                    onClick={revoke}
                    disabled={loading}
                  >
                    Revoke access
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
