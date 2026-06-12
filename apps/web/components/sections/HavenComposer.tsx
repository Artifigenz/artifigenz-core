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
import { DEFAULT_INTELLIGENCE, type Intelligence } from '@artifigenz/shared';
import type {
  ChatAttachmentDraft,
  PasteSnippetDraft,
} from './ChatInput';
import AttachmentBar from './AttachmentBar';
import ModelPicker from './ModelPicker';
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
  intelligence?: Intelligence;
  onIntelligenceChange?: (intel: Intelligence) => void;
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
  intelligence,
  onIntelligenceChange,
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
  // Local intelligence fallback for callers that haven't lifted it into state
  // yet (e.g. older entry points). The page.tsx top-level provides controlled
  // values; ChatInput-style callers fall back to this local copy.
  const [localIntelligence, setLocalIntelligence] = useState<Intelligence>(
    DEFAULT_INTELLIGENCE,
  );
  const intel = intelligence ?? localIntelligence;
  const setIntel = onIntelligenceChange ?? setLocalIntelligence;
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

  const canSend =
    (value.trim().length > 0 ||
      (attachments?.some((a) => a.status === 'ready') ?? false) ||
      (pasteSnippets?.length ?? 0) > 0) &&
    !disabled &&
    !streaming;

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
          <AttachmentBar
            attachments={attachments ?? []}
            snippets={pasteSnippets ?? []}
            onRemoveAttachment={onRemoveAttachment}
            onRemoveSnippet={onRemovePasteSnippet}
          />
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
        {onModelChange && modelId && (
          <div className={styles.modelWrap}>
            <ModelPicker
              modelId={modelId}
              intelligence={intel}
              onModelChange={onModelChange}
              onIntelligenceChange={setIntel}
            />
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
