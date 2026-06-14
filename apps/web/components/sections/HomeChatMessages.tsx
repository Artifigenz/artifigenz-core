'use client';

import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '@clerk/nextjs';
import { MODELS, findModel } from '@artifigenz/shared';
import ArtifigenzMark from '@/components/brand/ArtifigenzMark';
import styles from './HomeChatMessages.module.css';
import {
  useReadAloudPlayer,
  type ReadAloudController,
} from './useReadAloudPlayer';

// ── Per-word fade-in for streaming markdown ─────────────────────────
// Splits text into word-keyed spans so React reconciliation keeps already
// rendered words mounted (no re-animation) while only new trailing words
// mount fresh and play the fade keyframe. Inline code / pre / images are
// left untouched. Keys are position-based so the last partial word can grow
// char-by-char without re-mounting.

function splitTextToFadeSpans(text: string): ReactNode[] {
  if (!text) return [];
  const tokens = text.split(/(\s+)/);
  const out: ReactNode[] = [];
  let wordIdx = 0;
  for (const tok of tokens) {
    if (tok === '') continue;
    if (/^\s+$/.test(tok)) {
      out.push(tok);
    } else {
      out.push(
        <span key={`w${wordIdx}`} className={styles.fadeWord}>
          {tok}
        </span>,
      );
      wordIdx++;
    }
  }
  return out;
}

function fadeChildren(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === 'string') return splitTextToFadeSpans(child);
    if (typeof child === 'number')
      return splitTextToFadeSpans(String(child));
    if (isValidElement(child)) {
      const type = child.type;
      // Leave code (inline + fenced), images, and br alone.
      if (type === 'code' || type === 'pre' || type === 'img' || type === 'br') {
        return child;
      }
      const props = child.props as { children?: ReactNode };
      return cloneElement(
        child,
        undefined,
        fadeChildren(props.children),
      );
    }
    return child;
  });
}

const FADE_COMPONENTS = {
  p: ({ children, ...rest }: { children?: ReactNode }) => (
    <p {...rest}>{fadeChildren(children)}</p>
  ),
  li: ({ children, ...rest }: { children?: ReactNode }) => (
    <li {...rest}>{fadeChildren(children)}</li>
  ),
  h1: ({ children, ...rest }: { children?: ReactNode }) => (
    <h1 {...rest}>{fadeChildren(children)}</h1>
  ),
  h2: ({ children, ...rest }: { children?: ReactNode }) => (
    <h2 {...rest}>{fadeChildren(children)}</h2>
  ),
  h3: ({ children, ...rest }: { children?: ReactNode }) => (
    <h3 {...rest}>{fadeChildren(children)}</h3>
  ),
  h4: ({ children, ...rest }: { children?: ReactNode }) => (
    <h4 {...rest}>{fadeChildren(children)}</h4>
  ),
  blockquote: ({ children, ...rest }: { children?: ReactNode }) => (
    <blockquote {...rest}>{fadeChildren(children)}</blockquote>
  ),
  // Table cells too — long answers often render tables.
  td: ({ children, ...rest }: { children?: ReactNode }) => (
    <td {...rest}>{fadeChildren(children)}</td>
  ),
  th: ({ children, ...rest }: { children?: ReactNode }) => (
    <th {...rest}>{fadeChildren(children)}</th>
  ),
};

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
  followUps?: string[];
  /** Model id used to generate this turn (assistant rows only). */
  modelId?: string;
}

interface Props {
  messages: ChatMessage[];
  streaming: boolean;
  /** Id of the message whose typewriter buffer hasn't drained yet. While this
   *  matches a message id, that message is considered "still revealing" — its
   *  footer + follow-up pills stay hidden even after the server's `done`
   *  event arrives, so they don't appear while text is still being typed. */
  drainingId?: string | null;
  toolStatus: string | null;
  onEdit: (messageId: string, newText: string) => void;
  onRegenerate: (messageId: string, overrideModelId?: string) => void;
  onFollowUp?: (text: string) => void;
}

