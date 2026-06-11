'use client';

import { useEffect, useState } from 'react';
import { useUser, useClerk } from '@clerk/nextjs';
import { MODELS, DEFAULT_MODEL_ID, findModel } from '@artifigenz/shared';
import { useTheme } from '@/components/ThemeProvider';
import { useDevtools } from '@/lib/devtools-context';
import styles from './SettingsModal.module.css';

/**
 * Haven Settings modal — ChatGPT-style: left tabs, carded content on the
 * right. Invoked from the avatar on any page; closes via Esc, backdrop,
 * or × without leaving the page. Adapted from the design handoff
 * (settings-modal.js + settings-modal.css).
 */

type TabId =
  | 'general'
  | 'chat'
  | 'memory'
  | 'shared'
  | 'appearance'
  | 'privacy'
  | 'developer';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  modelId: string;
  onModelChange: (id: string) => void;
}

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'chat', label: 'Chat' },
  { id: 'memory', label: 'Memory' },
  { id: 'shared', label: 'Shared chats' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'privacy', label: 'Privacy & data' },
  { id: 'developer', label: 'Developer' },
];

const REPLY_KEY = 'artifigenz.settings.replyLength';
const INSTRUCTIONS_KEY = 'artifigenz.settings.customInstructions';
const INSTRUCTIONS_MAX = 1500;

