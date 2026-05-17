'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import { PageMode } from '@/components/layout/PageMode';
import { useApiClient } from '@/hooks/useApiClient';
import { FinanceIcon } from '@/components/sections/AgentIcons';
import shell from '../../agent/[name]/page.module.css';
import styles from './page.module.css';

interface Txn {
  id: string;
  date: string;
  description: string;
  merchantName: string | null;
  merchantNormalized: string | null;
  amount: number;
  source: string;
  category: string | null;
  isRecurring: boolean | null;
  accountName: string | null;
  institutionName: string | null;
  accountLast4: string | null;
}

interface TxResponse {
  count: number;
  totals: { income: number; expenses: number; net: number };
  transactions: Txn[];
}

function formatMoney(amount: number): string {
  const formatted = Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return amount < 0 ? `−$${formatted}` : `$${formatted}`;
}

function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    year: '2-digit',
    month: 'short',
    day: 'numeric',
  });
}

function accountLabel(t: Txn): string {
  const inst = t.institutionName ?? '';
  const last4 = t.accountLast4 ? `••${t.accountLast4}` : '';
  if (inst && last4) return `${inst} ${last4}`;
  if (t.accountName) return t.accountName;
  return last4 || '—';
}

export default function BreakdownPage() {
  const api = useApiClient();
  const [data, setData] = useState<TxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getFinanceTransactions();
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) {
          setError((err as { message?: string })?.message ?? 'Failed to load transactions');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [api]);

  const filtered = useMemo(() => {
    if (!data) return [] as Txn[];
    const q = search.trim().toLowerCase();
    if (!q) return data.transactions;
    return data.transactions.filter((t) => {
      const hay = `${t.description} ${t.merchantName ?? ''} ${t.accountName ?? ''} ${t.institutionName ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [data, search]);

  return (
    <div className={shell.page}>
      <PageMode mode="subtle" />
      <Header />
      <main className={shell.main}>
        <Link href="/finance" className={shell.back}>← Back to Brief</Link>

        <div className={shell.agentHeader}>
          <div>
            <div className={shell.nameRow}>
              <span className={shell.icon}><FinanceIcon /></span>
              <h1 className={shell.agentName}>All Transactions</h1>
            </div>
            <p className={shell.since}>
              The consolidated source-of-truth table: every transaction we&apos;ve ingested,
              from Plaid syncs and uploaded statements.
            </p>
          </div>
        </div>

        {loading ? (
          <p className={styles.loading}>Loading transactions...</p>
        ) : error ? (
          <p className={styles.error}>{error}</p>
        ) : data ? (
          <div className={styles.breakdown}>
            <div className={styles.card}>
              <div className={styles.summaryRow}>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Transactions</span>
                  <span className={styles.summaryValue}>{data.count}</span>
                </div>
                <span style={{ width: '1px', height: '32px', background: 'rgba(0,0,0,0.08)' }} />
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Money in</span>
                  <span className={styles.summaryValue} style={{ color: '#16a34a' }}>
                    {formatMoney(data.totals.income)}
                  </span>
                </div>
                <span style={{ width: '1px', height: '32px', background: 'rgba(0,0,0,0.08)' }} />
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Money out</span>
                  <span className={styles.summaryValue}>{formatMoney(data.totals.expenses)}</span>
                </div>
                <span style={{ width: '1px', height: '32px', background: 'rgba(0,0,0,0.08)' }} />
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Net</span>
                  <span
                    className={styles.summaryValue}
                    style={{ color: data.totals.net < 0 ? '#dc2626' : '#16a34a' }}
                  >
                    {formatMoney(data.totals.net)}
                  </span>
                </div>
              </div>

              <div style={{
                display: 'flex',
                gap: '12px',
                padding: '16px 24px',
                borderTop: '1px solid rgba(0,0,0,0.06)',
                flexWrap: 'wrap',
                alignItems: 'center',
              }}>
                <input
                  type="search"
                  placeholder="Search description, merchant, account…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{
                    flex: '1 1 240px',
                    minWidth: 0,
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid rgba(0,0,0,0.1)',
                    background: 'rgba(255,255,255,0.7)',
                    fontSize: '0.85rem',
                    fontFamily: 'inherit',
                    color: 'var(--text)',
                  }}
                />
                <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                  Showing {filtered.length} of {data.count}
                </span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '0.82rem',
                }}>
                  <thead>
                    <tr style={{
                      background: 'rgba(0,0,0,0.02)',
                      borderTop: '1px solid rgba(0,0,0,0.06)',
                    }}>
                      <th style={thStyle}>Date</th>
                      <th style={thStyle}>Description</th>
                      <th style={thStyle}>Merchant</th>
                      <th style={thStyle}>Account</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
                      <th style={thStyle}>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((t) => (
                      <tr key={t.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                        <td style={tdStyle}>{formatDate(t.date)}</td>
                        <td style={{ ...tdStyle, maxWidth: '360px' }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {t.description}
                          </div>
                        </td>
                        <td style={tdStyle}>{t.merchantName ?? '—'}</td>
                        <td style={tdStyle}>{accountLabel(t)}</td>
                        <td style={{
                          ...tdStyle,
                          textAlign: 'right',
                          fontVariantNumeric: 'tabular-nums',
                          color: t.amount < 0 ? '#16a34a' : 'var(--text)',
                        }}>
                          {formatMoney(t.amount)}
                        </td>
                        <td style={{ ...tdStyle, fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                          {t.source}
                        </td>
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ ...tdStyle, textAlign: 'center', padding: '32px', color: 'var(--text-dim)' }}>
                          No transactions match the current filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  fontWeight: 600,
  fontSize: '0.72rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-dim)',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 14px',
  verticalAlign: 'top',
  color: 'var(--text)',
};
