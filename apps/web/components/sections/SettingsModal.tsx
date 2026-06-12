'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useClerk } from '@clerk/nextjs';
import { MODELS, DEFAULT_MODEL_ID, findModel } from '@artifigenz/shared';
import { useTheme } from '@/components/ThemeProvider';
import { useDevtools } from '@/lib/devtools-context';
import { useApiClient } from '@/hooks/useApiClient';
import type {
  ApiError,
  MemoryRow,
  MemorySource,
  ShareRecord,
} from '@/lib/api-client';
import styles from './SettingsModal.module.css';

/**
 * Haven Settings modal — ChatGPT-style: left tabs, carded content on the
 * right. Invoked from the avatar; closes via Esc, backdrop, or ×.
 *
 * Real backend wiring for all panes — identity update, custom instructions,
 * memories (list/add/import/delete), shared chats (list/copy/revoke),
 * privacy (deletion code flow), appearance (mode + theme), and the
 * developer agent-mode toggle.
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

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

// ── Pane: General ────────────────────────────────────────────────────

function GeneralPane() {
  const api = useApiClient();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getMe()
      .then((data) => {
        if (cancelled) return;
        setEmail(data.email);
        setName(data.name ?? '');
      })
      .catch((err: ApiError) => console.error(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [api]);

  const startEdit = () => {
    setEditValue(name);
    setEditing(true);
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      await api.patchMe({ name: editValue.trim() });
      setName(editValue.trim());
      setEditing(false);
    } catch (err) {
      console.error((err as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

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
            {editing ? (
              <>
                <input
                  className={styles.inlineInput}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  autoFocus
                />
                <button
                  type="button"
                  className={styles.btn}
                  onClick={saveEdit}
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  className={styles.btnText}
                  onClick={() => setEditing(false)}
                  disabled={saving}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span className={styles.val}>
                  {loading ? '…' : name || 'Not set'}
                </span>
                <button
                  type="button"
                  className={styles.btnText}
                  onClick={startEdit}
                >
                  Edit
                </button>
              </>
            )}
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
            <span className={styles.val}>{loading ? '…' : email}</span>
            {!loading && email && (
              <span className={styles.badge}>verified</span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Pane: Chat ───────────────────────────────────────────────────────

function ChatPane({
  modelId,
  onModelChange,
}: {
  modelId: string;
  onModelChange: (id: string) => void;
}) {
  const api = useApiClient();
  const [instructions, setInstructions] = useState('');
  const [savedInstructions, setSavedInstructions] = useState('');
  const [savingInstructions, setSavingInstructions] = useState(false);
  const [reply, setReply] = useState<'concise' | 'balanced' | 'thorough'>(
    'balanced',
  );

  useEffect(() => {
    let cancelled = false;
    api
      .getChatInstructions()
      .then((data) => {
        if (cancelled) return;
        const v = data.instructions ?? '';
        setInstructions(v);
        setSavedInstructions(v);
      })
      .catch((err: ApiError) => console.error(err.message));
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    try {
      const r = localStorage.getItem(REPLY_KEY) as typeof reply | null;
      if (r === 'concise' || r === 'balanced' || r === 'thorough') setReply(r);
    } catch {
      // ignore
    }
  }, []);

  const saveInstructions = useCallback(async () => {
    if (instructions === savedInstructions) return;
    setSavingInstructions(true);
    try {
      const trimmed = instructions.trim();
      await api.updateChatInstructions(trimmed ? trimmed : null);
      setSavedInstructions(instructions);
    } catch (err) {
      console.error((err as ApiError).message);
    } finally {
      setSavingInstructions(false);
    }
  }, [api, instructions, savedInstructions]);

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
            onChange={(e) => setInstructions(e.target.value)}
            onBlur={saveInstructions}
          />
          <div className={styles.textareaFoot}>
            {savingInstructions
              ? 'Saving…'
              : instructions !== savedInstructions
                ? 'Unsaved'
                : ''}
            <span style={{ marginLeft: 'auto' }}>
              {instructions.length}&nbsp;/&nbsp;{INSTRUCTIONS_MAX}
            </span>
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

// ── Pane: Memory ─────────────────────────────────────────────────────

const MEMORY_SOURCE_LABELS: Record<MemorySource, string> = {
  artifigenz_chat: 'From chats',
  chatgpt_import: 'ChatGPT',
  claude_import: 'Claude',
  manual: 'Manual',
};

const MEMORY_TYPE_LABELS: Record<string, string> = {
  identity: 'Identity',
  work: 'Work',
  person: 'People',
  preference: 'Preference',
  goal: 'Goal',
  fact: 'Fact',
  quirk: 'Quirk',
};

function MemoryPane() {
  const api = useApiClient();
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | MemorySource>('all');
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState('');
  const [importing, setImporting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Reset before re-fetching when the user hits Retry; these run before
    // the network resolves, so callers see Loading… instead of stale data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    api
      .listMemories()
      .then((data) => {
        if (!cancelled) setMemories(data.memories);
      })
      .catch((err: ApiError) => {
        if (!cancelled) setError(err.message ?? 'Failed to load memories');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [api, reloadKey]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: memories.length };
    for (const m of memories) c[m.source] = (c[m.source] ?? 0) + 1;
    return c;
  }, [memories]);

  const visible = useMemo(
    () =>
      filter === 'all'
        ? memories
        : memories.filter((m) => m.source === filter),
    [memories, filter],
  );

  const handleDelete = async (id: string) => {
    setMemories((prev) => prev.filter((m) => m.id !== id));
    try {
      await api.deleteMemory(id);
    } catch (err) {
      console.error((err as ApiError).message);
    }
  };

  const handleAdd = async () => {
    const text = newText.trim();
    if (!text) return;
    try {
      const { memory } = await api.createMemory({ text, source: 'manual' });
      setMemories((prev) => [memory, ...prev]);
      setNewText('');
      setAdding(false);
    } catch (err) {
      console.error((err as ApiError).message);
    }
  };

  const handleImported = (rows: MemoryRow[]) => {
    setMemories((prev) => [...rows, ...prev]);
    setImporting(false);
  };

  const filterOptions: Array<{ key: 'all' | MemorySource; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'artifigenz_chat', label: 'From chats' },
    { key: 'chatgpt_import', label: 'ChatGPT' },
    { key: 'claude_import', label: 'Claude' },
    { key: 'manual', label: 'Manual' },
  ];

  return (
    <>
      <PaneHeader
        title="Memory"
        desc="What Artifigenz remembers about you across conversations. Memories grow automatically from chats; import what ChatGPT or Claude already knows."
      />

      <div className={styles.memHead}>
        <div className={styles.sub}>
          <strong>{counts.all ?? 0}</strong>{' '}
          {counts.all === 1 ? 'memory' : 'memories'} stored
        </div>
        <div className={styles.right}>
          <button
            type="button"
            className={styles.btn}
            onClick={() => {
              setAdding(true);
              setNewText('');
            }}
          >
            Add memory
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={() => setImporting(true)}
          >
            Import
          </button>
        </div>
      </div>

      {adding && (
        <div className={styles.card} style={{ marginBottom: 14 }}>
          <div className={`${styles.row} ${styles.rowStack}`}>
            <div className={styles.label}>Add a memory</div>
            <div className={styles.sub}>
              Something durable about you — Artifigenz will use it across every
              future chat.
            </div>
            <textarea
              className={styles.textarea}
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="e.g. I prefer terse answers over long explanations."
              autoFocus
              maxLength={2000}
              style={{ marginTop: 12, minHeight: 80 }}
            />
            <div
              className={styles.right}
              style={{ justifyContent: 'flex-end', marginTop: 12 }}
            >
              <button
                type="button"
                className={styles.btnText}
                onClick={() => setAdding(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.btn}
                onClick={handleAdd}
                disabled={!newText.trim()}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={styles.chips}>
        {filterOptions.map((opt) => (
          <button
            key={opt.key}
            type="button"
            className={`${styles.chip} ${filter === opt.key ? styles.chipOn : ''}`}
            onClick={() => setFilter(opt.key)}
          >
            {opt.label}{' '}
            <span className={styles.chipNum}>{counts[opt.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className={styles.card}>
        {loading ? (
          <div className={styles.empty}>Loading…</div>
        ) : error ? (
          <div className={styles.empty}>
            <div style={{ color: '#c0392b', marginBottom: 10 }}>
              Couldn&apos;t load memories: {error}
            </div>
            <button
              type="button"
              className={styles.btn}
              onClick={() => setReloadKey((k) => k + 1)}
            >
              Retry
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className={styles.empty}>
            {filter === 'all'
              ? "No memories yet. Start chatting and Artifigenz will learn as you go — or import what another AI already knows."
              : 'Nothing in this view. Try a different filter.'}
          </div>
        ) : (
          <div className={styles.memList}>
            {visible.map((m) => (
              <div key={m.id} className={styles.memItem}>
                <div className={styles.memBody}>
                  <div className={styles.memText}>{m.text}</div>
                  <div className={styles.memMeta}>
                    <span className={styles.tag}>
                      {MEMORY_SOURCE_LABELS[m.source] ?? m.source}
                    </span>
                    <span className={styles.memCat}>
                      {MEMORY_TYPE_LABELS[m.type] ?? m.type}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className={`${styles.btnText} ${styles.memDel}`}
                  onClick={() => handleDelete(m.id)}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {importing && (
        <ImportMemoryDialog
          onClose={() => setImporting(false)}
          onImported={handleImported}
        />
      )}
    </>
  );
}

function ImportMemoryDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (rows: MemoryRow[]) => void;
}) {
  const api = useApiClient();
  const [prompt, setPrompt] = useState('');
  const [pasted, setPasted] = useState('');
  const [source, setSource] = useState<MemorySource>('chatgpt_import');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<
    { kind: 'ok'; msg: string } | { kind: 'err'; msg: string } | null
  >(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getMemoryImportPrompt()
      .then((res) => {
        if (!cancelled) setPrompt(res.prompt);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api]);

  const chatgptUrl = useMemo(
    () => `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`,
    [prompt],
  );
  const claudeUrl = useMemo(
    () => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`,
    [prompt],
  );

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore
    }
  };

  const handleImport = async () => {
    if (!pasted.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      const { imported, memories } = await api.importMemories({
        source,
        text: pasted,
      });
      if (imported === 0) {
        setStatus({
          kind: 'err',
          msg: "Couldn't pull any memories from that paste. Try the full block.",
        });
      } else {
        setStatus({ kind: 'ok', msg: `Imported ${imported} memories.` });
        onImported(memories);
      }
    } catch (err) {
      setStatus({ kind: 'err', msg: (err as ApiError).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        className={`${styles.overlay} ${styles.subOverlay} ${styles.open}`}
        onClick={busy ? undefined : onClose}
      />
      <div className={`${styles.subDialog} ${styles.open}`} role="dialog">
        <div className={styles.subHead}>
          <div>
            <h3 className={styles.subTitle}>Import your memories</h3>
            <p className={styles.subDesc}>
              Bring everything ChatGPT or Claude already knows about you into
              Artifigenz. Takes about a minute.
            </p>
          </div>
          <button
            type="button"
            className={styles.close}
            style={{ position: 'static' }}
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>

        <div className={styles.subBody}>
          <div className={styles.step}>
            <div className={styles.stepNum}>1</div>
            <div className={styles.stepBody}>
              <div className={styles.stepTitle}>Open ChatGPT or Claude</div>
              <div className={styles.stepHint}>
                We&apos;ll deep-link with a prompt that asks for a structured
                dump of everything they remember. Make sure you&apos;re signed
                in.
              </div>
              <div className={styles.launchers}>
                <a
                  className={styles.btn}
                  href={chatgptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setSource('chatgpt_import')}
                >
                  Open in ChatGPT ↗
                </a>
                <a
                  className={styles.btn}
                  href={claudeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setSource('claude_import')}
                >
                  Open in Claude ↗
                </a>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={copyPrompt}
                  disabled={!prompt}
                >
                  {copied ? 'Copied ✓' : 'Copy prompt'}
                </button>
              </div>
              <button
                type="button"
                className={styles.btnText}
                onClick={() => setShowPrompt((s) => !s)}
                style={{ marginTop: 6 }}
              >
                {showPrompt ? 'Hide the prompt' : 'See the prompt we send'}
              </button>
              {showPrompt && prompt && (
                <pre className={styles.promptPreview}>{prompt}</pre>
              )}
            </div>
          </div>

          <div className={styles.step}>
            <div className={styles.stepNum}>2</div>
            <div className={styles.stepBody}>
              <div className={styles.stepTitle}>Paste the response</div>
              <div className={styles.stepHint}>
                Copy the whole memory block from the AI and paste it here.
                We&apos;ll split it into individual memories automatically.
              </div>
              <textarea
                className={styles.textarea}
                placeholder="Paste the response from ChatGPT or Claude…"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                style={{ minHeight: 140, marginTop: 10 }}
              />
              <div className={styles.sourcePick}>
                <span>Source:</span>
                <select
                  className={styles.select}
                  value={source}
                  onChange={(e) => setSource(e.target.value as MemorySource)}
                >
                  <option value="chatgpt_import">ChatGPT</option>
                  <option value="claude_import">Claude</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.subFooter}>
          <div
            className={`${styles.subStatus} ${
              status?.kind === 'ok'
                ? styles.subStatusOk
                : status?.kind === 'err'
                  ? styles.subStatusErr
                  : ''
            }`}
          >
            {status?.msg ?? 'Your memories stay private to your account.'}
          </div>
          <div className={styles.right}>
            <button
              type="button"
              className={styles.btnText}
              onClick={onClose}
              disabled={busy}
            >
              {status?.kind === 'ok' ? 'Done' : 'Cancel'}
            </button>
            {status?.kind !== 'ok' && (
              <button
                type="button"
                className={styles.btn}
                onClick={handleImport}
                disabled={busy || !pasted.trim()}
              >
                {busy ? 'Importing…' : 'Import memories'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Pane: Shared chats ───────────────────────────────────────────────

function SharedPane() {
  const api = useApiClient();
  const [shares, setShares] = useState<ShareRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyToken, setBusyToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { shares } = await api.listShares();
      setShares(shares);
    } catch (err) {
      setError((err as ApiError).message ?? 'Failed to load shares');
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const copy = async (token: string) => {
    if (!origin) return;
    try {
      await navigator.clipboard.writeText(`${origin}/share/${token}`);
      setCopiedToken(token);
      setTimeout(
        () => setCopiedToken((cur) => (cur === token ? null : cur)),
        1500,
      );
    } catch {
      setError('Could not copy. Select the URL and copy manually.');
    }
  };

  const revoke = async (token: string) => {
    if (
      !confirm('Revoke this share? The link will stop working immediately.')
    )
      return;
    setBusyToken(token);
    try {
      await api.revokeShare(token);
      setShares((cur) => (cur ?? []).filter((s) => s.shareToken !== token));
    } catch (err) {
      setError((err as ApiError).message ?? 'Failed to revoke');
    } finally {
      setBusyToken(null);
    }
  };

  return (
    <>
      <PaneHeader
        title="Shared chats"
        desc="Public read-only links to your conversations. Revoke any of them here."
      />

      <div className={styles.card}>
        {error && (
          <div className={styles.empty}>
            <div style={{ color: '#c0392b', marginBottom: 10 }}>
              Couldn&apos;t load shared chats: {error}
            </div>
            <button type="button" className={styles.btn} onClick={load}>
              Retry
            </button>
          </div>
        )}

        {shares === null && !error && (
          <div className={styles.empty}>Loading…</div>
        )}

        {shares?.length === 0 && !error && (
          <div className={styles.empty}>
            You haven&apos;t shared any chats yet. Open the history modal, click
            the menu on any chat, and pick “Share link.”
          </div>
        )}

        {shares?.map((s) => {
          const title = s.title?.trim() || 'Untitled chat';
          const url = `${origin}/share/${s.shareToken}`;
          return (
            <div key={s.id} className={styles.row}>
              <div>
                <div className={styles.label}>{title}</div>
                <div className={styles.sub}>
                  {s.viewCount} {s.viewCount === 1 ? 'view' : 'views'} ·
                  &nbsp;shared {formatRelative(s.createdAt)}
                </div>
              </div>
              <div className={styles.right}>
                <a
                  className={styles.btnText}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open
                </a>
                <button
                  type="button"
                  className={styles.btnText}
                  onClick={() => copy(s.shareToken)}
                >
                  {copiedToken === s.shareToken ? 'Copied' : 'Copy link'}
                </button>
                <button
                  type="button"
                  className={`${styles.btnText} ${styles.dangerText}`}
                  onClick={() => revoke(s.shareToken)}
                  disabled={busyToken === s.shareToken}
                >
                  Revoke
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < hr) return `${Math.max(1, Math.round(diff / min))}m ago`;
  if (diff < day) return `${Math.round(diff / hr)}h ago`;
  if (diff < 30 * day) return `${Math.round(diff / day)}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ── Pane: Appearance ─────────────────────────────────────────────────

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
              name="Terminal"
              desc="Monospace. Square corners. Black-and-white."
              prevClass={styles.themePrevTerm}
              on={visualTheme === 'terminal'}
              onClick={() => setVisualTheme('terminal')}
            />
            <ThemeTile
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

// ── Pane: Privacy & data ─────────────────────────────────────────────

function PrivacyPane() {
  const api = useApiClient();
  const { signOut } = useClerk();
  const router = useRouter();

  const [step, setStep] = useState<'idle' | 'confirm' | 'verify'>('idle');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestDeletion = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.requestAccountDeletion();
      setStep('verify');
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmDeletion = async () => {
    if (code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await api.confirmAccountDeletion(code);
      await signOut();
      router.replace('/');
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PaneHeader
        title="Privacy & data"
        desc="Direct controls over what we keep."
      />
      <div className={styles.card}>
        <div className={styles.row}>
          <div>
            <div className={styles.label}>Sign out</div>
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
              onClick={() => {
                setStep('confirm');
                setError(null);
                setCode('');
              }}
            >
              Delete account
            </button>
          </div>
        </div>
      </div>

      {step !== 'idle' && (
        <>
          <div
            className={`${styles.overlay} ${styles.subOverlay} ${styles.open}`}
            onClick={busy ? undefined : () => setStep('idle')}
          />
          <div
            className={`${styles.subDialog} ${styles.subDialogSmall} ${styles.open}`}
            role="dialog"
          >
            {step === 'confirm' ? (
              <>
                <h3 className={styles.subTitle}>Delete your account?</h3>
                <p className={styles.subDesc}>
                  We&apos;ll send a 6-digit verification code to your email.
                  You have 10 minutes to enter it.
                </p>
                {error && <div className={styles.errText}>{error}</div>}
                <div className={styles.right} style={{ marginTop: 18 }}>
                  <button
                    type="button"
                    className={styles.btnText}
                    onClick={() => setStep('idle')}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnDanger}`}
                    onClick={requestDeletion}
                    disabled={busy}
                  >
                    {busy ? 'Sending code…' : 'Send code'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className={styles.subTitle}>Enter verification code</h3>
                <p className={styles.subDesc}>
                  We sent a 6-digit code to your email. Enter it to confirm
                  deletion. This cannot be undone.
                </p>
                <input
                  className={styles.codeInput}
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="6-digit code"
                  autoFocus
                />
                {error && <div className={styles.errText}>{error}</div>}
                <div className={styles.right} style={{ marginTop: 18 }}>
                  <button
                    type="button"
                    className={styles.btnText}
                    onClick={() => setStep('idle')}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnDanger}`}
                    onClick={confirmDeletion}
                    disabled={busy || code.length !== 6}
                  >
                    {busy ? 'Deleting…' : 'Permanently delete'}
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}

// ── Pane: Developer ──────────────────────────────────────────────────

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

// ── Shared ───────────────────────────────────────────────────────────

function PaneHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <>
      <h2 className={styles.paneTitle}>{title}</h2>
      <p className={styles.paneDesc}>{desc}</p>
    </>
  );
}

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
