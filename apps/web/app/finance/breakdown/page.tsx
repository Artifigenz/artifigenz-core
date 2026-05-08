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

type SectionKey = 'income' | 'subscriptions' | 'loans' | 'other' | 'variable';

export default function BreakdownPage() {
  const api = useApiClient();
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({
    income: false,
    subscriptions: false,
    loans: false,
    other: false,
    variable: false,
  });

  const toggle = (key: SectionKey) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  };

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
            {/* Single Card with Collapsible Categories */}
            <div className={styles.card}>
              {/* Summary Row */}
              <div className={styles.summaryRow}>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Income</span>
                  <span className={styles.summaryValue}>{formatMoney(breakdown.totals.income)}</span>
                </div>
                <span className={styles.summaryMinus}>−</span>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Expenses</span>
                  <span className={styles.summaryValue}>{formatMoney(breakdown.totals.totalExpenses)}</span>
                </div>
                <span className={styles.summaryEquals}>=</span>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Leftover</span>
                  <span className={`${styles.summaryValue} ${breakdown.totals.leftover < 0 ? styles.negative : styles.positive}`}>
                    {formatMoney(breakdown.totals.leftover)}
                  </span>
                </div>
              </div>

              <div className={styles.divider} />

              {/* Income Section */}
              <div className={styles.category}>
                <button
                  className={styles.categoryHeader}
                  onClick={() => toggle('income')}
                  aria-expanded={expanded.income}
                >
                  <div className={styles.categoryLeft}>
                    <span className={`${styles.chevron} ${expanded.income ? styles.open : ''}`}>›</span>
                    <span className={styles.categoryName}>Income</span>
                    {breakdown.income.items.length > 0 && (
                      <span className={styles.categoryCount}>{breakdown.income.items.length} source{breakdown.income.items.length !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                  <span className={styles.categoryTotal}>+{formatMoney(breakdown.totals.income)}</span>
                </button>
                {expanded.income && breakdown.income.items.length > 0 && (
                  <div className={styles.categoryItems}>
                    {breakdown.income.items.map((item) => (
                      <div key={item.id} className={styles.item}>
                        <span className={styles.itemName}>{toTitleCase(item.merchantName)}</span>
                        <span className={styles.itemMeta}>{formatFrequency(item.frequency)}</span>
                        <span className={styles.itemAmount}>{formatMoney(item.monthlyAmount)}/mo</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Subscriptions Section */}
              <div className={styles.category}>
                <button
                  className={styles.categoryHeader}
                  onClick={() => toggle('subscriptions')}
                  aria-expanded={expanded.subscriptions}
                >
                  <div className={styles.categoryLeft}>
                    <span className={`${styles.chevron} ${expanded.subscriptions ? styles.open : ''}`}>›</span>
                    <span className={`${styles.dot} ${styles.s1}`} />
                    <span className={styles.categoryName}>Subscriptions</span>
                    {breakdown.subscriptions.count > 0 && (
                      <span className={styles.categoryCount}>{breakdown.subscriptions.count} active</span>
                    )}
                  </div>
                  <span className={styles.categoryTotal}>−{formatMoney(breakdown.subscriptions.total)}</span>
                </button>
                {expanded.subscriptions && breakdown.subscriptions.items.length > 0 && (
                  <div className={styles.categoryItems}>
                    {breakdown.subscriptions.items.map((item) => (
                      <div key={item.id} className={styles.item}>
                        <span className={styles.itemName}>{toTitleCase(item.merchantName)}</span>
                        <span className={styles.itemMeta}>{formatFrequency(item.frequency)} · Last {formatDate(item.lastDate)}</span>
                        <span className={styles.itemAmount}>{formatMoney(item.monthlyAmount)}/mo</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Loans Section */}
              <div className={styles.category}>
                <button
                  className={styles.categoryHeader}
                  onClick={() => toggle('loans')}
                  aria-expanded={expanded.loans}
                >
                  <div className={styles.categoryLeft}>
                    <span className={`${styles.chevron} ${expanded.loans ? styles.open : ''}`}>›</span>
                    <span className={`${styles.dot} ${styles.s2}`} />
                    <span className={styles.categoryName}>Loan Payments</span>
                    {breakdown.loans.count > 0 && (
                      <span className={styles.categoryCount}>{breakdown.loans.count} {breakdown.loans.count === 1 ? 'line' : 'lines'}</span>
                    )}
                  </div>
                  <span className={styles.categoryTotal}>−{formatMoney(breakdown.loans.total)}</span>
                </button>
                {expanded.loans && breakdown.loans.items.length > 0 && (
                  <div className={styles.categoryItems}>
                    {breakdown.loans.items.map((item) => (
                      <div key={item.id} className={styles.item}>
                        <span className={styles.itemName}>{toTitleCase(item.merchantName)}</span>
                        <span className={styles.itemMeta}>{formatFrequency(item.frequency)} · Last {formatDate(item.lastDate)}</span>
                        <span className={styles.itemAmount}>{formatMoney(item.monthlyAmount)}/mo</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Other Recurring Section */}
              <div className={styles.category}>
                <button
                  className={styles.categoryHeader}
                  onClick={() => toggle('other')}
                  aria-expanded={expanded.other}
                >
                  <div className={styles.categoryLeft}>
                    <span className={`${styles.chevron} ${expanded.other ? styles.open : ''}`}>›</span>
                    <span className={`${styles.dot} ${styles.s3}`} />
                    <span className={styles.categoryName}>Other Recurring</span>
                    {breakdown.other.count > 0 && (
                      <span className={styles.categoryCount}>{breakdown.other.count} items</span>
                    )}
                  </div>
                  <span className={styles.categoryTotal}>−{formatMoney(breakdown.other.total)}</span>
                </button>
                {expanded.other && breakdown.other.items.length > 0 && (
                  <div className={styles.categoryItems}>
                    {breakdown.other.items.map((item) => (
                      <div key={item.id} className={styles.item}>
                        <span className={styles.itemName}>{toTitleCase(item.merchantName)}</span>
                        <span className={styles.itemMeta}>{formatFrequency(item.frequency)} · Last {formatDate(item.lastDate)}</span>
                        <span className={styles.itemAmount}>{formatMoney(item.monthlyAmount)}/mo</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Variable Spend Section */}
              <div className={styles.category}>
                <button
                  className={styles.categoryHeader}
                  onClick={() => toggle('variable')}
                  aria-expanded={expanded.variable}
                >
                  <div className={styles.categoryLeft}>
                    <span className={`${styles.chevron} ${expanded.variable ? styles.open : ''}`}>›</span>
                    <span className={`${styles.dot} ${styles.s4}`} />
                    <span className={styles.categoryName}>Variable Spend</span>
                    <span className={styles.categoryCount}>90-day avg</span>
                  </div>
                  <span className={styles.categoryTotal}>−{formatMoney(breakdown.totals.variableSpend)}</span>
                </button>
                {expanded.variable && (
                  <div className={styles.categoryItems}>
                    <p className={styles.variableNote}>
                      Variable spend is calculated as: Total Expenses − Recurring Outflow.
                      This includes groceries, dining, entertainment, shopping, and other non-recurring purchases.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <p className={styles.footnote}>
              Last updated: {new Date(breakdown.generatedAt).toLocaleString()}
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
