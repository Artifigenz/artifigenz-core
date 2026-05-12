'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import { useApiClient } from '@/hooks/useApiClient';
import { FinanceIcon } from '@/components/sections/AgentIcons';
import shell from '../../agent/[name]/page.module.css';
import styles from './page.module.css';

type Account = Awaited<ReturnType<ReturnType<typeof useApiClient>['getFinanceAccounts']>>['accounts'][number];

function formatMoney(amount: number | null, currency?: string | null): string {
  if (amount == null) return '—';
  const abs = Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sym = currency === 'CAD' ? '$' : '$';
  return amount < 0 ? `−${sym}${abs}` : `${sym}${abs}`;
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

export default function AccountsPage() {
  const api = useApiClient();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getFinanceAccounts();
        if (!cancelled) setAccounts(res.accounts);
      } catch (err) {
        if (!cancelled) {
          setError((err as { message?: string })?.message ?? 'Failed to load accounts');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [api]);

  return (
    <div className={shell.page}>
      <Header />
      <main className={shell.main}>
        <Link href="/finance" className={shell.back}>← Back to Brief</Link>

        <div className={shell.agentHeader}>
          <div>
            <div className={shell.nameRow}>
              <span className={shell.icon}><FinanceIcon /></span>
              <h1 className={shell.agentName}>Accounts</h1>
            </div>
            <p className={shell.since}>
              Every account connected to your finance agent — Plaid links and uploaded statements alike.
            </p>
          </div>
        </div>

        {loading ? (
          <p className={styles.loading}>Loading accounts…</p>
        ) : error ? (
          <p className={styles.error}>{error}</p>
        ) : accounts.length === 0 ? (
          <p className={styles.empty}>No accounts yet. Onboard the finance agent to add a bank or upload statements.</p>
        ) : (
          <ul className={styles.list}>
            {accounts.map((a) => {
              const institution = a.institutionName
                ? a.institutionName
                    .split(' ')
                    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                    .join(' ')
                : 'Unknown institution';
              const last4 = a.accountLast4 ?? '????';
              const typeLabel = accountTypeLabel(a.type, a.subtype);

              return (
                <li key={a.id} className={styles.row}>
                  <div className={styles.rowHead}>
                    <div className={styles.rowTitle}>
                      <span className={styles.institution}>{institution}</span>
                      <span className={styles.last4}>••{last4}</span>
                      <span className={styles.typeBadge}>{typeLabel}</span>
                    </div>
                    <div className={styles.txnCount}>
                      {a.transactionCount.toLocaleString()} txns
                    </div>
                  </div>

                  <div className={styles.rowMeta}>
                    {a.plaid && (
                      <div className={styles.metaLine}>
                        <span className={styles.sourceDot} />
                        <span>
                          {a.currentBalance !== null && (
                            <strong className={styles.balance}>
                              {formatMoney(a.currentBalance, a.isoCurrencyCode)}
                            </strong>
                          )}
                          <span className={styles.metaDim}>
                            {a.currentBalance !== null && ' · '}
                            via Plaid · last synced {formatRelative(a.plaid.lastSyncedAt)}
                            {a.plaid.requiresReauth && ' · needs re-link'}
                          </span>
                        </span>
                      </div>
                    )}
                    {a.upload && a.upload.statements.length > 0 && (
                      <div className={styles.metaLine}>
                        <span className={styles.sourceDot} />
                        <span>
                          <strong>{a.upload.statements.length}</strong>
                          <span className={styles.metaDim}>
                            {' '}statement{a.upload.statements.length === 1 ? '' : 's'} uploaded · covers{' '}
                            {formatPeriod(
                              a.upload.statements[0].statementPeriodStart,
                              a.upload.statements[a.upload.statements.length - 1].statementPeriodEnd,
                            )}
                          </span>
                        </span>
                      </div>
                    )}
                    {!a.plaid && !a.upload && (
                      <div className={styles.metaLine}>
                        <span className={styles.metaDim}>No source — orphan account row</span>
                      </div>
                    )}
                  </div>

                  {a.upload && a.upload.statements.length > 0 && (
                    <ul className={styles.statementList}>
                      {a.upload.statements.map((s) => (
                        <li key={s.id} className={styles.statementRow}>
                          <span className={styles.statementName}>{s.filename}</span>
                          <span className={styles.statementMeta}>
                            {formatPeriod(s.statementPeriodStart, s.statementPeriodEnd)}
                            {s.transactionCount !== null && ` · ${s.transactionCount} txns`}
                            {' · '}
                            <span className={styles[`state_${s.parseState}`]}>{s.parseState}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
