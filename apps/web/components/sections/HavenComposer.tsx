'use client';

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { MODELS, findModel } from '@artifigenz/shared';
import styles from './HavenComposer.module.css';

/**
 * Haven composer — pill-by-default, morphs into a rounded card when the
 * content overflows a single line. Matches the design handoff (the
 * thread page wraps the same composer style around the bottom dock).
 *
 * Layout single-line  →  [+] [        textarea        ] [model] [mic] [send]
 * Layout multi-line   →  [           textarea           ]
 *                        [+]                      [model] [mic] [send]
 */

interface HavenComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  modelId?: string;
  onModelChange?: (id: string) => void;
  /** Optional — fires on file picker if provided. */
  onAddFiles?: (files: File[]) => void;
  disabled?: boolean;
  /** Override default placeholder. */
  placeholder?: string;
}

export default function HavenComposer({
  value,
  onChange,
  onSend,
  modelId,
  onModelChange,
  onAddFiles,
  disabled,
  placeholder = 'Ask anything or give a task...',
}: HavenComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [multi, setMulti] = useState(false);

  // Autogrow + single↔multi swap.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const sc = el.scrollHeight;
    const isMulti = value.indexOf('\n') !== -1 || sc > 40;
    setMulti(isMulti);
    el.style.height = isMulti ? `${Math.min(sc, 200)}px` : '36px';
  }, [value]);

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

  const canSend = value.trim().length > 0 && !disabled;
  const currentModel = modelId
    ? findModel(modelId) ?? MODELS[0]
    : MODELS[0];

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) onSend();
    }
  };

  return (
    <div
      ref={wrapRef}
      className={`${styles.composer} ${multi ? styles.multi : ''}`}
    >
      <input
        ref={fileInputRef}
        type="file"
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

      <button
        type="button"
        className={`${styles.iconBtn} ${styles.attach}`}
        onClick={() => fileInputRef.current?.click()}
        disabled={!onAddFiles}
        title="Attach"
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
                {MODELS.map((m) => {
                  const on = m.id === currentModel.id;
                  return (
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
                      <span>{m.label}</span>
                      {m.description && (
                        <span className={styles.modelSub}>{m.description}</span>
                      )}
                    </button>
                  );
                })}
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
