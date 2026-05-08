'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import { useApiClient } from '@/hooks/useApiClient';
import { FinanceIcon } from '@/components/sections/AgentIcons';
import shell from '../../agent/[name]/page.module.css';
import styles from './page.module.css';

interface BreakdownItem {
  id: string;
  merchantName: string;
  description: string | null;
  amount: number;
  monthlyAmount: number;
  frequency: string;
  lastDate: string | null;
  nextDate: string | null;
  accountId: string | null;
  pfcPrimary?: string | null;
}

interface Account {
  id: string;
  name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  currentBalance: number;
  availableBalance: number | null;
  currency: string | null;
}

interface Breakdown {
  generatedAt: string;
  accounts: Account[];
  income: { total: number; items: BreakdownItem[] };
  transfersIn: { total: number; count: number; items: BreakdownItem[] };
  subscriptions: { total: number; count: number; items: BreakdownItem[] };
  loans: { total: number; count: number; items: BreakdownItem[] };
  other: { total: number; count: number; items: BreakdownItem[] };
  totals: {
    income: number;
    recurringOutflow: number;
    totalExpenses: number;
    variableSpend: number;
    leftover: number;
  };
}

function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .split(/[\s-_]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatMoney(amount: number): string {
  const formatted = Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return amount < 0 ? `−$${formatted}` : `$${formatted}`;
}

function formatFrequency(freq: string): string {
  const map: Record<string, string> = {
    WEEKLY: 'Weekly',
    BIWEEKLY: 'Bi-weekly',
    SEMI_MONTHLY: 'Twice/mo',
    MONTHLY: 'Monthly',
    ANNUALLY: 'Yearly',
  };
  return map[freq.toUpperCase()] ?? freq;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function BreakdownPage() {
  const api = useApiClient();
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await api.getBriefBreakdown();
        if (!cancelled) setBreakdown(data);
      } catch (err) {
        if (!cancelled) {
          setError((err as { message?: string })?.message ?? 'Failed to load breakdown');
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
              <h1 className={shell.agentName}>Financial Breakdown</h1>
            </div>
            <p className={shell.since}>
              Detailed view of how your numbers are calculated
            </p>
          </div>
        </div>

        {loading ? (
          <p className={styles.loading}>Loading breakdown...</p>
        ) : error ? (
          <p className={styles.error}>{error}</p>
        ) : breakdown ? (
          <div className={styles.breakdown}>
            {/* Summary Cards */}
            <section className={styles.summarySection}>
              <h2 className={styles.sectionTitle}>Summary</h2>
              <div className={styles.summaryGrid}>
                <div className={styles.summaryCard}>
                  <span className={styles.summaryLabel}>Monthly Income</span>
                  <span className={styles.summaryValue}>{formatMoney(breakdown.totals.income)}</span>
                </div>
                <div className={styles.summaryCard}>
                  <span className={styles.summaryLabel}>Recurring Outflow</span>
                  <span className={styles.summaryValue}>{formatMoney(breakdown.totals.recurringOutflow)}</span>
                </div>
                <div className={styles.summaryCard}>
                  <span className={styles.summaryLabel}>Variable Spend</span>
                  <span className={styles.summaryValue}>{formatMoney(breakdown.totals.variableSpend)}</span>
                </div>
                <div className={styles.summaryCard}>
                  <span className={styles.summaryLabel}>Total Expenses</span>
                  <span className={styles.summaryValue}>{formatMoney(breakdown.totals.totalExpenses)}</span>
                </div>
                <div className={`${styles.summaryCard} ${breakdown.totals.leftover < 0 ? styles.negative : styles.positive}`}>
                  <span className={styles.summaryLabel}>Monthly Leftover</span>
                  <span className={styles.summaryValue}>{formatMoney(breakdown.totals.leftover)}</span>
                </div>
              </div>
            </section>

            {/* Calculation Explanation */}
            <section className={styles.calcSection}>
              <h2 className={styles.sectionTitle}>How It&apos;s Calculated</h2>
              <div className={styles.calcTable}>
                <div className={styles.calcRow}>
                  <span className={styles.calcLabel}>Income (monthly)</span>
                  <span className={styles.calcValue}>{formatMoney(breakdown.totals.income)}</span>
                </div>
                <div className={styles.calcRow}>
                  <span className={styles.calcLabel}>− Subscriptions ({breakdown.subscriptions.count})</span>
                  <span className={styles.calcValue}>{formatMoney(breakdown.subscriptions.total)}</span>
                </div>
                <div className={styles.calcRow}>
                  <span className={styles.calcLabel}>− Loans & EMI ({breakdown.loans.count})</span>
                  <span className={styles.calcValue}>{formatMoney(breakdown.loans.total)}</span>
                </div>
                <div className={styles.calcRow}>
                  <span className={styles.calcLabel}>− Other Recurring ({breakdown.other.count})</span>
                  <span className={styles.calcValue}>{formatMoney(breakdown.other.total)}</span>
                </div>
                <div className={styles.calcRow}>
                  <span className={styles.calcLabel}>− Variable Spend (90-day avg)</span>
                  <span className={styles.calcValue}>{formatMoney(breakdown.totals.variableSpend)}</span>
                </div>
                <div className={`${styles.calcRow} ${styles.calcTotal}`}>
                  <span className={styles.calcLabel}>= Leftover</span>
                  <span className={styles.calcValue}>{formatMoney(breakdown.totals.leftover)}</span>
                </div>
              </div>
            </section>

            {/* Connected Accounts */}
            {breakdown.accounts.length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Connected Accounts ({breakdown.accounts.length})</h2>
                <div className={styles.table}>
                  <div className={styles.tableHeader}>
                    <span>Account</span>
                    <span>Type</span>
                    <span className={styles.alignRight}>Balance</span>
                  </div>
                  {breakdown.accounts.map((account) => (
                    <div key={account.id} className={styles.tableRow}>
                      <span className={styles.merchantName}>
                        {account.name ?? 'Account'} {account.mask ? `••${account.mask}` : ''}
                      </span>
                      <span className={styles.secondary}>{account.subtype ?? account.type ?? '—'}</span>
                      <span className={styles.alignRight}>{formatMoney(account.currentBalance)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Income Streams */}
            {breakdown.income.items.length > 0 && (
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <h2 className={styles.sectionTitle}>Income Sources</h2>
                  <span className={styles.sectionTotal}>{formatMoney(breakdown.income.total)}/mo</span>
                </div>
                <div className={styles.table}>
                  <div className={styles.tableHeader}>
                    <span>Source</span>
                    <span>Frequency</span>
                    <span className={styles.alignRight}>Amount</span>
                    <span className={styles.alignRight}>Monthly</span>
                  </div>
                  {breakdown.income.items.map((item) => (
                    <div key={item.id} className={styles.tableRow}>
                      <span className={styles.merchantName}>{toTitleCase(item.merchantName)}</span>
                      <span className={styles.secondary}>{formatFrequency(item.frequency)}</span>
                      <span className={styles.alignRight}>{formatMoney(item.amount)}</span>
                      <span className={`${styles.alignRight} ${styles.bold}`}>{formatMoney(item.monthlyAmount)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Transfers In (not counted as income) */}
            {breakdown.transfersIn?.items.length > 0 && (
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <h2 className={styles.sectionTitle}>
                    <span className={styles.muted}>Other Inflows</span>
                  </h2>
                  <span className={`${styles.sectionTotal} ${styles.muted}`}>not counted as income</span>
                </div>
                <p className={styles.sectionNote}>
                  These are internal transfers, refunds, or reimbursements — not actual income.
                </p>
                <div className={styles.table}>
                  <div className={styles.tableHeader}>
                    <span>Source</span>
                    <span>Category</span>
                    <span>Frequency</span>
                    <span className={styles.alignRight}>Amount</span>
                    <span className={styles.alignRight}>Monthly</span>
                  </div>
                  {breakdown.transfersIn.items.map((item) => (
                    <div key={item.id} className={`${styles.tableRow} ${styles.mutedRow}`}>
                      <span className={styles.merchantName}>{toTitleCase(item.merchantName)}</span>
                      <span className={styles.secondary}>{item.pfcPrimary ?? 'Transfer'}</span>
                      <span className={styles.secondary}>{formatFrequency(item.frequency)}</span>
                      <span className={styles.alignRight}>{formatMoney(item.amount)}</span>
                      <span className={styles.alignRight}>{formatMoney(item.monthlyAmount)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Subscriptions */}
            {breakdown.subscriptions.items.length > 0 && (
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <h2 className={styles.sectionTitle}>
                    <span className={`${styles.dot} ${styles.s1}`} />
                    Subscriptions ({breakdown.subscriptions.count})
                  </h2>
                  <span className={styles.sectionTotal}>{formatMoney(breakdown.subscriptions.total)}/mo</span>
                </div>
                <div className={styles.table}>
                  <div className={styles.tableHeader}>
                    <span>Service</span>
                    <span>Frequency</span>
                    <span>Last Charged</span>
                    <span className={styles.alignRight}>Amount</span>
                    <span className={styles.alignRight}>Monthly</span>
                  </div>
                  {breakdown.subscriptions.items.map((item) => (
                    <div key={item.id} className={styles.tableRow}>
                      <span className={styles.merchantName}>{toTitleCase(item.merchantName)}</span>
                      <span className={styles.secondary}>{formatFrequency(item.frequency)}</span>
                      <span className={styles.secondary}>{formatDate(item.lastDate)}</span>
                      <span className={styles.alignRight}>{formatMoney(item.amount)}</span>
                      <span className={`${styles.alignRight} ${styles.bold}`}>{formatMoney(item.monthlyAmount)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Loans & EMI */}
            {breakdown.loans.items.length > 0 && (
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <h2 className={styles.sectionTitle}>
                    <span className={`${styles.dot} ${styles.s2}`} />
                    Loans & EMI ({breakdown.loans.count})
                  </h2>
                  <span className={styles.sectionTotal}>{formatMoney(breakdown.loans.total)}/mo</span>
                </div>
                <div className={styles.table}>
                  <div className={styles.tableHeader}>
                    <span>Lender</span>
                    <span>Frequency</span>
                    <span>Last Payment</span>
                    <span className={styles.alignRight}>Amount</span>
                    <span className={styles.alignRight}>Monthly</span>
                  </div>
                  {breakdown.loans.items.map((item) => (
                    <div key={item.id} className={styles.tableRow}>
                      <span className={styles.merchantName}>{toTitleCase(item.merchantName)}</span>
                      <span className={styles.secondary}>{formatFrequency(item.frequency)}</span>
                      <span className={styles.secondary}>{formatDate(item.lastDate)}</span>
                      <span className={styles.alignRight}>{formatMoney(item.amount)}</span>
                      <span className={`${styles.alignRight} ${styles.bold}`}>{formatMoney(item.monthlyAmount)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Other Recurring */}
            {breakdown.other.items.length > 0 && (
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <h2 className={styles.sectionTitle}>
                    <span className={`${styles.dot} ${styles.s3}`} />
                    Other Recurring ({breakdown.other.count})
                  </h2>
                  <span className={styles.sectionTotal}>{formatMoney(breakdown.other.total)}/mo</span>
                </div>
                <div className={styles.table}>
                  <div className={styles.tableHeader}>
                    <span>Payee</span>
                    <span>Frequency</span>
                    <span>Last Payment</span>
                    <span className={styles.alignRight}>Amount</span>
                    <span className={styles.alignRight}>Monthly</span>
                  </div>
                  {breakdown.other.items.map((item) => (
                    <div key={item.id} className={styles.tableRow}>
                      <span className={styles.merchantName}>{toTitleCase(item.merchantName)}</span>
                      <span className={styles.secondary}>{formatFrequency(item.frequency)}</span>
                      <span className={styles.secondary}>{formatDate(item.lastDate)}</span>
                      <span className={styles.alignRight}>{formatMoney(item.amount)}</span>
                      <span className={`${styles.alignRight} ${styles.bold}`}>{formatMoney(item.monthlyAmount)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <p className={styles.footnote}>
              Last updated: {new Date(breakdown.generatedAt).toLocaleString()}
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
