'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { MODELS, findModel } from '@artifigenz/shared';
import type {
  ChatAttachmentDraft,
  PasteSnippetDraft,
} from './ChatInput';
import styles from './HavenComposer.module.css';

/**
 * Haven composer — pill-by-default, morphs into a rounded card when the
 * content overflows a single line. Matches the design handoff (the
 * thread page wraps the same composer style around the bottom dock).
 *
 * Layout single-line  →  [+] [        textarea        ] [model] [mic] [send]
 * Layout multi-line   →  [           textarea           ]
 *                        [+]                      [model] [mic] [send]
 *
 * Attachment + paste-snippet chips render in a row above the input grid
 * area when present; the composer auto-expands into multi-line layout so
 * the chips have room to sit.
 */

/** Pastes larger than this become "snippet" chips instead of inline text. */
export const PASTE_SNIPPET_THRESHOLD = 1500;

interface HavenComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  modelId?: string;
  onModelChange?: (id: string) => void;
  /** Optional — fires on file picker if provided. */
  onAddFiles?: (files: File[]) => void;
  /** Existing attachment drafts shown as chips above the input. */
  attachments?: ChatAttachmentDraft[];
  onRemoveAttachment?: (fileId: string) => void;
  /** Existing paste-snippet drafts shown as chips above the input. */
  pasteSnippets?: PasteSnippetDraft[];
  onAddPasteSnippet?: (text: string) => void;
  onRemovePasteSnippet?: (id: string) => void;
  disabled?: boolean;
  /** When true the send button morphs to a stop control and calls onStop. */
  streaming?: boolean;
  onStop?: () => void;
  /** Override default placeholder. */
  placeholder?: string;
  /**
   * When true, the composer sits in the home intro stage: narrower
   * resting pill (680px), gentle widen-on-focus to 724px, soft shadow
   * lift. When false (dock under a thread), keeps a fixed 760px width.
   */
  homeStage?: boolean;
}

