'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import styles from './ChatHistoryModal.module.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface ConversationSummary {
  id: string;
  title: string | null;
  messageCount: number | null;
  updatedAt: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (conversationId: string) => void;
  currentConversationId: string | null;
}

export default function ChatHistoryModal({
  open,
  onClose,
  onSelect,
  currentConversationId,
}: Props) {
  const { getToken } = useAuth();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        if (!token) throw new Error('Not authenticated');
        const res = await fetch(`${API_URL}/api/me/conversations`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        // Server returns oldest-first; show newest-first.
        const sorted = [...(data.conversations ?? [])].sort((a, b) =>
          (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''),
        );
        setConversations(sorted);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, getToken]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>History</h2>
          <button
            type="button"
            className={styles.close}
            aria-label="Close"
            onClick={onClose}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className={styles.list}>
          {loading && <div className={styles.empty}>Loading…</div>}
          {error && <div className={styles.empty}>{error}</div>}
          {!loading && !error && conversations.length === 0 && (
            <div className={styles.empty}>No previous chats yet.</div>
          )}
          {!loading &&
            !error &&
            conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`${styles.item} ${c.id === currentConversationId ? styles.itemActive : ''}`}
                onClick={() => {
                  onSelect(c.id);
                  onClose();
                }}
              >
                <span className={styles.itemTitle}>
                  {c.title?.trim() || 'Untitled chat'}
                </span>
                <span className={styles.itemMeta}>
                  {c.updatedAt ? formatDate(c.updatedAt) : ''}
                </span>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const day = 86_400_000;
  if (diffMs < day) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  if (diffMs < 7 * day) {
    return d.toLocaleDateString([], { weekday: 'short' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
