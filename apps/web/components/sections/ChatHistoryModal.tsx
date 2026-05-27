'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { findModel } from '@artifigenz/shared';
import styles from './ChatHistoryModal.module.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface ConversationSummary {
  id: string;
  title: string | null;
  messageCount: number | null;
  pinned: boolean;
  updatedAt: string | null;
  lastUserText: string | null;
  lastAssistantText: string | null;
  lastAssistantModelId: string | null;
  hasAttachments: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (conversationId: string) => void;
  currentConversationId: string | null;
  onCurrentDeleted?: () => void;
}

type Bucket = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'earlier';

const BUCKET_LABEL: Record<Bucket, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  thisWeek: 'This week',
  thisMonth: 'This month',
  earlier: 'Earlier',
};

const BUCKET_ORDER: Bucket[] = ['today', 'yesterday', 'thisWeek', 'thisMonth', 'earlier'];

export default function ChatHistoryModal({
  open,
  onClose,
  onSelect,
  currentConversationId,
  onCurrentDeleted,
}: Props) {
  const { getToken } = useAuth();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // ── Load on open ──────────────────────────────────────────────
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
        setConversations(data.conversations ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, getToken]);

  // ── Reset transient state on close + focus search on open ─────
  useEffect(() => {
    if (!open) {
      setQuery('');
      setEditingId(null);
      setEditValue('');
      setOpenMenuId(null);
    } else {
      const t = setTimeout(() => searchRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [open]);

  // ── ESC to close (or cancel inline edit) ──────────────────────
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (editingId) {
        setEditingId(null);
        setEditValue('');
      } else if (openMenuId) {
        setOpenMenuId(null);
      } else {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose, editingId, openMenuId]);

  // ── Mutations ─────────────────────────────────────────────────
  const patchRow = useCallback(
    async (id: string, updates: { title?: string; pinned?: boolean }) => {
      setBusyId(id);
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch(`${API_URL}/api/me/conversations/${id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(updates),
        });
        if (!res.ok) return;
        setConversations((prev) =>
          prev.map((c) => (c.id === id ? { ...c, ...updates } : c)),
        );
      } finally {
        setBusyId(null);
      }
    },
    [getToken],
  );

  const removeRow = useCallback(
    async (id: string) => {
      if (!confirm('Delete this chat? This cannot be undone.')) return;
      setBusyId(id);
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch(`${API_URL}/api/me/conversations/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok && res.status !== 204) return;
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (id === currentConversationId) onCurrentDeleted?.();
      } finally {
        setBusyId(null);
      }
    },
    [getToken, currentConversationId, onCurrentDeleted],
  );

  const beginRename = (c: ConversationSummary) => {
    setOpenMenuId(null);
    setEditingId(c.id);
    setEditValue(c.title ?? '');
  };

  const commitRename = async () => {
    if (!editingId) return;
    const next = editValue.trim();
    const current = conversations.find((c) => c.id === editingId);
    if (current && next !== (current.title ?? '')) {
      await patchRow(editingId, { title: next });
    }
    setEditingId(null);
    setEditValue('');
  };

  // ── Filter + group ────────────────────────────────────────────
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = conversations.filter((c) => {
      if (!q) return true;
      const haystack = [c.title, c.lastUserText, c.lastAssistantText]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });

    const now = Date.now();
    const day = 86_400_000;
    const buckets: Record<Bucket, ConversationSummary[]> = {
      today: [],
      yesterday: [],
      thisWeek: [],
      thisMonth: [],
      earlier: [],
    };

    for (const c of filtered) {
      if (!c.updatedAt) {
        buckets.earlier.push(c);
        continue;
      }
      const diff = now - new Date(c.updatedAt).getTime();
      if (sameCalendarDay(c.updatedAt, now)) buckets.today.push(c);
      else if (diff < 2 * day) buckets.yesterday.push(c);
      else if (diff < 7 * day) buckets.thisWeek.push(c);
      else if (diff < 30 * day) buckets.thisMonth.push(c);
      else buckets.earlier.push(c);
    }

    // Within each bucket: pinned first, then newest first.
    for (const b of BUCKET_ORDER) {
      buckets[b].sort((a, b2) => {
        if (a.pinned !== b2.pinned) return a.pinned ? -1 : 1;
        return (b2.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
      });
    }

    return buckets;
  }, [conversations, query]);

  const totalShown = useMemo(
    () => BUCKET_ORDER.reduce((sum, b) => sum + grouped[b].length, 0),
    [grouped],
  );

  if (!open) return null;

  return (
    <div className={`${styles.scope} ${styles.backdrop}`} onClick={onClose}>
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="History"
      >
        <header className={styles.header}>
          <h2 className={styles.title}>History</h2>
          <button
            type="button"
            className={styles.close}
            aria-label="Close"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <div className={styles.searchRow}>
          <SearchIcon className={styles.searchIcon} />
          <input
            ref={searchRef}
            type="text"
            className={styles.searchInput}
            placeholder="Search your history"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className={styles.list}>
          {loading && <div className={styles.empty}><p>Loading…</p></div>}
          {error && <div className={styles.empty}><p>{error}</p></div>}
          {!loading && !error && conversations.length === 0 && (
            <div className={styles.empty}>
              <p>No previous chats yet.</p>
              <small>Start a conversation to see it here.</small>
            </div>
          )}
          {!loading && !error && conversations.length > 0 && totalShown === 0 && (
            <div className={styles.empty}>
              <p>No conversations match “<strong>{query}</strong>”.</p>
              <small>Try a different keyword or clear the search.</small>
            </div>
          )}

          {!loading && !error && (() => {
            let globalIdx = 0;
            return BUCKET_ORDER.map((bucket) => {
              const items = grouped[bucket];
              if (items.length === 0) return null;
              return (
                <section key={bucket} className={styles.group}>
                  <div className={styles.groupHead}>
                    <span className={styles.groupLabel}>{BUCKET_LABEL[bucket]}</span>
                    <span className={styles.groupCount}>
                      {String(items.length).padStart(2, '0')}
                    </span>
                    <span className={styles.groupRule} aria-hidden />
                  </div>
                  {items.map((c) => {
                    const i = globalIdx++;
                    return (
                      <Row
                        key={c.id}
                        conv={c}
                        index={i}
                        isCurrent={c.id === currentConversationId}
                        isEditing={editingId === c.id}
                        menuOpen={openMenuId === c.id}
                        editValue={editValue}
                        busy={busyId === c.id}
                        onSelect={() => {
                          if (editingId === c.id || openMenuId === c.id) return;
                          onSelect(c.id);
                          onClose();
                        }}
                        onContinue={() => {
                          onSelect(c.id);
                          onClose();
                        }}
                        onEditChange={setEditValue}
                        onBeginRename={() => beginRename(c)}
                        onCommitRename={commitRename}
                        onCancelRename={() => {
                          setEditingId(null);
                          setEditValue('');
                        }}
                        onToggleMenu={() =>
                          setOpenMenuId((cur) => (cur === c.id ? null : c.id))
                        }
                        onCloseMenu={() => setOpenMenuId(null)}
                        onTogglePin={() => {
                          setOpenMenuId(null);
                          patchRow(c.id, { pinned: !c.pinned });
                        }}
                        onDelete={() => {
                          setOpenMenuId(null);
                          removeRow(c.id);
                        }}
                      />
                    );
                  })}
                </section>
              );
            });
          })()}
        </div>

        <footer className={styles.footer}>
          <span className={styles.footerGroup}>
            <kbd>↑</kbd><kbd>↓</kbd> navigate
          </span>
          <span className={styles.footerGroup}>
            <kbd>↵</kbd> open
          </span>
          <span className={styles.footerGroup}>
            <kbd>/</kbd> search
          </span>
          <span className={styles.footerSpacer} />
          <span className={styles.footerGroup}>
            <kbd>esc</kbd> close
          </span>
        </footer>
      </div>
    </div>
  );
}