export default function HavenComposer({
  value,
  onChange,
  onSend,
  modelId,
  onModelChange,
  onAddFiles,
  attachments,
  onRemoveAttachment,
  pasteSnippets,
  onAddPasteSnippet,
  onRemovePasteSnippet,
  disabled,
  streaming = false,
  onStop,
  placeholder = 'Ask anything or give a task...',
  homeStage = false,
}: HavenComposerProps) {
  const hasChips =
    (attachments?.length ?? 0) > 0 || (pasteSnippets?.length ?? 0) > 0;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [multi, setMulti] = useState(false);
  const [focused, setFocused] = useState(false);
  // Mirror of `multi` so the autogrow effect can read the current value
  // without re-running every time it flips — that re-run is what caused
  // the size jitter (toggle multi → width changes → scrollHeight changes
  // → toggle flips back).
  const multiRef = useRef(false);

  // Autogrow + single↔multi swap with hysteresis.
  //   - Enter multi on a real newline, scrollHeight > 44, OR any chips present.
  //   - Stay multi until the field is empty AND no chips remain.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const sc = el.scrollHeight;
    let next = multiRef.current;
    if (!next) {
      if (value.indexOf('\n') !== -1 || sc > 44 || hasChips) next = true;
    } else if (value.length === 0 && !hasChips) {
      next = false;
    }
    if (next !== multiRef.current) {
      multiRef.current = next;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMulti(next);
    }
    el.style.height = next ? `${Math.min(el.scrollHeight, 240)}px` : '36px';
  }, [value, hasChips]);

  // After the multi class commits, the input width changes (full row vs
  // shared row), so the height we set in the value effect above reflects
  // the *old* layout — leaving empty space below the cursor. Re-measure
  // here so the textarea snaps to the right height immediately.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = multi ? `${Math.min(el.scrollHeight, 240)}px` : '36px';
  }, [multi]);

  // Click-outside closes the model menu.
  useEffect(() => {
    if (!modelOpen) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!wrapRef.current?.contains(target)) setModelOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [modelOpen]);

  const canSend =
    (value.trim().length > 0 ||
      (attachments?.some((a) => a.status === 'ready') ?? false) ||
      (pasteSnippets?.length ?? 0) > 0) &&
    !disabled &&
    !streaming;
  const currentModel = modelId
    ? findModel(modelId) ?? MODELS[0]
    : MODELS[0];

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) onSend();
    }
  };

  // Paste: files in the clipboard become attachments; pastes over the
  // threshold become snippet chips so they don't blow up the textarea.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (onAddFiles && e.clipboardData.files.length > 0) {
      e.preventDefault();
      onAddFiles(Array.from(e.clipboardData.files));
      return;
    }
    if (onAddPasteSnippet) {
      const text = e.clipboardData.getData('text');
      if (text.length >= PASTE_SNIPPET_THRESHOLD) {
        e.preventDefault();
        onAddPasteSnippet(text);
      }
    }
  };

  // Drag-and-drop files anywhere on the composer.
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!onAddFiles) return;
    if (e.dataTransfer.types.includes('Files')) e.preventDefault();
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!onAddFiles) return;
    if (e.dataTransfer.files.length > 0) {
      e.preventDefault();
      onAddFiles(Array.from(e.dataTransfer.files));
    }
  };

  const classes = [
    styles.composer,
    multi ? styles.multi : '',
    focused ? styles.focus : '',
    homeStage ? styles.homeStage : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={wrapRef}
      className={classes}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
        multiple
        hidden
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0 && onAddFiles) {
            onAddFiles(Array.from(files));
            if (fileInputRef.current) fileInputRef.current.value = '';
          }
        }}
      />

      {hasChips && (
        <div className={styles.chipsRow}>
          {attachments?.map((a) => (
            <AttachmentChip
              key={`a-${a.fileId}`}
              attachment={a}
              onRemove={onRemoveAttachment}
            />
          ))}
          {pasteSnippets?.map((s) => (
            <SnippetChip
              key={`s-${s.id}`}
              snippet={s}
              onRemove={onRemovePasteSnippet}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        className={`${styles.iconBtn} ${styles.attach}`}
        onClick={() => fileInputRef.current?.click()}
        disabled={!onAddFiles}
        title="Attach files or images"
        aria-label="Attach files"
      >
        <PlusIcon />
      </button>

      <textarea
        ref={textareaRef}
        className={styles.input}
        rows={1}
        placeholder={placeholder}
        value={value}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
          onChange(e.target.value)
        }
        onKeyDown={onKey}
        onPaste={onPaste}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoFocus
      />

      <div className={styles.tools}>
        {onModelChange && (
          <div className={styles.modelWrap}>
            <button
              type="button"
              className={styles.model}
              onClick={() => setModelOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={modelOpen}
            >
              <span>{currentModel.label}</span>
              <ChevronDownIcon />
            </button>
            {modelOpen && (
              <div className={styles.modelMenu} role="menu">
                {(() => {
                  const out: ReactNode[] = [];
                  let lastFamily: string | null = null;
                  MODELS.forEach((m) => {
                    if (m.family !== lastFamily) {
                      const spaced = lastFamily !== null;
                      lastFamily = m.family;
                      out.push(
                        <div
                          key={`g-${m.family}`}
                          className={`${styles.modelGroup} ${spaced ? styles.modelGroupSpaced : ''}`}
                        >
                          {m.family}
                        </div>,
                      );
                    }
                    const on = m.id === currentModel.id;
                    out.push(
                      <button
                        type="button"
                        key={m.id}
                        role="menuitem"
                        className={`${styles.modelItem} ${on ? styles.modelItemOn : ''}`}
                        onClick={() => {
                          onModelChange(m.id);
                          setModelOpen(false);
                        }}
                      >
                        <span className={styles.modelName}>{m.label}</span>
                        <span className={styles.modelCheck}>
                          <CheckIcon />
                        </span>
                        {m.description && (
                          <span className={styles.modelSub}>{m.description}</span>
                        )}
                      </button>,
                    );
                  });
                  return out;
                })()}
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          className={styles.iconBtn}
          title="Dictate"
          aria-label="Dictate"
          disabled
        >
          <MicIcon />
        </button>
        {streaming && onStop ? (
          <button
            type="button"
            className={styles.send}
            onClick={onStop}
            title="Stop generating"
            aria-label="Stop generating"
          >
            <StopIcon />
          </button>
        ) : (
          <button
            type="button"
            className={styles.send}
            onClick={onSend}
            disabled={!canSend}
            title="Send"
            aria-label="Send message"
          >
            <SendIcon />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Chip subcomponents ────────────────────────────────────────────────

function AttachmentChip({
  attachment: a,
  onRemove,
}: {
  attachment: ChatAttachmentDraft;
  onRemove?: (fileId: string) => void;
}) {
  return (
    <div
      className={`${styles.chip} ${
        a.status === 'error' ? styles.chipError : ''
      }`}
    >
      {a.previewUrl && a.mimeType.startsWith('image/') ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={a.previewUrl}
          alt={a.filename}
          className={styles.chipThumb}
        />
      ) : (
        <span className={styles.chipIcon} aria-hidden>
          <FileIcon />
        </span>
      )}
      <span className={styles.chipName} title={a.filename}>
        {a.filename}
      </span>
      {a.status === 'uploading' && (
        <span className={styles.chipStatus}>uploading…</span>
      )}
      {a.status === 'error' && (
        <span className={styles.chipStatusErr}>{a.error ?? 'failed'}</span>
      )}
      {onRemove && (
        <button
          type="button"
          className={styles.chipRemove}
          onClick={() => onRemove(a.fileId)}
          aria-label={`Remove ${a.filename}`}
        >
          ×
        </button>
      )}
    </div>
  );
}

function SnippetChip({
  snippet: s,
  onRemove,
}: {
  snippet: PasteSnippetDraft;
  onRemove?: (id: string) => void;
}) {
  return (
    <div className={styles.chip}>
      <span className={styles.chipIcon} aria-hidden>
        <FileIcon />
      </span>
      <span
        className={styles.chipName}
        title={s.firstLine ?? `${s.content.length} chars`}
      >
        Pasted text · {formatChars(s.content.length)}
      </span>
      {onRemove && (
        <button
          type="button"
          className={styles.chipRemove}
          onClick={() => onRemove(s.id)}
          aria-label="Remove pasted text"
        >
          ×
        </button>
      )}
    </div>
  );
}

function formatChars(n: number): string {
  if (n < 1000) return `${n} chars`;
  return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k chars`;
}

function PlusIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6,9 12,15 18,9" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5,12 12,5 19,12" />
    </svg>
  );
}
