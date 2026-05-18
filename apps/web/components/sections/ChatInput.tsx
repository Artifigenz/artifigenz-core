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
}

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
  /** Chat-mode helpers. Shown in the toolbar / + menu when present. */
  onNewChat?: () => void;
  onShowHistory?: () => void;
  /** Selected model id; shown in the right-side picker. */
  modelId?: string;
  onModelChange?: (id: string) => void;
}

export default function ChatInput({ agent, value, onChange, onSend, onStop, disabled, streaming, attachments, onAddFiles, onRemoveAttachment, onNewChat, onShowHistory, modelId, onModelChange }: ChatInputProps) {
  const { slugs } = useActivatedAgents();
  const activeAgents = AGENTS.filter((a) => slugs.includes(agentSlug(a.name)));
  const [menuOpen, setMenuOpen] = useState(false);
  const [agentFlyout, setAgentFlyout] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0 || !onAddFiles) return;
    onAddFiles(Array.from(files));
  };

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
        <div className={styles.box}>
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
          {attachments && attachments.length > 0 && (
            <div className={styles.attachments}>
              {attachments.map((a) => (
                <div key={a.fileId} className={styles.attachmentChip}>
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
              ))}
            </div>
          )}
          <textarea
            className={styles.input}
            placeholder={selectedAgent ? `Ask ${selectedAgent}...` : 'Ask anything or give a task...'}
            rows={1}
            value={value ?? ''}
            onChange={(e) => onChange?.(e.target.value)}
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