// ── Row ────────────────────────────────────────────────────────

interface RowProps {
  conv: ConversationSummary;
  /** 0-based global index across all visible rows — drives the entry cascade. */
  index: number;
  isCurrent: boolean;
  isEditing: boolean;
  menuOpen: boolean;
  editValue: string;
  busy: boolean;
  onSelect: () => void;
  onContinue: () => void;
  onEditChange: (v: string) => void;
  onBeginRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}

function Row({
  conv,
  index,
  isCurrent,
  isEditing,
  menuOpen,
  editValue,
  busy,
  onSelect,
  onContinue,
  onEditChange,
  onBeginRename,
  onCommitRename,
  onCancelRename,
  onToggleMenu,
  onCloseMenu,
  onTogglePin,
  onDelete,
}: RowProps) {
  const menuRef = useRef<HTMLSpanElement | null>(null);
  const modelLabel = conv.lastAssistantModelId
    ? findModel(conv.lastAssistantModelId).label
    : null;
  const count = conv.messageCount ?? 0;

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onCloseMenu();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen, onCloseMenu]);

  const actionsForce = menuOpen || isCurrent;

  return (
    <div
      className={`${styles.row} ${isCurrent ? styles.rowActive : ''} ${busy ? styles.rowBusy : ''} ${menuOpen ? styles.rowMenuOpen : ''}`}
      style={{ ['--i' as never]: index }}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (isEditing) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div className={styles.rowBody}>
        <div className={styles.rowTitleLine}>
          {isEditing ? (
            <input
              autoFocus
              className={styles.renameInput}
              value={editValue}
              onChange={(e) => onEditChange(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') onCommitRename();
                if (e.key === 'Escape') onCancelRename();
              }}
              onBlur={onCommitRename}
              placeholder="Untitled chat"
            />
          ) : (
            <>
              <span className={styles.rowTitle}>
                {conv.title?.trim() || 'Untitled chat'}
              </span>
              {conv.pinned && (
                <span className={styles.pinMark} aria-label="Pinned">
                  <PinIcon filled size={12} />
                </span>
              )}
            </>
          )}
        </div>
        <div className={styles.rowMeta}>
          {modelLabel && <span>{modelLabel}</span>}
          {modelLabel && <span className={styles.metaDot} />}
          <span>{count} {count === 1 ? 'message' : 'messages'}</span>
          {conv.updatedAt && (
            <>
              <span className={styles.metaDot} />
              <span>{formatDate(conv.updatedAt)}</span>
            </>
          )}
          {conv.hasAttachments && (
            <>
              <span className={styles.metaDot} />
              <span className={styles.metaAttach} aria-label="Has attachments">
                <AttachIcon /> file
              </span>
            </>
          )}
        </div>
      </div>

      <div
        className={`${styles.actions} ${actionsForce ? styles.actionsForce : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <span className={styles.menuWrap} ref={menuRef}>
          <button
            type="button"
            className={`${styles.iconBtn} ${menuOpen ? styles.iconBtnOn : ''}`}
            aria-label="More"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={onToggleMenu}
            disabled={busy}
          >
            <MoreIcon />
          </button>
          {menuOpen && (
            <div className={styles.menu} role="menu">
              <button
                type="button"
                className={styles.menuItem}
                onClick={onTogglePin}
                role="menuitem"
              >
                <PinIcon filled={conv.pinned} size={14} />
                <span>{conv.pinned ? 'Unpin from top' : 'Pin to top'}</span>
              </button>
              <button
                type="button"
                className={styles.menuItem}
                onClick={onBeginRename}
                role="menuitem"
              >
                <EditIcon />
                <span>Rename</span>
              </button>
              <div className={styles.menuSep} />
              <button
                type="button"
                className={`${styles.menuItem} ${styles.menuItemDanger}`}
                onClick={onDelete}
                role="menuitem"
              >
                <TrashIcon />
                <span>Delete</span>
              </button>
            </div>
          )}
        </span>

        <button
          type="button"
          className={styles.continueBtn}
          onClick={(e) => {
            e.stopPropagation();
            onContinue();
          }}
        >
          Continue <ArrowRightIcon />
        </button>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────

function sameCalendarDay(iso: string, nowMs: number): boolean {
  const d = new Date(iso);
  const n = new Date(nowMs);
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const day = 86_400_000;
  if (diffMs < day && sameCalendarDay(iso, now.getTime())) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  if (diffMs < 7 * day) {
    return d.toLocaleDateString([], { weekday: 'short' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ── Icons ──────────────────────────────────────────────────────

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

function PinIcon({ filled, size = 14 }: { filled?: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 2 L15 8 L21 9 L17 14 L18 21 L12 17 L6 21 L7 14 L3 9 L9 8 Z" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function AttachIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}