export default function HomeChatMessages({
  messages,
  streaming,
  drainingId,
  toolStatus,
  onEdit,
  onRegenerate,
  onFollowUp,
}: Props) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const readAloud = useReadAloudPlayer();

  // "Stick to bottom" — only auto-scroll while the user is pinned to the
  // bottom. The moment they scroll up we stop following until they manually
  // return to the bottom. This is what makes Copilot/Cursor feel calm during
  // long streams: the viewport never fights the reader.
  const followingRef = useRef(true);
  const lastScrollYRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const NEAR_BOTTOM_PX = 80;

    const onScroll = () => {
      const y = window.scrollY;
      const distanceFromBottom =
        document.documentElement.scrollHeight - (y + window.innerHeight);
      const scrolledUp = y < lastScrollYRef.current - 2;
      lastScrollYRef.current = y;

      if (scrolledUp && distanceFromBottom > NEAR_BOTTOM_PX) {
        followingRef.current = false;
      } else if (distanceFromBottom <= NEAR_BOTTOM_PX) {
        followingRef.current = true;
      }
    };

    lastScrollYRef.current = window.scrollY;
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('wheel', onScroll, { passive: true });
    window.addEventListener('touchmove', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('wheel', onScroll);
      window.removeEventListener('touchmove', onScroll);
    };
  }, []);

  useEffect(() => {
    if (!followingRef.current) return;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const sentinel = sentinelRef.current;
      if (!sentinel || !followingRef.current) return;
      sentinel.scrollIntoView({ behavior: 'auto', block: 'end' });
      lastScrollYRef.current = window.scrollY;
    });
  }, [messages, toolStatus]);

  // When a brand-new turn begins (user just sent), force re-engage follow so
  // the next reply scrolls into view even if they had scrolled up before.
  const lastMsgIdRef = useRef<string | null>(null);
  useEffect(() => {
    const lastId = messages[messages.length - 1]?.id ?? null;
    if (lastId !== lastMsgIdRef.current) {
      const wasUser =
        messages[messages.length - 1]?.role === 'user';
      if (wasUser) followingRef.current = true;
      lastMsgIdRef.current = lastId;
    }
  }, [messages]);

  const lastMessage = messages[messages.length - 1];
  const lastIsEmptyAssistant =
    lastMessage?.role === 'assistant' && lastMessage.content === '';
  const showStatus = streaming && (lastIsEmptyAssistant || toolStatus !== null);
  const statusLabel = toolStatus ?? 'Thinking';

  return (
    <section className={styles.section}>
      <div className={styles.list}>
        {messages.map((msg, idx) => {
          if (
            msg.role === 'assistant' &&
            msg.content === '' &&
            (streaming || msg.id === drainingId)
          ) {
            return null;
          }
          const isLast = idx === messages.length - 1;
          const isLastAssistant =
            msg.role === 'assistant' && idx === messages.length - 1;
          // "Being streamed" now means: this specific message is still
          // revealing through the typewriter, OR the network stream is in
          // flight for it. Either condition keeps footer/pills hidden.
          const isBeingStreamed =
            (streaming && isLastAssistant) || msg.id === drainingId;

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
                    <div
                      className={`${styles.md}${
                        isBeingStreamed ? ' ' + styles.mdStreaming : ''
                      }`}
                    >
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={isBeingStreamed ? FADE_COMPONENTS : undefined}
                      >
                        {msg.content}
                      </ReactMarkdown>
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
                    messageId={msg.id}
                    role={msg.role}
                    content={msg.content}
                    modelId={msg.modelId}
                    canEdit={msg.role === 'user' && Boolean(msg.serverId)}
                    canRegenerate={
                      // Any past completed assistant message with a server-side
                      // id is regen-able. We don't gate on the global streaming
                      // flag — overlapping streams are fine.
                      msg.role === 'assistant' && Boolean(msg.serverId)
                    }
                    alwaysVisible={isLast && msg.role === 'assistant'}
                    // Fade-in animation only for the just-completed turn (last
                    // assistant message). Older messages re-render on scroll
                    // and we don't want to replay the animation on them.
                    appear={isLast && msg.role === 'assistant'}
                    readAloud={readAloud}
                    onCopy={() => copyToClipboard(msg.content)}
                    onEdit={() => setEditingId(msg.id)}
                    onRegenerate={() => onRegenerate(msg.id)}
                    onRetryWithModel={(modelId) => onRegenerate(msg.id, modelId)}
                  />
                )}
                {!isBeingStreamed &&
                  msg.role === 'assistant' &&
                  msg.followUps &&
                  msg.followUps.length > 0 && (
                    <FollowUps
                      items={msg.followUps}
                      onPick={(t) => onFollowUp?.(t)}
                      appear={isLast}
                    />
                  )}
              </div>
            </div>
          );
        })}
        {showStatus && (
          <div className={`${styles.row} ${styles.assistant}`}>
            <span className={styles.status}>
              <ArtifigenzMark state="thinking" height={20} />
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
  messageId,
  role,
  content,
  modelId,
  canEdit,
  canRegenerate,
  alwaysVisible,
  appear,
  readAloud,
  onCopy,
  onEdit,
  onRegenerate,
  onRetryWithModel,
}: {
  messageId: string;
  role: 'user' | 'assistant';
  content: string;
  modelId?: string;
  canEdit: boolean;
  canRegenerate: boolean;
  alwaysVisible: boolean;
  appear?: boolean;
  readAloud: ReadAloudController;
  onCopy: () => void;
  onEdit: () => void;
  onRegenerate: () => void;
  onRetryWithModel: (modelId: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [retryOpen, setRetryOpen] = useState(false);
  const retryRef = useRef<HTMLDivElement>(null);

  const isPlayerActive =
    role === 'assistant' && readAloud.activeId === messageId;

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

  const model = modelId ? findModel(modelId) : null;

  if (isPlayerActive) {
    return (
      <div
        className={`${styles.actions} ${styles.actionsVisible} ${styles.actionsPlayer}`}
      >
        <PlayerBar content={content} readAloud={readAloud} />
      </div>
    );
  }

  return (
    <div
      className={`${styles.actions} ${alwaysVisible ? styles.actionsVisible : ''} ${appear ? styles.actionsAppear : ''}`}
    >
      <ActionButton
        label={copied ? 'Copied' : 'Copy'}
        onClick={handleCopy}
        active={copied}
        icon={copied ? <CheckIcon /> : <CopyIcon />}
      />
      {role === 'user' && canEdit && (
        <ActionButton label="Edit" onClick={onEdit} icon={<PencilIcon />} />
      )}
      {role === 'assistant' && (
        <ActionButton
          label="Read aloud"
          onClick={() => readAloud.start(messageId, content)}
          icon={<SpeakerIcon />}
        />
      )}
      {role === 'assistant' && (
        <ActionButton
          label="Retry"
          onClick={onRegenerate}
          disabled={!canRegenerate}
          icon={<RefreshIcon />}
        />
      )}
      {role === 'assistant' && model && (
        <div className={styles.actionMetaWrap} ref={retryRef}>
          <button
            type="button"
            className={styles.actionMeta}
            onClick={() => canRegenerate && setRetryOpen((v) => !v)}
            disabled={!canRegenerate}
            title="Retry with a different model"
          >
            <span className={styles.actionMetaDot} aria-hidden />
            <span>{model.label}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {retryOpen && canRegenerate && (
            <div className={styles.retryMenu}>
              <div className={styles.retryMenuLabel}>Retry with</div>
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`${styles.retryMenuItem} ${m.id === model.id ? styles.retryMenuItemActive : ''}`}
                  onClick={() => {
                    setRetryOpen(false);
                    onRetryWithModel(m.id);
                  }}
                >
                  <span className={styles.retryMenuFamily}>{m.family}</span>
                  <span className={styles.retryMenuModel}>{m.label}</span>
                  {m.id === model.id && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActionButton({
  label,
  icon,
  onClick,
  disabled,
  active,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`${styles.actionBtn} ${active ? styles.actionBtnActive : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ── Read-aloud player bar ────────────────────────────────────────

const SPEED_OPTIONS = [0.5, 1, 1.25, 1.5, 2] as const;
const VOICE_OPTIONS: { id: string; label: string }[] = [
  { id: 'jon_hamm', label: 'Jon Hamm' },
  { id: 'joan_holloway', label: 'Joan Holloway' },
];

function PlayerBar({
  content,
  readAloud,
}: {
  content: string;
  readAloud: ReadAloudController;
}) {
  const {
    status,
    currentTime,
    bufferedEnd,
    streamComplete,
    duration,
    rate,
    voice,
  } = readAloud;
  const isGenerating = status === 'generating';
  const isPlaying = status === 'playing';
  const hasError = status === 'error';
  const activeId = readAloud.activeId;

  const [voiceMenuOpen, setVoiceMenuOpen] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const voiceMenuRef = useRef<HTMLDivElement>(null);
  const speedMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!voiceMenuOpen && !speedMenuOpen) return;
    const handle = (e: MouseEvent) => {
      if (
        voiceMenuOpen &&
        voiceMenuRef.current &&
        !voiceMenuRef.current.contains(e.target as Node)
      ) {
        setVoiceMenuOpen(false);
      }
      if (
        speedMenuOpen &&
        speedMenuRef.current &&
        !speedMenuRef.current.contains(e.target as Node)
      ) {
        setSpeedMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [voiceMenuOpen, speedMenuOpen]);

  const handleToggle = () => {
    if (hasError) {
      if (activeId) void readAloud.start(activeId, content);
      return;
    }
    if (isGenerating) return;
    readAloud.toggle();
  };

  // Forward skip is only meaningful within the buffered range.
  const maxAvailable = streamComplete
    ? duration || bufferedEnd
    : bufferedEnd;
  const canSkipForward = !isGenerating && currentTime + 1 < maxAvailable;
  const canSkipBack = !isGenerating && currentTime > 0;

  return (
    <div className={styles.player}>
      <button
        type="button"
        className={styles.playerPlay}
        onClick={handleToggle}
        aria-label={
          hasError ? 'Retry' : isGenerating ? 'Loading' : isPlaying ? 'Pause' : 'Play'
        }
        disabled={isGenerating && !hasError}
        title={hasError ? 'Retry' : isPlaying ? 'Pause' : 'Play'}
      >
        {isGenerating ? (
          <SpinnerIcon />
        ) : isPlaying ? (
          <PauseIcon />
        ) : (
          <PlayIcon />
        )}
      </button>

      <button
        type="button"
        className={styles.playerSkip}
        onClick={() => readAloud.skip(-30)}
        aria-label="Skip back 30 seconds"
        disabled={!canSkipBack}
        title="Back 30s"
      >
        <SkipBackIcon />
      </button>

      <button
        type="button"
        className={styles.playerSkip}
        onClick={() => readAloud.skip(30)}
        aria-label="Skip forward 30 seconds"
        disabled={!canSkipForward}
        title="Forward 30s"
      >
        <SkipForwardIcon />
      </button>

      <div className={styles.playerTime} aria-hidden>
        {isGenerating ? 'Loading…' : formatTime(currentTime)}
        {streamComplete && duration > 0 && !isGenerating && (
          <span className={styles.playerTimeDim}>
            {' / '}
            {formatTime(duration)}
          </span>
        )}
      </div>

      <div className={styles.playerDivider} aria-hidden />

      <div className={styles.playerSpeedWrap} ref={speedMenuRef}>
        <button
          type="button"
          className={styles.playerSpeed}
          onClick={() => setSpeedMenuOpen((v) => !v)}
          title="Playback speed"
        >
          {formatSpeed(rate)}
        </button>
        {speedMenuOpen && (
          <div className={styles.speedMenu}>
            <div className={styles.speedLabel}>Speed</div>
            <SpeedSlider value={rate} onChange={(r) => readAloud.setRate(r)} />
          </div>
        )}
      </div>

      {VOICE_OPTIONS.length > 1 ? (
        <div className={styles.playerVoiceWrap} ref={voiceMenuRef}>
          <button
            type="button"
            className={styles.playerVoice}
            onClick={() => setVoiceMenuOpen((v) => !v)}
            title="Voice"
          >
            {VOICE_OPTIONS.find((v) => v.id === voice)?.label ?? voice}
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {voiceMenuOpen && (
            <div className={styles.playerVoiceMenu}>
              {VOICE_OPTIONS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={`${styles.playerVoiceItem} ${
                    v.id === voice ? styles.playerVoiceItemActive : ''
                  }`}
                  onClick={() => {
                    readAloud.setVoice(v.id);
                    setVoiceMenuOpen(false);
                  }}
                >
                  {v.label}
                  {v.id === voice && (
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <span className={styles.playerVoiceBadge} title="Voice">
          {VOICE_OPTIONS.find((v) => v.id === voice)?.label ?? voice}
        </span>
      )}

      <button
        type="button"
        className={styles.playerClose}
        onClick={readAloud.stop}
        aria-label="Close player"
        title="Close"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

function SpeedSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const idx = Math.max(
    0,
    SPEED_OPTIONS.findIndex((s) => s === value),
  );
  return (
    <div className={styles.speedSlider}>
      <div className={styles.speedTrack}>
        <div
          className={styles.speedFill}
          style={{
            width: `${(idx / (SPEED_OPTIONS.length - 1)) * 100}%`,
          }}
        />
        {SPEED_OPTIONS.map((s, i) => {
          const pct = (i / (SPEED_OPTIONS.length - 1)) * 100;
          const active = i === idx;
          return (
            <button
              key={s}
              type="button"
              className={`${styles.speedTick} ${active ? styles.speedTickActive : ''}`}
              style={{ left: `${pct}%` }}
              onClick={() => onChange(s)}
              aria-label={`${formatSpeed(s)} playback`}
            />
          );
        })}
      </div>
      <div className={styles.speedLabels}>
        {SPEED_OPTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className={`${styles.speedLabelBtn} ${
              s === value ? styles.speedLabelBtnActive : ''
            }`}
            onClick={() => onChange(s)}
          >
            {formatSpeed(s)}
          </button>
        ))}
      </div>
    </div>
  );
}

function formatSpeed(n: number): string {
  return n === Math.floor(n) ? `${n}×` : `${n}×`;
}

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
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
        const url = `${API_URL}/api/me/chat/attachments/${a.fileId}`;
        if (a.mimeType.startsWith('image/')) {
          return (
            <AuthedImage
              key={a.fileId}
              fetchUrl={url}
              alt={a.filename}
              className={styles.bubbleImage}
            />
          );
        }
        return (
          <AuthedFileLink
            key={a.fileId}
            fetchUrl={url}
            filename={a.filename}
            mimeType={a.mimeType}
          />
        );
      })}
    </div>
  );
}

/** Loads an image with the Clerk JWT, exposes it as a blob URL so <img>
 *  doesn't fire an un-authed request. */
function AuthedImage({
  fetchUrl,
  alt,
  className,
}: {
  fetchUrl: string;
  alt: string;
  className?: string;
}) {
  const { getToken } = useAuth();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error('no auth');
        const res = await fetch(fetchUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [fetchUrl, getToken]);

  if (error) {
    return (
      <div className={`${className ?? ''} ${styles.bubbleImageError}`}>
        <span>Image failed to load</span>
      </div>
    );
  }
  if (!blobUrl) {
    return (
      <div className={`${className ?? ''} ${styles.bubbleImageLoading}`} aria-busy />
    );
  }
  return (
    <a
      href={blobUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      <img src={blobUrl} alt={alt} />
    </a>
  );
}

/** PDF / other file — fetches via auth and opens via blob URL on click. */
function AuthedFileLink({
  fetchUrl,
  filename,
  mimeType,
}: {
  fetchUrl: string;
  filename: string;
  mimeType: string;
}) {
  const { getToken } = useAuth();
  const open = async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(fetchUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      // Revoke shortly after — give the new tab time to load.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      /* ignore */
    }
  };
  return (
    <button
      type="button"
      className={styles.bubbleFile}
      onClick={open}
      title={filename}
      aria-label={mimeType === 'application/pdf' ? 'Open PDF' : 'Open file'}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      <span>{filename}</span>
    </button>
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
        {citations.map((c, i) => {
          const host = hostnameOf(c.url);
          const title = c.title && c.title !== c.url ? c.title : host;
          return (
            <a
              key={`${c.url}-${i}`}
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.citationChip}
              title={c.title || c.url}
            >
              <span className={styles.citationIndex}>{i + 1}</span>
              <span className={styles.citationBody}>
                <span className={styles.citationTitle}>{title}</span>
                {title !== host && (
                  <span className={styles.citationHost}>{host}</span>
                )}
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

// ── Follow-up chips ──────────────────────────────────────────────

function FollowUps({
  items,
  onPick,
  appear,
}: {
  items: string[];
  onPick: (text: string) => void;
  appear?: boolean;
}) {
  return (
    <div
      className={`${styles.followUps} ${appear ? styles.followUpsAppear : ''}`}
    >
      {items.map((t, i) => (
        <button
          key={`${i}-${t}`}
          type="button"
          className={`${styles.followUpChip} ${appear ? styles.followUpChipAppear : ''}`}
          // Stagger each chip a touch after the group fades in.
          style={
            appear
              ? { animationDelay: `${0.55 + i * 0.08}s` }
              : undefined
          }
          onClick={() => onPick(t)}
        >
          <span>{t}</span>
          <svg
            className={styles.followUpChev}
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      ))}
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

function SpeakerIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <polygon points="6 4 20 12 6 20 6 4" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function SkipBackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <polyline points="3 3 3 8 8 8" />
      <text x="12" y="15.5" fontSize="6.5" fontWeight="600" fill="currentColor" stroke="none" textAnchor="middle">30</text>
    </svg>
  );
}

function SkipForwardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
      <polyline points="21 3 21 8 16 8" />
      <text x="12" y="15.5" fontSize="6.5" fontWeight="600" fill="currentColor" stroke="none" textAnchor="middle">30</text>
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className={styles.spinnerIcon}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

