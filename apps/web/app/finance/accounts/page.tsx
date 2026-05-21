'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import { usePlaidLink } from 'react-plaid-link';
import Header from '@/components/layout/Header';
import { useApiClient } from '@/hooks/useApiClient';
import { useActivatedAgents } from '@/hooks/useActivatedAgents';
import { clearPlaidPending, savePlaidPending } from '@/lib/plaid-pending';
import shell from '../../agent/[name]/page.module.css';
import styles from './page.module.css';

type Account = Awaited<
  ReturnType<ReturnType<typeof useApiClient>['getFinanceAccounts']>
>['accounts'][number];

interface PopularInstitution {
  id: string;
  name: string;
  logo: string | null;
  primaryColor: string | null;
  url: string | null;
  countries: string[];
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

const BANK_ABBREVIATIONS = new Set([
  'TD', 'RBC', 'BMO', 'CIBC', 'HSBC', 'ATB', 'EQ',
  'US', 'USA', 'USAA', 'BOA', 'BOFA', 'PNC', 'JPM',
  'SBI', 'ICICI', 'HDFC', 'AXIS', 'IDBI', 'IDFC',
  'BPI', 'BDO', 'UBS', 'UK', 'UAE', 'PSE', 'BBVA',
  'ANZ', 'NAB', 'AMEX',
]);

function formatInstitution(name: string | null): string {
  if (!name) return 'Unknown institution';
  return name
    .split(/\s+/)
    .map((word) => {
      const up = word.toUpperCase();
      if (BANK_ABBREVIATIONS.has(up)) return up;
      if (word !== word.toLowerCase() && word !== word.toUpperCase()) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

function formatMoney(amount: number | null): string {
  if (amount == null) return '—';
  const abs = Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return amount < 0 ? `−$${abs}` : `$${abs}`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} hr ago`;
  return `${Math.floor(diff / 86400_000)} days ago`;
}

function formatPeriod(start: string | null, end: string | null): string {
  if (!start && !end) return '';
  const fmt = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  if (start && end) {
    const s = fmt(start);
    const e = fmt(end);
    return s === e ? s : `${s} – ${e}`;
  }
  return fmt(start ?? end!);
}

function accountTypeLabel(type: string | null, subtype: string | null): string {
  if (subtype) return subtype;
  if (type === 'depository') return 'chequing';
  if (type === 'credit') return 'credit';
  if (type === 'loan') return 'loan';
  if (type === 'investment') return 'investment';
  return type ?? 'account';
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
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          background: institution.primaryColor ?? '#eee',
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
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: institution.primaryColor
          ? `${institution.primaryColor}1a`
          : 'var(--card-hover)',
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
      {formatInstitution(institution.name).charAt(0)}
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

export default function AccountsPage() {
  const api = useApiClient();
  const { user } = useUser();
  const { getActivation } = useActivatedAgents();
  const activation = getActivation('finance');
  const agentInstanceId = activation?.id ?? null;

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-more state — mirrors FinanceConnect
  const [institutions, setInstitutions] = useState<PopularInstitution[]>([]);
  const [query, setQuery] = useState('');
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [plaidBusy, setPlaidBusy] = useState(false);
  const [connectingInstitutionId, setConnectingInstitutionId] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const country = typeof window !== 'undefined' ? detectCountry() : 'US';

  const refreshAccounts = useCallback(async () => {
    try {
      const res = await api.getFinanceAccounts();
      setAccounts(res.accounts);
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'Failed to load accounts');
    }
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshAccounts();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshAccounts]);

  useEffect(() => {
    if (institutions.length > 0) return;
    let cancelled = false;
    api
      .getPopularInstitutions(country)
      .then((res) => {
        if (!cancelled) setInstitutions(res.institutions);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api, country, institutions.length]);

  // ─── Plaid Link ─────────────────────────────────────────────────
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
        await api.syncAgent(agentInstanceId).catch(() => {});
        await refreshAccounts();
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
        res = await api.initConnection(agentInstanceId, 'plaid', { redirectUri, institutionId });
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

  // ─── Upload ─────────────────────────────────────────────────────
  const uploadStatement = async (file: File) => {
    if (!agentInstanceId || uploadBusy) return;
    setUploadError(null);
    setUploadBusy(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await api.uploadFile(formData);
      await refreshAccounts();
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

  // ─── Disconnect a Plaid bank (kills all its accounts) ───────────
  const disconnectBank = async (connectionId: string) => {
    if (!agentInstanceId) return;
    if (!confirm('Disconnect this bank? Existing transactions stay; we just stop syncing.')) return;
    try {
      await api.disconnectConnection(agentInstanceId, connectionId);
      await refreshAccounts();
    } catch (err) {
      console.error('[accounts] disconnect failed:', err);
    }
  };

  // ─── Group accounts by bank (institution + plaid connection id) ──
  type BankGroup = {
    key: string;
    institutionName: string;
    plaidConnectionId: string | null;
    plaidStatus: string | null;
    plaidLastSyncedAt: string | null;
    plaidRequiresReauth: boolean;
    institutionMeta: PopularInstitution | null;
    accounts: Account[];
    // For upload-only banks: aggregate statement info
    uploadStatements: Account['upload'] extends infer U
      ? U extends { statements: infer S }
        ? S
        : never
      : never;
  };

  const bankGroups = useMemo<BankGroup[]>(() => {
    const map = new Map<string, BankGroup>();
    for (const a of accounts) {
      const inst = (a.institutionName ?? 'unknown').toLowerCase();
      // Group by institution + plaid connection id (so different banks at
      // the same connection are still separate; multiple Plaid links to the
      // same bank are also kept separate to preserve the source signal).
      const key = `${inst}|${a.plaid?.connectionId ?? 'upload'}`;
      let group = map.get(key);
      if (!group) {
        const meta = institutions.find(
          (i) => i.name.toLowerCase() === inst,
        );
        group = {
          key,
          institutionName: a.institutionName ?? 'Unknown',
          plaidConnectionId: a.plaid?.connectionId ?? null,
          plaidStatus: a.plaid?.status ?? null,
          plaidLastSyncedAt: a.plaid?.lastSyncedAt ?? null,
          plaidRequiresReauth: a.plaid?.requiresReauth ?? false,
          institutionMeta: meta
            ? {
                id: meta.id,
                name: meta.name,
                logo: meta.logo,
                primaryColor: meta.primaryColor,
                url: meta.url,
                countries: meta.countries,
              }
            : null,
          accounts: [],
          uploadStatements: [],
        };
        map.set(key, group);
      }
      group.accounts.push(a);
      if (a.upload?.statements) {
        group.uploadStatements.push(...(a.upload.statements as never[]));
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      // Plaid links first, then uploads
      const aP = a.plaidConnectionId ? 0 : 1;
      const bP = b.plaidConnectionId ? 0 : 1;
      if (aP !== bP) return aP - bP;
      return a.institutionName.localeCompare(b.institutionName);
    });
  }, [accounts, institutions]);

  // ─── Search filtering ───────────────────────────────────────────
  const connectedInstIds = useMemo(
    () =>
      new Set(
        accounts
          .map((a) => a.plaid?.connectionId)
          .filter(Boolean) as string[],
      ),
    [accounts],
  );

  // Filter out banks that are already Plaid-connected — but only by name
  // match. Upload-only "Unknown" entries don't block reconnecting any Plaid
  // bank.
  const connectedInstitutionNames = useMemo(
    () =>
      new Set(
        bankGroups
          .filter((g) => g.plaidConnectionId)
          .map((g) => g.institutionName.toLowerCase()),
      ),
    [bankGroups],
  );

  const filteredInstitutions = useMemo(() => {
    const pool = institutions.filter(
      (i) => !connectedInstitutionNames.has(i.name.toLowerCase()),
    );
    const q = query.trim().toLowerCase();
    if (!q) return pool;
    return pool.filter((i) => i.name.toLowerCase().includes(q));
  }, [institutions, connectedInstitutionNames, query]);

  // Suppress unused-warnings; we keep the connectedInstIds memo above
  // so future per-connection logic has it on hand.
  void connectedInstIds;
  void user;

  if (loading) {
    return (
      <div className={shell.page}>
        <Header />
        <main className={shell.main}>
          <p className={styles.loading}>Loading accounts…</p>
        </main>
      </div>
    );
  }

  return (
    <div className={shell.page}>
      <Header />
      <main className={shell.main}>
        <Link href="/finance" className={shell.back}>← Back to Brief</Link>

        <div className={styles.eyebrowRow}>
          <span className={styles.dollar}>$</span>
          <span className={styles.eyebrowText}>Finance</span>
        </div>

        <h1 className={styles.title}>Your accounts</h1>
        <p className={styles.sub}>
          Every bank you&apos;ve linked and every statement you&apos;ve uploaded.
          Add another bank below, or upload a new statement anytime.
        </p>

        {error && <p className={styles.error}>{error}</p>}

        {/* ─── Connected accounts ─── */}
        {bankGroups.length === 0 ? (
          <p className={styles.empty}>
            No accounts yet. Search for a bank below or upload a statement to get started.
          </p>
        ) : (
          <section className={styles.bankList}>
            {bankGroups.map((g) => {
              const isPlaid = !!g.plaidConnectionId;
              const inst = formatInstitution(g.institutionName);
              const logoData = g.institutionMeta ?? {
                id: g.key,
                name: inst,
                logo: null,
                primaryColor: null,
              };
              const totalBalance = g.accounts.reduce(
                (sum, a) => sum + (a.currentBalance ?? 0),
                0,
              );
              const hasBalance = g.accounts.some(
                (a) => a.currentBalance != null,
              );

              return (
                <div key={g.key} className={styles.bankCard}>
                  <div className={styles.bankHead}>
                    <BankLogo institution={logoData} size={40} />
                    <div className={styles.bankHeadBody}>
                      <div className={styles.bankTitleRow}>
                        <span className={styles.bankName}>{inst}</span>
                        {isPlaid && !g.plaidRequiresReauth && (
                          <span className={styles.liveDot} />
                        )}
                        {g.plaidRequiresReauth && (
                          <span className={styles.warnPill}>needs re-link</span>
                        )}
                      </div>
                      <div className={styles.bankMeta}>
                        {isPlaid ? (
                          <>
                            {g.accounts.length} account
                            {g.accounts.length === 1 ? '' : 's'}
                            {hasBalance && ` · ${formatMoney(totalBalance)}`}
                            {' · linked via Plaid · synced '}
                            {formatRelative(g.plaidLastSyncedAt)}
                          </>
                        ) : (
                          <>
                            {g.uploadStatements.length} statement
                            {g.uploadStatements.length === 1 ? '' : 's'} uploaded
                            {g.uploadStatements.length > 0 && (
                              <>
                                {' · covers '}
                                {formatPeriod(
                                  g.uploadStatements[0].statementPeriodStart,
                                  g.uploadStatements[g.uploadStatements.length - 1]
                                    .statementPeriodEnd,
                                )}
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <div className={styles.bankActions}>
                      {isPlaid && g.plaidConnectionId && (
                        <button
                          type="button"
                          className={styles.disconnectBtn}
                          onClick={() => disconnectBank(g.plaidConnectionId!)}
                        >
                          Disconnect
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Individual accounts */}
                  <ul className={styles.accountList}>
                    {g.accounts.map((a) => (
                      <li key={a.id} className={styles.accountRow}>
                        <div className={styles.accountInfo}>
                          <span className={styles.accountName}>
                            {a.name ?? 'Account'}
                          </span>
                          <span className={styles.accountMeta}>
                            ••{a.accountLast4} ·{' '}
                            {accountTypeLabel(a.type, a.subtype)}
                          </span>
                        </div>
                        <div className={styles.accountRight}>
                          {a.currentBalance != null && (
                            <span className={styles.balanceText}>
                              {formatMoney(a.currentBalance)}
                            </span>
                          )}
                          <span className={styles.txnCount}>
                            {a.transactionCount.toLocaleString()} txns
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>

                  {/* Statements list (for upload-only banks) */}
                  {!isPlaid && g.uploadStatements.length > 0 && (
                    <ul className={styles.statementList}>
                      {g.uploadStatements.map((s) => (
                        <li key={s.id} className={styles.statementRow}>
                          <span className={styles.statementName}>
                            {s.filename}
                          </span>
                          <span className={styles.statementMeta}>
                            {formatPeriod(
                              s.statementPeriodStart,
                              s.statementPeriodEnd,
                            )}
                            {s.transactionCount !== null &&
                              ` · ${s.transactionCount} txns`}
                            {' · '}
                            <span className={styles[`state_${s.parseState}`]}>
                              {s.parseState}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {/* ─── Add another ─── */}
        <div className={styles.addMoreLabel}>Add another</div>

        <div className={styles.searchPanel}>
          <div className={styles.searchRow}>
            <SearchIcon />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search to add another bank — TD, RBC, BMO…"
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
                    {plaidBusy && connectingInstitutionId === inst.id
                      ? 'Opening…'
                      : 'Connect'}{' '}
                    {!(plaidBusy && connectingInstitutionId === inst.id) && (
                      <ArrowIcon />
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {connectError && <p className={styles.error}>{connectError}</p>}

        <div className={styles.orRow}>
          <span className={styles.orLine} />
          <span className={styles.orLabel}>or</span>
          <span className={styles.orLine} />
        </div>

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
              {uploadBusy ? 'Validating…' : 'Upload another statement'}
            </div>
            <div className={styles.uploadSub}>
              PDF or CSV from any bank or credit card
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

        {uploadError && <p className={styles.error}>{uploadError}</p>}
      </main>
    </div>
  );
}
