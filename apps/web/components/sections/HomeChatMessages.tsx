'use client';

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MODELS } from '@artifigenz/shared';
import styles from './HomeChatMessages.module.css';

export interface ChatCitation {
  url: string;
  title: string;
  citedText?: string;
}

export interface ChatAttachment {
  fileId: string;
  filename: string;
  mimeType: string;
  sizeBytes?: number;
}

export interface PasteSnippet {
  id: string;
  content: string;
  firstLine?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** DB-side id, attached after the server confirms the message. */
  serverId?: string;
  citations?: ChatCitation[];
  attachments?: ChatAttachment[];
  pasteSnippets?: PasteSnippet[];
}

interface Props {
  messages: ChatMessage[];
  streaming: boolean;
  toolStatus: string | null;
  onEdit: (messageId: string, newText: string) => void;
  onRegenerate: (messageId: string, overrideModelId?: string) => void;
}

export default function HomeChatMessages({
  messages,
  streaming,
  toolStatus,
  onEdit,
  onRegenerate,
}: Props) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const distanceFromBottom =
      document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
    if (distanceFromBottom < 240) {
      sentinel.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, [messages, toolStatus]);

  const lastMessage = messages[messages.length - 1];
  const lastIsEmptyAssistant =
    lastMessage?.role === 'assistant' && lastMessage.content === '';
  const showStatus = streaming && (lastIsEmptyAssistant || toolStatus !== null);
  const statusLabel = toolStatus ?? 'Thinking';

  return (
    <section className={styles.section}>
      <div className={styles.list}>
        {messages.map((msg, idx) => {
          if (msg.role === 'assistant' && msg.content === '' && streaming) {
            return null;
          }
          const isLast = idx === messages.length - 1;
          const isLastAssistant =
            msg.role === 'assistant' && idx === messages.length - 1;
          const isBeingStreamed = streaming && isLastAssistant;

          // User message — inline edit mode
          if (msg.role === 'user' && editingId === msg.id) {
            return (
              <EditingRow
                key={msg.id}
                initialValue={msg.content}
                disabled={!msg.serverId}
                onCancel={() => setEditingId(null)}
                onSave={(newText) => {
                  setEditingId(null);
                  if (newText.trim() && newText !== msg.content) {
                    onEdit(msg.id, newText.trim());
                  }
                }}
              />
            );
          }

          return (
            <div key={msg.id} className={`${styles.row} ${styles[msg.role]}`}>
              <div className={styles.bubbleWrap}>
                <div className={styles.bubble}>
                  {msg.role === 'assistant' ? (
                    <div className={styles.md}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                      {isBeingStreamed && (
                        <span className={styles.cursor} aria-hidden />
                      )}
                      {!isBeingStreamed &&
                        msg.citations &&
                        msg.citations.length > 0 && (
                          <Citations citations={msg.citations} />
                        )}
                    </div>
                  ) : (
                    <>
                      {msg.attachments && msg.attachments.length > 0 && (
                        <AttachmentList attachments={msg.attachments} />
                      )}
                      {msg.pasteSnippets && msg.pasteSnippets.length > 0 && (
                        <SnippetList snippets={msg.pasteSnippets} />
                      )}
                      {msg.content && (
                        <div className={styles.text}>{msg.content}</div>
                      )}
                    </>
                  )}
                </div>
                {!isBeingStreamed && (
                  <ActionBar
                    role={msg.role}
                    content={msg.content}
                    canEdit={msg.role === 'user' && Boolean(msg.serverId)}
                    canRegenerate={
                      // Any past completed assistant message with a server-side
                      // id is regen-able. We don't gate on the global streaming
                      // flag — overlapping streams are fine.
                      msg.role === 'assistant' && Boolean(msg.serverId)
                    }
                    alwaysVisible={isLast && msg.role === 'assistant'}
                    onCopy={() => copyToClipboard(msg.content)}
                    onEdit={() => setEditingId(msg.id)}
                    onRegenerate={() => onRegenerate(msg.id)}
                    onRetryWithModel={(modelId) => onRegenerate(msg.id, modelId)}
                  />
                )}
              </div>
            </div>
          );
        })}
        {showStatus && (
          <div className={`${styles.row} ${styles.assistant}`}>
            <span className={styles.status}>
              <SparkIcon />
              {statusLabel}
            </span>
          </div>
        )}
        <div ref={sentinelRef} className={styles.sentinel} />
      </div>
    </section>
  );
}

// ── Action bar ────────────────────────────────────────────────────

