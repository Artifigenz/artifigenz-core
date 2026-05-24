'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { AGENTS } from '@artifigenz/shared';
import { useActivatedAgents, agentSlug } from '@/hooks/useActivatedAgents';
import ModelPicker from './ModelPicker';
import styles from './ChatInput.module.css';

export interface ChatAttachmentDraft {
  fileId: string;
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  extension?: string;
  /** Local preview URL (object URL) shown before/after upload. */
  previewUrl?: string;
  /** Upload state. */
  status: 'uploading' | 'ready' | 'error';
  error?: string;
  /** Epoch ms when first added — used to sort chips in insertion order. */
  createdAt: number;
}

export interface PasteSnippetDraft {
  id: string;
  content: string;
  firstLine?: string;
  /** Epoch ms when first added — used to sort chips in insertion order. */
  createdAt: number;
}

/** Pastes larger than this become "snippet" chips instead of inline text. */
export const PASTE_SNIPPET_THRESHOLD = 1500;

interface ChatInputProps {
  agent?: string;
  value?: string;
  onChange?: (value: string) => void;
  onSend?: () => void;
  disabled?: boolean;
  /** When true, the send button shows a stop icon and calls onStop instead. */
  streaming?: boolean;
  onStop?: () => void;
  attachments?: ChatAttachmentDraft[];
  onAddFiles?: (files: File[]) => void;
  onRemoveAttachment?: (fileId: string) => void;
  pasteSnippets?: PasteSnippetDraft[];
  onAddPasteSnippet?: (text: string) => void;
  onRemovePasteSnippet?: (id: string) => void;
  /** Chat-mode helpers. Shown in the toolbar / + menu when present. */
  onNewChat?: () => void;
  onShowHistory?: () => void;
  /** Selected model id; shown in the right-side picker. */
  modelId?: string;
  onModelChange?: (id: string) => void;
}

