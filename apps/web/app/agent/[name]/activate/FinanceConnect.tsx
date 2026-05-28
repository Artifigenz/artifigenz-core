'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { usePlaidLink } from 'react-plaid-link';
import Header from '@/components/layout/Header';
import { useApiClient } from '@/hooks/useApiClient';
import { usePasswordedUpload } from '@/hooks/usePasswordedUpload';
import PasswordPromptDialog from '@/components/sections/PasswordPromptDialog';
import { useActivatedAgents } from '@/hooks/useActivatedAgents';
import { clearPlaidPending, savePlaidPending } from '@/lib/plaid-pending';
import styles from './FinanceConnect.module.css';

interface PopularInstitution {
  id: string;
  name: string;
  logo: string | null;
  primaryColor: string | null;
  url: string | null;
  countries: string[];
}

interface PlaidConnection {
  id: string;
  dataSourceTypeId: string;
  displayName: string | null;
  status: string;
  lastSyncedAt: string | null;
  institutionId: string | null;
  institutionName: string | null;
  accounts: Array<{ id: string; name: string; mask: string | null }>;
}

interface UploadedFile {
  fileId: string;
  name: string;
  institutionName: string | null;
  accountLast4: string | null;
  accountType: string | null;
  period: { start: string; end: string } | null;
}

function detectCountry(): string {
  if (typeof navigator === 'undefined') return 'US';
  try {
    const locale = new Intl.Locale(navigator.language);
    return locale.maximize().region ?? 'US';
  } catch {
    return 'US';
  }
}

function BankLogo({
  institution,
  size = 36,
}: {
  institution: { id: string; name: string; logo: string | null; primaryColor: string | null };
  size?: number;
}) {
  const radius = size < 40 ? 10 : 12;
  if (institution.logo) {
    const bg = institution.primaryColor ? `${institution.primaryColor}` : '#eee';
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          background: bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        <img
          src={`data:image/png;base64,${institution.logo}`}
          alt={institution.name}
          width={Math.round(size * 0.7)}
          height={Math.round(size * 0.7)}
          style={{ objectFit: 'contain' }}
        />
      </div>
    );
  }
  const bg = institution.primaryColor
    ? `${institution.primaryColor}1a`
    : 'var(--card-hover)';
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: size < 40 ? '0.78rem' : '0.95rem',
        fontWeight: 700,
        color: 'var(--text)',
        letterSpacing: '-0.02em',
      }}
    >
      {institution.name.charAt(0)}
    </div>
  );
}

function ArrowIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="13 6 19 12 13 18" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="6" />
      <line x1="20" y1="20" x2="16" y2="16" />
    </svg>
  );
}

function CloseIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16 V 4" />
      <polyline points="6 10 12 4 18 10" />
      <path d="M4 16 V 19 a 1 1 0 0 0 1 1 H 19 a 1 1 0 0 0 1 -1 V 16" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M8 11 V 8 a 4 4 0 0 1 8 0 V 11" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="5" width="16" height="16" rx="1.5" />
      <line x1="4" y1="10" x2="20" y2="10" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3 H 6 a 1 1 0 0 0 -1 1 V 20 a 1 1 0 0 0 1 1 H 18 a 1 1 0 0 0 1 -1 V 8 Z" />
      <polyline points="14 3 14 8 19 8" />
    </svg>
  );
}