export default function SettingsModal({
  open,
  onClose,
  modelId,
  onModelChange,
}: SettingsModalProps) {
  const [tab, setTab] = useState<TabId>('general');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // One-shot mount flag — gates client-only render (avoids SSR mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <>
      <div
        className={`${styles.overlay} ${open ? styles.open : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`${styles.modal} ${open ? styles.open : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <aside className={styles.side}>
          <div className={styles.sideTitle}>Settings</div>
          <nav className={styles.tabs}>
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`${styles.tab} ${tab === t.id ? styles.tabOn : ''}`}
                onClick={() => setTab(t.id)}
              >
                <span className={styles.tabIcon}>
                  <TabIcon id={t.id} />
                </span>
                <span>{t.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <section className={styles.main}>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close settings"
          >
            <CloseIcon />
          </button>
          <div className={styles.panes}>
            <div className={styles.pane} key={tab}>
              {tab === 'general' && <GeneralPane />}
              {tab === 'chat' && (
                <ChatPane modelId={modelId} onModelChange={onModelChange} />
              )}
              {tab === 'memory' && <MemoryPane />}
              {tab === 'shared' && <SharedPane />}
              {tab === 'appearance' && <AppearancePane />}
              {tab === 'privacy' && <PrivacyPane />}
              {tab === 'developer' && <DeveloperPane />}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

// ── Panes ────────────────────────────────────────────────────────────

function PaneHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <>
      <h2 className={styles.paneTitle}>{title}</h2>
      <p className={styles.paneDesc}>{desc}</p>
    </>
  );
}

function GeneralPane() {
  const { user, isLoaded } = useUser();
  const name =
    user?.firstName ||
    user?.username ||
    user?.emailAddresses[0]?.emailAddress?.split('@')[0] ||
    '';
  const email = user?.emailAddresses[0]?.emailAddress ?? '';

  return (
    <>
      <PaneHeader
        title="General"
        desc="How you appear to your agents and to other humans on shared work."
      />
      <div className={styles.card}>
        <div className={styles.row}>
          <div>
            <div className={styles.label}>Display name</div>
            <div className={styles.sub}>Used by agents in greetings.</div>
          </div>
          <div className={styles.right}>
            <span className={styles.val}>{isLoaded ? name : ''}</span>
          </div>
        </div>
        <div className={styles.row}>
          <div>
            <div className={styles.label}>Account email</div>
            <div className={styles.sub}>
              A verification link is sent before any change takes effect.
            </div>
          </div>
          <div className={styles.right}>
            <span className={styles.val}>{isLoaded ? email : ''}</span>
            {isLoaded && email && (
              <span className={styles.badge}>verified</span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function ChatPane({
  modelId,
  onModelChange,
}: {
  modelId: string;
  onModelChange: (id: string) => void;
}) {
  const [instructions, setInstructions] = useState('');
  const [reply, setReply] = useState<'concise' | 'balanced' | 'thorough'>(
    'balanced',
  );

  useEffect(() => {
    try {
      const stored = localStorage.getItem(INSTRUCTIONS_KEY);
      // One-shot hydration on mount — same pattern used by DevtoolsProvider
      // for client-only persistence; the cascading-render lint doesn't apply.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored !== null) setInstructions(stored);
      const r = localStorage.getItem(REPLY_KEY) as typeof reply | null;
      if (r === 'concise' || r === 'balanced' || r === 'thorough') setReply(r);
    } catch {
      // private mode — ignore
    }
  }, []);

  const writeInstructions = (v: string) => {
    setInstructions(v);
    try {
      localStorage.setItem(INSTRUCTIONS_KEY, v);
    } catch {
      // ignore
    }
  };

  const writeReply = (v: typeof reply) => {
    setReply(v);
    try {
      localStorage.setItem(REPLY_KEY, v);
    } catch {
      // ignore
    }
  };

  const currentModel = findModel(modelId) ?? findModel(DEFAULT_MODEL_ID);

  return (
    <>
      <PaneHeader title="Chat" desc="Personalize how every agent talks back." />

      <div className={styles.card}>
        <div className={`${styles.row} ${styles.rowStack}`}>
          <div className={styles.label}>Custom instructions</div>
          <div className={styles.sub}>
            Included in every chat. Try preferences for length, tone, units,
            or location.
          </div>
          <textarea
            className={styles.textarea}
            maxLength={INSTRUCTIONS_MAX}
            placeholder="Tell agents how you like to work…"
            style={{ marginTop: 12 }}
            value={instructions}
            onChange={(e) => writeInstructions(e.target.value)}
          />
          <div className={styles.textareaFoot}>
            {instructions.length}&nbsp;/&nbsp;{INSTRUCTIONS_MAX}
          </div>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.row}>
          <div>
            <div className={styles.label}>Reply length</div>
            <div className={styles.sub}>Default verbosity.</div>
          </div>
          <div className={styles.right}>
            <Segmented<typeof reply>
              value={reply}
              onChange={writeReply}
              options={[
                ['concise', 'Concise'],
                ['balanced', 'Balanced'],
                ['thorough', 'Thorough'],
              ]}
            />
          </div>
        </div>
      </div>

      <div className={styles.card}>
        <div className={`${styles.row} ${styles.rowStack}`}>
          <div className={styles.label}>Default model</div>
          <div className={styles.sub}>
            Used for new conversations. Picked: <strong>{currentModel.label}</strong>.
          </div>
        </div>
        <div className={styles.modelList}>
          {MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`${styles.modelRow} ${
                m.id === currentModel.id ? styles.modelRowOn : ''
              }`}
              onClick={() => onModelChange(m.id)}
            >
              <span className={styles.modelRowMain}>
                <span className={styles.modelRowName}>
                  {m.label}
                  <span className={styles.modelRowFamily}> · {m.family}</span>
                </span>
                {m.description && (
                  <span className={styles.modelRowSub}>{m.description}</span>
                )}
              </span>
              <span className={styles.modelRowCheck}>
                <CheckIcon />
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function MemoryPane() {
  return (
    <>
      <PaneHeader
        title="Memory"
        desc="What Artifigenz remembers about you across conversations."
      />
      <div className={styles.card}>
        <div className={styles.empty}>
          Coming soon. Memory will grow automatically from your chats — and
          you&apos;ll be able to import what ChatGPT or Claude already knows.
        </div>
      </div>
    </>
  );
}

function SharedPane() {
  return (
    <>
      <PaneHeader
        title="Shared chats"
        desc="Public read-only links to your conversations."
      />
      <div className={styles.card}>
        <div className={styles.empty}>
          You haven&apos;t shared any chats yet.
        </div>
      </div>
    </>
  );
}

function AppearancePane() {
  const { theme, setTheme, visualTheme, setVisualTheme } = useTheme();

  return (
    <>
      <PaneHeader
        title="Appearance"
        desc="Pair a mode with a theme. Updates apply across the product."
      />
      <div className={styles.card}>
        <div className={styles.row}>
          <div>
            <div className={styles.label}>Mode</div>
            <div className={styles.sub}>Auto follows your system.</div>
          </div>
          <div className={styles.right}>
            <Segmented<'system' | 'light' | 'dark'>
              value={theme}
              onChange={setTheme}
              options={[
                ['system', 'Auto'],
                ['light', 'Light'],
                ['dark', 'Dark'],
              ]}
            />
          </div>
        </div>
      </div>

      <div className={styles.card}>
        <div className={`${styles.row} ${styles.rowStack}`}>
          <div className={styles.label}>Theme</div>
          <div className={styles.sub}>
            The shape and texture of every surface.
          </div>
          <div className={styles.themeGrid}>
            <ThemeTile
              value="terminal"
              name="Terminal"
              desc="Monospace. Square corners. Black-and-white."
              prevClass={styles.themePrevTerm}
              on={visualTheme === 'terminal'}
              onClick={() => setVisualTheme('terminal')}
            />
            <ThemeTile
              value="aura"
              name="Aura"
              desc="Inter. Soft gradients. Glass surfaces."
              prevClass={styles.themePrevAura}
              on={visualTheme === 'aura'}
              onClick={() => setVisualTheme('aura')}
            />
          </div>
        </div>
      </div>
    </>
  );
}

function PrivacyPane() {
  const { signOut } = useClerk();
  return (
    <>
      <PaneHeader
        title="Privacy & data"
        desc="Direct controls over what we keep."
      />
      <div className={styles.card}>
        <div className={styles.row}>
          <div>
            <div className={styles.label}>Export your data</div>
            <div className={styles.sub}>
              Every chat as JSON. Delivered by email within 24h.
            </div>
          </div>
          <div className={styles.right}>
            <button type="button" className={styles.btn} disabled>
              Request export
            </button>
          </div>
        </div>
        <div className={styles.row}>
          <div>
            <div className={styles.label}>Sign out everywhere</div>
            <div className={styles.sub}>
              Revokes this session. You&apos;ll need to sign in again.
            </div>
          </div>
          <div className={styles.right}>
            <button
              type="button"
              className={styles.btn}
              onClick={() => signOut()}
            >
              Sign out
            </button>
          </div>
        </div>
        <div className={styles.row}>
          <div>
            <div className={`${styles.label} ${styles.labelDanger}`}>
              Delete account
            </div>
            <div className={styles.sub}>
              Permanently removes your account, agents, and chat history. This
              cannot be undone.
            </div>
          </div>
          <div className={styles.right}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnDanger}`}
              disabled
            >
              Delete account
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function DeveloperPane() {
  const { agentMode, setAgentMode, hydrated } = useDevtools();
  return (
    <>
      <PaneHeader
        title="Developer"
        desc="Internal-only switches. Persisted in this browser; not synced across devices."
      />
      <div className={styles.card}>
        <div className={styles.row}>
          <div>
            <div className={styles.label}>Agent mode</div>
            <div className={styles.sub}>
              Show the agents page and unlock the Finance dashboard. Off keeps
              the product chat-only.
            </div>
          </div>
          <div className={styles.right}>
            <button
              type="button"
              role="switch"
              aria-checked={agentMode}
              aria-label="Agent mode"
              disabled={!hydrated}
              className={`${styles.toggle} ${agentMode ? styles.toggleOn : ''}`}
              onClick={() => setAgentMode(!agentMode)}
            />
          </div>
        </div>
      </div>
    </>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<[T, string]>;
}) {
  return (
    <div className={styles.seg}>
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          className={`${styles.segOpt} ${v === value ? styles.segOptOn : ''}`}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ThemeTile({
  name,
  desc,
  prevClass,
  on,
  onClick,
}: {
  value: string;
  name: string;
  desc: string;
  prevClass: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.themeTile} ${on ? styles.themeTileOn : ''}`}
      onClick={onClick}
    >
      <span className={styles.tileCheck}>
        <CheckIcon />
      </span>
      <div className={`${styles.themePrev} ${prevClass}`}>
        <div className={`bar ${styles.barW1}`} />
        <div className={`bar ${styles.barW3}`} />
        <div className={`bar ${styles.barW2}`} />
      </div>
      <div className={styles.tileName}>{name}</div>
      <div className={styles.tileDesc}>{desc}</div>
    </button>
  );
}

// ── Icons ────────────────────────────────────────────────────────────

function TabIcon({ id }: { id: TabId }) {
  const common = {
    width: 17,
    height: 17,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (id) {
    case 'general':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3.2" />
          <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
        </svg>
      );
    case 'chat':
      return (
        <svg {...common}>
          <path d="M21 11.5a8.5 8.5 0 0 1-12.2 7.7L3 21l1.8-5.8A8.5 8.5 0 1 1 21 11.5z" />
        </svg>
      );
    case 'memory':
      return (
        <svg {...common}>
          <path d="M12 3a4 4 0 0 0-4 4 3.5 3.5 0 0 0-1.5 6.6A3 3 0 0 0 8 19a3 3 0 0 0 4 1 3 3 0 0 0 4-1 3 3 0 0 0 1.5-5.4A3.5 3.5 0 0 0 16 7a4 4 0 0 0-4-4z" />
          <path d="M12 7v13" />
        </svg>
      );
    case 'shared':
      return (
        <svg {...common}>
          <circle cx="18" cy="5" r="2.6" />
          <circle cx="6" cy="12" r="2.6" />
          <circle cx="18" cy="19" r="2.6" />
          <path d="M8.3 10.8l7.4-4.3M8.3 13.2l7.4 4.3" />
        </svg>
      );
    case 'appearance':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      );
    case 'privacy':
      return (
        <svg {...common}>
          <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
        </svg>
      );
    case 'developer':
      return (
        <svg {...common}>
          <polyline points="9 8 5 12 9 16" />
          <polyline points="15 8 19 12 15 16" />
        </svg>
      );
  }
}

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