export default function ChatInput({ agent, value, onChange, onSend, onStop, disabled, streaming, attachments, onAddFiles, onRemoveAttachment, pasteSnippets, onAddPasteSnippet, onRemovePasteSnippet, onNewChat, onShowHistory, modelId, onModelChange }: ChatInputProps) {
  const { slugs } = useActivatedAgents();
  const activeAgents = AGENTS.filter((a) => slugs.includes(agentSlug(a.name)));
  const [menuOpen, setMenuOpen] = useState(false);
  const [agentFlyout, setAgentFlyout] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0 || !onAddFiles) return;
    onAddFiles(Array.from(files));
  };

  // Auto-grow the textarea to fit its content. CSS `max-height` caps it at
  // ~10 lines and switches to scroll when content exceeds that.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [value]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setAgentFlyout(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Agent-scoped mode
  if (agent) {
    return (
      <div className={styles.bar}>
        <div className={styles.inner}>
          <div className={styles.compactBox}>
            <div className={styles.addWrap} ref={menuRef}>
              <button
                className={styles.addBtn}
                aria-label="Add"
                onClick={() => setMenuOpen(!menuOpen)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              {menuOpen && (
                <div className={styles.menu}>
                  <button className={styles.menuItem} onClick={() => setMenuOpen(false)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                    <span>Add files or images</span>
                  </button>
                </div>
              )}
            </div>
            <input
              type="text"
              className={styles.compactInput}
              placeholder={`Ask ${agent}...`}
            />
            <button className={styles.compactSend} aria-label="Send">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Full mode (homepage)
  return (
    <div className={styles.bar}>
      <div className={styles.inner}>
        <div
          className={styles.box}
          onDragOver={(e) => {
            if (!onAddFiles) return;
            if (e.dataTransfer?.types?.includes('Files')) {
              e.preventDefault();
            }
          }}
          onDrop={(e) => {
            if (!onAddFiles) return;
            const files = e.dataTransfer?.files;
            if (files && files.length > 0) {
              e.preventDefault();
              handleFiles(files);
            }
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
            multiple
            hidden
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <AttachmentBar
            snippets={pasteSnippets ?? []}
            attachments={attachments ?? []}
            onRemoveSnippet={onRemovePasteSnippet}
            onRemoveAttachment={onRemoveAttachment}
          />
          <textarea
            ref={textareaRef}
            className={styles.input}
            placeholder={selectedAgent ? `Ask ${selectedAgent}...` : 'Ask anything or give a task...'}
            rows={1}
            value={value ?? ''}
            onChange={(e) => onChange?.(e.target.value)}
            onPaste={(e) => {
              // 1. Files in the clipboard (image copy, file copy) become
              //    attachments — intercept before any text fallback runs.
              if (onAddFiles && e.clipboardData.files.length > 0) {
                e.preventDefault();
                handleFiles(e.clipboardData.files);
                return;
              }
              // 2. Long text pastes become snippet chips.
              if (onAddPasteSnippet) {
                const text = e.clipboardData.getData('text');
                if (text.length >= PASTE_SNIPPET_THRESHOLD) {
                  e.preventDefault();
                  onAddPasteSnippet(text);
                }
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!streaming && !disabled && (value ?? '').trim()) onSend?.();
              }
            }}
            disabled={disabled}
          />
          <div className={styles.toolbar}>
            <div className={styles.toolbarLeft}>
            <div className={styles.addWrap} ref={menuRef}>
              <button
                className={styles.addBtn}
                aria-label="Add"
                onClick={() => { setMenuOpen(!menuOpen); setAgentFlyout(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              {menuOpen && (
                <div className={styles.menu}>
                  {onNewChat && (
                    <button
                      className={styles.menuItem}
                      onClick={() => {
                        setMenuOpen(false);
                        onNewChat();
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="12" y1="12" x2="12" y2="18" />
                        <line x1="9" y1="15" x2="15" y2="15" />
                      </svg>
                      <span>New chat</span>
                    </button>
                  )}
                  <button
                    className={styles.menuItem}
                    onClick={() => {
                      setMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                    <span>Add files or images</span>
                  </button>
                  <div className={styles.menuItemWrap}>
                    <button className={styles.menuItem} onClick={() => setAgentFlyout(!agentFlyout)}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                      <span>Agents</span>
                      <svg className={styles.chevron} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                    {agentFlyout && (
                      <div className={styles.flyout}>
                        {activeAgents.map((a) => (
                          <button
                            key={a.name}
                            className={styles.flyoutItem}
                            onClick={() => { setSelectedAgent(a.name); setMenuOpen(false); setAgentFlyout(false); }}
                          >
                            <span className={styles.flyoutDot} />
                            {a.name}
                          </button>
                        ))}
                        {activeAgents.length > 0 && <div className={styles.flyoutDivider} />}
                        <Link
                          href="/explore"
                          className={styles.flyoutExplore}
                          onClick={() => { setMenuOpen(false); setAgentFlyout(false); }}
                        >
                          {activeAgents.length === 0 ? 'Browse agents →' : 'Add agents →'}
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            {onShowHistory && (
              <button
                type="button"
                className={styles.toolBtn}
                onClick={onShowHistory}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span>History</span>
              </button>
            )}
            {selectedAgent && (
              <span className={styles.selectedChip}>
                <span className={styles.flyoutDot} />
                {selectedAgent}
                <button
                  className={styles.selectedRemove}
                  onClick={() => setSelectedAgent(null)}
                  aria-label="Remove agent"
                >
                  ×
                </button>
              </span>
            )}
            </div>
            <div className={styles.toolbarRight}>
              {modelId && onModelChange && (
                <ModelPicker value={modelId} onChange={onModelChange} />
              )}
            {streaming ? (
              <button
                className={styles.sendBtn}
                aria-label="Stop generating"
                onClick={() => onStop?.()}
                type="button"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                className={styles.sendBtn}
                aria-label="Send"
                onClick={() => {
                  if (!disabled && (value ?? '').trim()) onSend?.();
                }}
                disabled={disabled || !(value ?? '').trim()}
                type="button"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </button>
            )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatChars(n: number): string {
  if (n < 1000) return `${n} chars`;
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k chars`;
}

// ── Attachment bar (combined paste snippets + file attachments) ──────────
// Renders a single horizontal row of chips. If more chips than fit, the
// trailing ones collapse into a "+N" overflow chip that opens a flyout
// listing the rest.

type Item =
  | { kind: 'snippet'; data: PasteSnippetDraft }
  | { kind: 'file'; data: ChatAttachmentDraft };

interface AttachmentBarProps {
  snippets: PasteSnippetDraft[];
  attachments: ChatAttachmentDraft[];
  onRemoveSnippet?: (id: string) => void;
  onRemoveAttachment?: (fileId: string) => void;
}

function AttachmentBar({
  snippets,
  attachments,
  onRemoveSnippet,
  onRemoveAttachment,
}: AttachmentBarProps) {
  // Merge both lists and sort by createdAt so the first thing the user
  // attached/pasted shows up first in the chip row.
  const items: Item[] = [
    ...attachments.map((a): Item => ({ kind: 'file', data: a })),
    ...snippets.map((s): Item => ({ kind: 'snippet', data: s })),
  ].sort((a, b) => {
    const ta = a.kind === 'file' ? a.data.createdAt : a.data.createdAt;
    const tb = b.kind === 'file' ? b.data.createdAt : b.data.createdAt;
    return ta - tb;
  });
  const barRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowWrapRef = useRef<HTMLDivElement>(null);

  // Recompute how many chips fit in one row. Measures against the BAR's
  // outer width (not the row's, which is clipped) so the math is stable
  // whether or not the +N pill is currently rendered.
  useEffect(() => {
    if (items.length === 0) return;
    const bar = barRef.current;
    const measure = measureRef.current;
    if (!bar || !measure) return;

    const compute = () => {
      const containerWidth = bar.clientWidth;
      if (containerWidth === 0) return;
      // Reserve room for the +N pill (≈ 44px chip + 8 gap).
      const reservedForOverflow = 56;
      const children = Array.from(measure.children) as HTMLElement[];
      let used = 0;
      let fits = 0;
      for (let i = 0; i < children.length; i++) {
        const w = children[i].offsetWidth + 8; // 8 = gap
        const isLast = i === children.length - 1;
        const cap = isLast ? containerWidth : containerWidth - reservedForOverflow;
        if (used + w > cap) break;
        used += w;
        fits++;
      }
      setVisibleCount(Math.max(fits, 0));
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [items.length, snippets, attachments]);

  // Click-outside close for the overflow flyout
  useEffect(() => {
    if (!overflowOpen) return;
    const handle = (e: MouseEvent) => {
      if (
        overflowWrapRef.current &&
        !overflowWrapRef.current.contains(e.target as Node)
      ) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [overflowOpen]);

  if (items.length === 0) return null;

  const visible = items.slice(0, visibleCount);
  const overflow = items.slice(visibleCount);

  return (
    <div ref={barRef} className={styles.attachmentBar}>
      <div className={styles.attachmentBarFlex}>
        {/* Visible chips — overflow:hidden clips anything that doesn't fit,
            but the +N chip lives OUTSIDE this clip zone (next sibling) so
            its flyout can render above the row uncllipped. */}
        <div ref={rowRef} className={styles.attachmentsRow}>
          {visible.map((item) => (
            <AttachmentChip
              key={chipKey(item)}
              item={item}
              onRemoveSnippet={onRemoveSnippet}
              onRemoveAttachment={onRemoveAttachment}
            />
          ))}
        </div>
        {overflow.length > 0 && (
          <div className={styles.overflowWrap} ref={overflowWrapRef}>
            <button
              type="button"
              className={styles.overflowChip}
              onClick={() => setOverflowOpen((v) => !v)}
              aria-label={`${overflow.length} more attachment${overflow.length === 1 ? '' : 's'}`}
            >
              +{overflow.length}
            </button>
            {overflowOpen && (
              <div className={styles.overflowFlyout}>
                {overflow.map((item) => (
                  <AttachmentChip
                    key={chipKey(item)}
                    item={item}
                    onRemoveSnippet={onRemoveSnippet}
                    onRemoveAttachment={onRemoveAttachment}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {/* Hidden measurement row — all items at natural width */}
      <div
        ref={measureRef}
        className={styles.attachmentsMeasure}
        aria-hidden
      >
        {items.map((item) => (
          <AttachmentChip
            key={chipKey(item)}
            item={item}
            onRemoveSnippet={onRemoveSnippet}
            onRemoveAttachment={onRemoveAttachment}
          />
        ))}
      </div>
    </div>
  );
}

function chipKey(item: Item): string {
  return item.kind === 'snippet'
    ? `s-${item.data.id}`
    : `f-${item.data.fileId}`;
}

function AttachmentChip({
  item,
  onRemoveSnippet,
  onRemoveAttachment,
}: {
  item: Item;
  onRemoveSnippet?: (id: string) => void;
  onRemoveAttachment?: (fileId: string) => void;
}) {
  if (item.kind === 'snippet') {
    const s = item.data;
    return (
      <div className={styles.attachmentChip}>
        <span className={styles.attachmentIcon} aria-hidden>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="9" y1="13" x2="15" y2="13" />
            <line x1="9" y1="17" x2="15" y2="17" />
          </svg>
        </span>
        <span
          className={styles.attachmentName}
          title={s.firstLine ?? `${s.content.length} chars`}
        >
          Pasted text · {formatChars(s.content.length)}
        </span>
        <button
          type="button"
          className={styles.attachmentRemove}
          aria-label="Remove pasted text"
          onClick={() => onRemoveSnippet?.(s.id)}
        >
          ×
        </button>
      </div>
    );
  }

  const a = item.data;
  return (
    <div className={styles.attachmentChip}>
      {a.previewUrl && a.mimeType.startsWith('image/') ? (
        <img
          src={a.previewUrl}
          alt={a.filename}
          className={styles.attachmentThumb}
        />
      ) : (
        <span className={styles.attachmentIcon} aria-hidden>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </span>
      )}
      <span className={styles.attachmentName} title={a.filename}>
        {a.filename}
      </span>
      {a.status === 'uploading' && (
        <span className={styles.attachmentStatus}>uploading…</span>
      )}
      {a.status === 'error' && (
        <span className={styles.attachmentStatusError}>
          {a.error ?? 'failed'}
        </span>
      )}
      <button
        type="button"
        className={styles.attachmentRemove}
        aria-label="Remove attachment"
        onClick={() => onRemoveAttachment?.(a.fileId)}
      >
        ×
      </button>
    </div>
  );
}