export default function FinanceConnect() {
  const api = useApiClient();
  const router = useRouter();
  const { user } = useUser();
  const { activate } = useActivatedAgents();

  const firstName =
    user?.firstName ||
    user?.username ||
    user?.emailAddresses?.[0]?.emailAddress?.split('@')[0] ||
    'there';

  const [agentInstanceId, setAgentInstanceId] = useState<string | null>(null);
  const [connections, setConnections] = useState<PlaidConnection[]>([]);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [plaidBusy, setPlaidBusy] = useState(false);
  const [connectingInstitutionId, setConnectingInstitutionId] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [institutions, setInstitutions] = useState<PopularInstitution[]>([]);

  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const pwUpload = usePasswordedUpload();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Inline edit for the institution name on an uploaded group. Keyed by
  // the group name so editing "Unknown bank" stays consistent even as
  // files are added.
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');

  const country = typeof window !== 'undefined' ? detectCountry() : 'US';

  // ─── Bootstrap the finance agent instance ──────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const inst = await api.getOrCreateAgentInstance('finance', {
          status: 'onboarding',
        });
        if (!cancelled) setAgentInstanceId(inst.id);
      } catch (err) {
        console.error('[finance-connect] failed to bootstrap agent:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  // ─── Load existing connections ──────────────────────────────────
  const refreshConnections = async (instanceId: string) => {
    try {
      const list = await api.listConnections(instanceId);
      setConnections(list as unknown as PlaidConnection[]);
    } catch (err) {
      console.error('[finance-connect] failed to load connections:', err);
    }
  };

  useEffect(() => {
    if (!agentInstanceId) return;
    refreshConnections(agentInstanceId);
  }, [agentInstanceId]);

  // ─── Load popular institutions ──────────────────────────────────
  useEffect(() => {
    if (institutions.length > 0) return;
    let cancelled = false;
    api
      .getPopularInstitutions(country)
      .then((res) => {
        if (!cancelled) setInstitutions(res.institutions);
      })
      .catch(() => {
        // Non-blocking
      });
    return () => {
      cancelled = true;
    };
  }, [country, api, institutions.length]);

  // ─── Plaid Link integration ─────────────────────────────────────
  const { open: openPlaidLink, ready: plaidReady } = usePlaidLink({
    token: linkToken,
    onSuccess: async (publicToken, metadata) => {
      if (!agentInstanceId) return;
      setPlaidBusy(true);
      try {
        await api.finalizeConnection(agentInstanceId, 'plaid', {
          publicToken,
          metadata: {
            institutionId: metadata.institution?.institution_id,
            institutionName: metadata.institution?.name,
            accounts: metadata.accounts.map((a) => ({
              id: a.id,
              name: a.name,
              mask: a.mask ?? null,
            })),
          },
        });
        await refreshConnections(agentInstanceId);
        // Kick off ingestion in the background; loading screen will surface
        // progress once the user activates.
        api.syncAgent(agentInstanceId).catch((err) =>
          console.warn('[finance-connect] post-sync failed', err),
        );
      } catch (err) {
        setConnectError(err instanceof Error ? err.message : 'Failed to finalize bank');
      } finally {
        clearPlaidPending();
        setPlaidBusy(false);
        setLinkToken(null);
        setConnectingInstitutionId(null);
      }
    },
    onExit: () => {
      clearPlaidPending();
      setLinkToken(null);
      setPlaidBusy(false);
      setConnectingInstitutionId(null);
    },
  });

  useEffect(() => {
    if (linkToken && plaidReady) openPlaidLink();
  }, [linkToken, plaidReady, openPlaidLink]);

  const connectBank = async (institutionId?: string) => {
    if (!agentInstanceId || plaidBusy) return;
    setConnectError(null);
    setPlaidBusy(true);
    setConnectingInstitutionId(institutionId ?? null);
    const redirectUri = `${window.location.origin}/plaid/oauth`;
    try {
      let res;
      try {
        res = await api.initConnection(agentInstanceId, 'plaid', {
          redirectUri,
          institutionId,
        });
      } catch (err) {
        const msg = (err as { message?: string })?.message ?? '';
        if (institutionId && /invalid[_ ]institution/i.test(msg)) {
          res = await api.initConnection(agentInstanceId, 'plaid', { redirectUri });
        } else {
          throw err;
        }
      }
      savePlaidPending({
        linkToken: res.linkToken,
        agentInstanceId,
        returnTo: window.location.pathname,
      });
      setLinkToken(res.linkToken);
    } catch (err) {
      setPlaidBusy(false);
      setConnectingInstitutionId(null);
      setConnectError((err as { message?: string })?.message ?? 'Failed to open Plaid');
    }
  };

  const disconnectBank = async (connectionId: string) => {
    if (!agentInstanceId) return;
    setConnections((prev) => prev.filter((c) => c.id !== connectionId));
    try {
      await api.disconnectConnection(agentInstanceId, connectionId);
    } catch {
      await refreshConnections(agentInstanceId);
    }
  };

  // ─── File upload ────────────────────────────────────────────────
  const uploadStatement = async (file: File) => {
    if (!agentInstanceId || uploadBusy) return;
    setUploadError(null);
    setUploadBusy(true);
    try {
      const result = await pwUpload.upload(file);
      if (!result) {
        if (pwUpload.unsupportedReason) setUploadError(pwUpload.unsupportedReason);
        return;
      }
      setUploadedFiles((prev) => [
        ...prev,
        {
          fileId: result.fileId,
          name: file.name,
          institutionName: result.metadata.institutionName,
          accountLast4: result.metadata.accountLast4,
          accountType: result.metadata.accountType,
          period: result.metadata.statementPeriod,
        },
      ]);
      await refreshConnections(agentInstanceId);
    } catch (err) {
      setUploadError((err as { message?: string })?.message ?? 'Upload failed');
    } finally {
      setUploadBusy(false);
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  };

  const onUploadInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    for (const f of files) {
      await uploadStatement(f);
    }
  };

  const removeUpload = (idx: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  // ─── Activation ─────────────────────────────────────────────────
  const onActivate = async () => {
    if (activating) return;
    setActivating(true);
    try {
      await activate('finance', { status: 'active' });
      router.push('/finance/loading');
    } catch (err) {
      console.error('[finance-connect] activate failed:', err);
      setActivating(false);
    }
  };

  // ─── Search filtering ───────────────────────────────────────────
  // Only Plaid-type connections render in the connected list — the
  // file-upload connection is a hidden plumbing row, not a user-facing
  // "account". Uploaded statements are surfaced via uploadedFiles instead.
  const plaidConnections = useMemo(
    () => connections.filter((c) => c.dataSourceTypeId === 'plaid'),
    [connections],
  );

  const connectedInstitutionIds = useMemo(
    () => new Set(plaidConnections.map((c) => c.institutionId).filter(Boolean) as string[]),
    [plaidConnections],
  );

  const filteredInstitutions = useMemo(() => {
    const pool = institutions.filter((i) => !connectedInstitutionIds.has(i.id));
    const q = query.trim().toLowerCase();
    if (!q) return pool;
    return pool.filter((i) => i.name.toLowerCase().includes(q));
  }, [institutions, connectedInstitutionIds, query]);

  const sourceCount = plaidConnections.length + uploadedFiles.length;

  // Group uploaded files by institution for the connected-accounts strip
  const uploadGroups = useMemo(() => {
    const map = new Map<string, UploadedFile[]>();
    for (const f of uploadedFiles) {
      const key = f.institutionName ?? 'Unknown bank';
      const arr = map.get(key) ?? [];
      arr.push(f);
      map.set(key, arr);
    }
    return Array.from(map.entries()).map(([name, files]) => ({ name, files }));
  }, [uploadedFiles]);

  const startEditGroup = (groupName: string) => {
    setEditingGroup(groupName);
    setEditingDraft(groupName === 'Unknown bank' ? '' : groupName);
  };

  const cancelEdit = () => {
    setEditingGroup(null);
    setEditingDraft('');
  };

  const saveEditGroup = async (groupName: string) => {
    const newName = editingDraft.trim();
    if (!newName || newName === groupName) {
      cancelEdit();
      return;
    }
    const filesInGroup = uploadedFiles.filter(
      (f) => (f.institutionName ?? 'Unknown bank') === groupName,
    );
    // Optimistic
    setUploadedFiles((prev) =>
      prev.map((f) =>
        (f.institutionName ?? 'Unknown bank') === groupName
          ? { ...f, institutionName: newName }
          : f,
      ),
    );
    cancelEdit();
    try {
      await Promise.all(
        filesInGroup.map((f) => api.renameFileUpload(f.fileId, newName)),
      );
    } catch (err) {
      console.error('[finance-connect] rename failed:', err);
    }
  };

  useEffect(() => {
    setTimeout(() => searchInputRef.current?.focus(), 200);
  }, []);

  return (
    <div className={styles.page}>
      <Header />
      {pwUpload.pendingUnlock && (
        <PasswordPromptDialog
          filename={pwUpload.pendingUnlock.filename}
          encryptedKind={pwUpload.pendingUnlock.encryptedKind}
          submitting={pwUpload.submittingPassword}
          wrongPassword={pwUpload.wrongPassword}
          onSubmit={pwUpload.submitPassword}
          onCancel={pwUpload.cancelPassword}
        />
      )}
      <main className={styles.main}>
        <Link href="/app" className={styles.back}>
          ← Back
        </Link>

        <div className={styles.eyebrowRow}>
          <span className={styles.dollar}>$</span>
          <span className={styles.eyebrowText}>Finance</span>
        </div>

        <h1 className={styles.title}>
          Alright {firstName} — let&apos;s hook up your money.
        </h1>
        <p className={styles.sub}>
          Link a bank through Plaid, or upload statements from any bank or credit card.
        </p>

        {/* Connected accounts strip — only when populated */}
        {sourceCount > 0 && (
          <section className={styles.connectedSection}>
            <div className={styles.connectedHead}>
              <span className={styles.sectionLabel}>Connected accounts</span>
              <span className={styles.liveDot} />
              <span className={styles.connectedCount}>{sourceCount}</span>
            </div>
            <div className={styles.connectedList}>
              {plaidConnections.map((c) => {
                const inst = institutions.find((i) => i.id === c.institutionId);
                const displayInst = inst ?? {
                  id: c.institutionId ?? c.id,
                  name: c.institutionName ?? c.displayName ?? 'Bank',
                  logo: null,
                  primaryColor: null,
                };
                return (
                  <div key={c.id} className={styles.connectedRow}>
                    <BankLogo institution={displayInst} size={32} />
                    <div className={styles.connectedBody}>
                      <div className={styles.connectedTitle}>
                        <span>{displayInst.name}</span>
                        <span className={styles.liveDot} />
                      </div>
                      <div className={styles.connectedMeta}>
                        {c.accounts.length} account{c.accounts.length !== 1 ? 's' : ''} · linked via Plaid
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label="Disconnect"
                      className={styles.iconBtn}
                      onClick={() => disconnectBank(c.id)}
                    >
                      <CloseIcon />
                    </button>
                  </div>
                );
              })}
              {uploadGroups.map((g, gi) => {
                const isEditing = editingGroup === g.name;
                const isUnknown = g.name === 'Unknown bank';
                return (
                  <div key={`u-${gi}`} className={styles.connectedRow}>
                    <div className={styles.uploadGlyph}>
                      <FileIcon />
                    </div>
                    <div className={styles.connectedBody}>
                      <div className={styles.connectedTitle}>
                        {isEditing ? (
                          <input
                            type="text"
                            value={editingDraft}
                            autoFocus
                            placeholder="Bank name (e.g. RBC Royal Bank)"
                            onChange={(e) => setEditingDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEditGroup(g.name);
                              if (e.key === 'Escape') cancelEdit();
                            }}
                            onBlur={() => saveEditGroup(g.name)}
                            className={styles.inlineEditInput}
                          />
                        ) : (
                          <>
                            <span style={{ color: isUnknown ? 'var(--text-mid)' : undefined }}>
                              {g.name}
                            </span>
                            <button
                              type="button"
                              aria-label="Edit bank name"
                              className={styles.editBtn}
                              onClick={() => startEditGroup(g.name)}
                            >
                              {isUnknown ? 'Set bank' : 'Edit'}
                            </button>
                          </>
                        )}
                      </div>
                      <div className={styles.connectedMeta}>
                        {g.files.length} statement{g.files.length !== 1 ? 's' : ''} validated
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label="Remove"
                      className={styles.iconBtn}
                      onClick={() => {
                        setUploadedFiles((prev) =>
                          prev.filter((f) => (f.institutionName ?? 'Unknown bank') !== g.name),
                        );
                      }}
                    >
                      <CloseIcon />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Search panel */}
        <div className={styles.searchPanel}>
          <div className={styles.searchRow}>
            <SearchIcon />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your bank — TD, RBC, BMO…"
              className={styles.searchInput}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className={styles.iconBtn}
                aria-label="Clear"
              >
                <CloseIcon />
              </button>
            )}
          </div>
          <div className={styles.resultsList}>
            {filteredInstitutions.length === 0 ? (
              <div className={styles.resultsEmpty}>
                {query
                  ? `No bank matches "${query}". Use upload below — works for any bank or card.`
                  : 'Type to search, or use upload below.'}
              </div>
            ) : (
              filteredInstitutions.map((inst) => (
                <button
                  key={inst.id}
                  type="button"
                  onClick={() => connectBank(inst.id)}
                  disabled={plaidBusy}
                  className={styles.resultRow}
                >
                  <BankLogo institution={inst} size={36} />
                  <span className={styles.resultName}>{inst.name}</span>
                  <span className={styles.connectPill}>
                    {plaidBusy && connectingInstitutionId === inst.id ? 'Opening…' : 'Connect'}{' '}
                    {!(plaidBusy && connectingInstitutionId === inst.id) && <ArrowIcon />}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {connectError && <p className={styles.errorNote}>{connectError}</p>}

        {/* OR divider */}
        <div className={styles.orRow}>
          <span className={styles.orLine} />
          <span className={styles.orLabel}>or</span>
          <span className={styles.orLine} />
        </div>

        {/* Upload card */}
        <button
          type="button"
          className={styles.uploadCard}
          disabled={uploadBusy || !agentInstanceId}
          onClick={() => uploadInputRef.current?.click()}
        >
          <div className={styles.uploadIconBox}>
            <UploadIcon />
          </div>
          <div className={styles.uploadCopy}>
            <div className={styles.uploadTitle}>
              {uploadBusy ? 'Validating…' : 'Upload your transactions history'}
            </div>
            <div className={styles.uploadSub}>
              PDF or CSV from any bank or credit card — 12 months recommended
            </div>
          </div>
          <ArrowIcon size={16} />
          <input
            ref={uploadInputRef}
            type="file"
            accept=".pdf,.csv,.txt,.jpg,.jpeg,.png,.webp"
            multiple
            style={{ display: 'none' }}
            onChange={onUploadInputChange}
          />
        </button>

        {uploadError && <p className={styles.errorNote}>{uploadError}</p>}

        {/* Tiny footer */}
        <div className={styles.footerNote}>
          <span className={styles.footerItem}>
            <LockIcon />
            <span>Plaid · read-only · bank-grade encryption</span>
          </span>
          <span className={styles.footerDot}>·</span>
          <span className={styles.footerItem}>
            <CalendarIcon />
            <span>We&apos;ll remind you monthly to refresh statements</span>
          </span>
        </div>

        {/* Bottom nav */}
        <div className={styles.bottomNav}>
          <span className={styles.bottomNote}>
            {uploadBusy
              ? 'Validating your upload…'
              : sourceCount > 0
                ? `${sourceCount} source${sourceCount !== 1 ? 's' : ''} ready — let's analyze.`
                : 'Connect at least one source to continue.'}
          </span>
          <button
            type="button"
            disabled={sourceCount === 0 || activating || uploadBusy}
            onClick={onActivate}
            className={styles.activateBtn}
          >
            {activating ? 'Activating…' : 'Activate Finance'}
            <ArrowIcon size={13} />
          </button>
        </div>
      </main>
    </div>
  );
}
