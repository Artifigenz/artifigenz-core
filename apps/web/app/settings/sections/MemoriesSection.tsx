'use client';

import { useEffect, useMemo, useState } from 'react';
import { useApiClient } from '@/hooks/useApiClient';
import type { ApiError, MemoryRow, MemorySource } from '@/lib/api-client';
import styles from '../page.module.css';
import local from './MemoriesSection.module.css';

type FilterSource = 'all' | MemorySource;

const SOURCE_LABELS: Record<MemorySource, string> = {
  artifigenz_chat: 'From chats',
  chatgpt_import: 'ChatGPT',
  claude_import: 'Claude',
  manual: 'Manual',
};

const SOURCE_TAG_CLASS: Record<MemorySource, string> = {
  artifigenz_chat: local.sourceArtifigenz,
  chatgpt_import: local.sourceChatgpt,
  claude_import: local.sourceClaude,
  manual: '',
};

const TYPE_LABELS: Record<string, string> = {
  identity: 'Identity',
  work: 'Work',
  person: 'People',
  preference: 'Preference',
  goal: 'Goal',
  fact: 'Fact',
  quirk: 'Quirk',
};

export function MemoriesSection() {
  const api = useApiClient();
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterSource>('all');
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .listMemories()
      .then((data) => {
        if (!cancelled) setMemories(data.memories);
      })
      .catch((err: ApiError) => console.error(err.message))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const counts = useMemo(() => {
    const c = { all: memories.length } as Record<FilterSource, number>;
    for (const m of memories) {
      c[m.source] = (c[m.source] ?? 0) + 1;
    }
    return c;
  }, [memories]);

  const visible = useMemo(
    () => (filter === 'all' ? memories : memories.filter((m) => m.source === filter)),
    [memories, filter],
  );

  async function handleDelete(id: string) {
    setMemories((prev) => prev.filter((m) => m.id !== id));
    try {
      await api.deleteMemory(id);
    } catch (err) {
      console.error((err as ApiError).message);
    }
  }

  async function handleAdd() {
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
  }

  function handleImported(rows: MemoryRow[]) {
    setMemories((prev) => [...rows, ...prev]);
    setImporting(false);
  }

  const filterOptions: { key: FilterSource; label: string }[] = [
    { key: 'all', label: `All ${counts.all ?? 0}` },
    { key: 'artifigenz_chat', label: `From chats ${counts.artifigenz_chat ?? 0}` },
    { key: 'chatgpt_import', label: `ChatGPT ${counts.chatgpt_import ?? 0}` },
    { key: 'claude_import', label: `Claude ${counts.claude_import ?? 0}` },
    { key: 'manual', label: `Manual ${counts.manual ?? 0}` },
  ];

  return (
    <>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Memories</h2>
          <p className={styles.sectionDesc}>
            What Artifigenz remembers about you across conversations. New memories grow
            automatically from your chats. You can also import everything ChatGPT or
            Claude already knows about you.
          </p>
        </div>

        <div className={styles.card}>
          <div className={local.head}>
            <div className={local.count}>
              <span className={local.countNum}>{counts.all ?? 0}</span> memor
              {counts.all === 1 ? 'y' : 'ies'} stored
            </div>
            <div className={local.headActions}>
              <button
                className={styles.btnGhost}
                onClick={() => {
                  setAdding(true);
                  setNewText('');
                }}
              >
                Add memory
              </button>
              <button className={styles.btnGhost} onClick={() => setImporting(true)}>
                Import from ChatGPT or Claude
              </button>
            </div>
          </div>

          <div className={local.filters}>
            {filterOptions.map((opt) => (
              <button
                key={opt.key}
                className={`${local.filterChip} ${filter === opt.key ? local.filterChipActive : ''}`}
                onClick={() => setFilter(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className={local.list}>
            {loading ? (
              <div className={local.empty}>Loading...</div>
            ) : visible.length === 0 ? (
              <div className={local.empty}>
                <div className={local.emptyTitle}>
                  {filter === 'all' ? 'No memories yet' : 'Nothing in this view'}
                </div>
                {filter === 'all'
                  ? 'Start chatting — Artifigenz learns about you as you go. Or import from another AI.'
                  : 'Try a different filter or import some.'}
              </div>
            ) : (
              visible.map((m) => (
                <div key={m.id} className={local.item}>
                  <div className={local.itemBody}>
                    <div className={local.itemText}>{m.text}</div>
                    <div className={local.itemMeta}>
                      <span
                        className={`${local.sourceTag} ${SOURCE_TAG_CLASS[m.source] ?? ''}`}
                      >
                        {SOURCE_LABELS[m.source] ?? m.source}
                      </span>
                      <span>·</span>
                      <span>{TYPE_LABELS[m.type] ?? m.type}</span>
                    </div>
                  </div>
                  <div className={local.itemActions}>
                    <button
                      className={`${local.iconBtn} ${local.iconBtnDanger}`}
                      onClick={() => handleDelete(m.id)}
                      aria-label="Delete memory"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {adding && (
        <div className={styles.modalOverlay} onClick={() => setAdding(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Add a memory</h2>
            <p className={styles.modalCopy}>
              Tell Artifigenz something durable about you — it&apos;ll use it across
              every future chat.
            </p>
            <textarea
              className={styles.textarea}
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="e.g. I prefer terse answers over long explanations."
              autoFocus
              maxLength={2000}
            />
            <div className={styles.modalActions}>
              <button
                className={styles.btnGhost}
                onClick={() => setAdding(false)}
              >
                Cancel
              </button>
              <button
                className={styles.btnGhost}
                onClick={handleAdd}
                disabled={!newText.trim()}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {importing && (
        <ImportMemoryModal
          onClose={() => setImporting(false)}
          onImported={handleImported}
        />
      )}
    </>
  );
}

// ─── Import modal ───────────────────────────────────────────────

interface ImportProps {
  onClose: () => void;
  onImported: (rows: MemoryRow[]) => void;
}

function ImportMemoryModal({ onClose, onImported }: ImportProps) {
  const api = useApiClient();
  const [prompt, setPrompt] = useState<string>('');
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

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore
    }
  }

  async function handleImport() {
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
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={`${styles.modal} ${local.importModal}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={local.importHead}>
          <h2 className={local.importTitle}>Import your memories</h2>
          <p className={local.importSub}>
            Bring everything ChatGPT or Claude already knows about you into
            Artifigenz. Takes about a minute.
          </p>
        </div>

        <div className={local.steps}>
          <div className={local.step}>
            <div className={local.stepNum}>1</div>
            <div className={local.stepBody}>
              <p className={local.stepTitle}>Open ChatGPT or Claude</p>
              <p className={local.stepHint}>
                We&apos;ll deep-link with a sophisticated prompt that asks for an
                honest, structured dump of everything they remember. Make sure
                you&apos;re signed in.
              </p>
              <div className={local.launchers}>
                <a
                  className={local.launchBtn}
                  href={chatgptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setSource('chatgpt_import')}
                >
                  Open in ChatGPT ↗
                </a>
                <a
                  className={local.launchBtn}
                  href={claudeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setSource('claude_import')}
                >
                  Open in Claude ↗
                </a>
                <button
                  className={`${local.launchBtn} ${local.launchBtnSecondary}`}
                  onClick={copyPrompt}
                  disabled={!prompt}
                >
                  {copied ? 'Copied ✓' : 'Copy prompt'}
                </button>
              </div>
              <button
                className={local.tinyBtn}
                onClick={() => setShowPrompt((s) => !s)}
              >
                {showPrompt ? 'Hide the prompt' : 'See the prompt we send'}
              </button>
              {showPrompt && prompt && (
                <div className={local.promptPreview}>{prompt}</div>
              )}
            </div>
          </div>

          <div className={local.step}>
            <div className={local.stepNum}>2</div>
            <div className={local.stepBody}>
              <p className={local.stepTitle}>Paste the response below</p>
              <p className={local.stepHint}>
                Copy the whole memory block (everything inside the fenced
                <code> ```memory </code> section) and paste it here. We&apos;ll
                split it into individual memories automatically.
              </p>
              <textarea
                className={local.pasteArea}
                placeholder="Paste the response from ChatGPT or Claude here..."
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
              />
              <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-dim)' }}>
                  Source:
                </span>
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value as MemorySource)}
                  style={{
                    fontSize: '0.78rem',
                    padding: '4px 8px',
                    borderRadius: 8,
                    border: '1px solid var(--border-light)',
                    background: 'transparent',
                    color: 'var(--text)',
                    fontFamily: 'inherit',
                  }}
                >
                  <option value="chatgpt_import">ChatGPT</option>
                  <option value="claude_import">Claude</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className={local.importFooter}>
          <div
            className={`${local.importStatus} ${
              status?.kind === 'ok'
                ? local.importStatusOk
                : status?.kind === 'err'
                  ? local.importStatusErr
                  : ''
            }`}
          >
            {status?.msg ?? 'Your memories stay private. Nothing leaves Artifigenz.'}
          </div>
          <div className={local.importActions}>
            <button className={styles.btnGhost} onClick={onClose} disabled={busy}>
              {status?.kind === 'ok' ? 'Done' : 'Cancel'}
            </button>
            {status?.kind !== 'ok' && (
              <button
                className={styles.btnGhost}
                onClick={handleImport}
                disabled={busy || !pasted.trim()}
              >
                {busy ? 'Importing...' : 'Import memories'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