function ActionBar({
  role,
  canEdit,
  canRegenerate,
  alwaysVisible,
  onCopy,
  onEdit,
  onRegenerate,
  onRetryWithModel,
}: {
  role: 'user' | 'assistant';
  content: string;
  canEdit: boolean;
  canRegenerate: boolean;
  alwaysVisible: boolean;
  onCopy: () => void;
  onEdit: () => void;
  onRegenerate: () => void;
  onRetryWithModel: (modelId: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [retryOpen, setRetryOpen] = useState(false);
  const retryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!retryOpen) return;
    const handle = (e: MouseEvent) => {
      if (retryRef.current && !retryRef.current.contains(e.target as Node)) {
        setRetryOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [retryOpen]);

  const handleCopy = () => {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div
      className={`${styles.actions} ${alwaysVisible ? styles.actionsVisible : ''}`}
    >
      <IconButton
        label={copied ? 'Copied' : 'Copy'}
        onClick={handleCopy}
        active={copied}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </IconButton>
      {role === 'user' && canEdit && (
        <IconButton label="Edit" onClick={onEdit}>
          <PencilIcon />
        </IconButton>
      )}
      {role === 'assistant' && (
        <div className={styles.retryGroup} ref={retryRef}>
          <IconButton
            label="Regenerate"
            onClick={onRegenerate}
            disabled={!canRegenerate}
          >
            <RefreshIcon />
          </IconButton>
          <button
            type="button"
            className={`${styles.iconBtn} ${styles.retryChevron}`}
            aria-label="Retry with a different model"
            title="Try a different model"
            disabled={!canRegenerate}
            onClick={() => setRetryOpen((v) => !v)}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {retryOpen && canRegenerate && (
            <div className={styles.retryMenu}>
              <div className={styles.retryMenuLabel}>Try with</div>
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={styles.retryMenuItem}
                  onClick={() => {
                    setRetryOpen(false);
                    onRetryWithModel(m.id);
                  }}
                >
                  <span className={styles.retryMenuFamily}>{m.family}</span>
                  <span className={styles.retryMenuModel}>{m.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IconButton({
  children,
  label,
  onClick,
  disabled,
  active,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`${styles.iconBtn} ${active ? styles.iconBtnActive : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

// ── Inline edit row ──────────────────────────────────────────────

function EditingRow({
  initialValue,
  disabled,
  onSave,
  onCancel,
}: {
  initialValue: string;
  disabled: boolean;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, []);
  return (
    <div className={`${styles.row} ${styles.user}`}>
      <div className={styles.editBox}>
        <textarea
          ref={taRef}
          className={styles.editArea}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            e.currentTarget.style.height = 'auto';
            e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSave(value);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
        />
        <div className={styles.editButtons}>
          <button
            type="button"
            className={styles.editCancel}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.editSave}
            onClick={() => onSave(value)}
            disabled={disabled || !value.trim() || value === initialValue}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Attachments inside a user bubble ─────────────────────────────

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

function AttachmentList({ attachments }: { attachments: ChatAttachment[] }) {
  return (
    <div className={styles.bubbleAttachments}>
      {attachments.map((a) => {
        const isImage = a.mimeType.startsWith('image/');
        const url = `${API_URL}/api/me/chat/attachments/${a.fileId}`;
        if (isImage) {
          return (
            <a
              key={a.fileId}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.bubbleImage}
            >
              <img src={url} alt={a.filename} />
            </a>
          );
        }
        return (
          <a
            key={a.fileId}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.bubbleFile}
            title={a.filename}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span>{a.filename}</span>
          </a>
        );
      })}
    </div>
  );
}

// ── Pasted snippets (collapsed chips in user bubbles) ────────────

function SnippetList({ snippets }: { snippets: PasteSnippet[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const active = snippets.find((s) => s.id === open) ?? null;
  return (
    <>
      <div className={styles.bubbleSnippets}>
        {snippets.map((s) => (
          <button
            key={s.id}
            type="button"
            className={styles.snippetChip}
            onClick={() => setOpen(s.id)}
            title={s.firstLine ?? `${s.content.length} chars`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="9" y1="13" x2="15" y2="13" />
              <line x1="9" y1="17" x2="15" y2="17" />
            </svg>
            <span className={styles.snippetChipLabel}>
              Pasted text · {formatSnippetSize(s.content.length)}
            </span>
          </button>
        ))}
      </div>
      {active && (
        <SnippetModal snippet={active} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

function SnippetModal({
  snippet,
  onClose,
}: {
  snippet: PasteSnippet;
  onClose: () => void;
}) {
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [onClose]);
  return (
    <div className={styles.snippetBackdrop} onClick={onClose}>
      <div
        className={styles.snippetModal}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.snippetHeader}>
          <span className={styles.snippetTitle}>
            Pasted text · {formatSnippetSize(snippet.content.length)}
          </span>
          <button
            type="button"
            className={styles.snippetClose}
            aria-label="Close"
            onClick={onClose}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <pre className={styles.snippetBody}>{snippet.content}</pre>
      </div>
    </div>
  );
}

function formatSnippetSize(n: number): string {
  if (n < 1000) return `${n} chars`;
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k chars`;
}

// ── Citations ────────────────────────────────────────────────────

function Citations({ citations }: { citations: ChatCitation[] }) {
  return (
    <div className={styles.citations}>
      <div className={styles.citationsLabel}>Sources</div>
      <div className={styles.citationsList}>
        {citations.map((c, i) => (
          <a
            key={`${c.url}-${i}`}
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.citationChip}
            title={c.title}
          >
            <span className={styles.citationIndex}>{i + 1}</span>
            <span className={styles.citationHost}>{hostnameOf(c.url)}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// ── Utility ──────────────────────────────────────────────────────

function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text);
  }
}

// ── Icons (minimal, currentColor) ────────────────────────────────

function SparkIcon() {
  return <span className={styles.statusDot} aria-hidden />;
}

function CopyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

