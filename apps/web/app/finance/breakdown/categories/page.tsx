'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import { useApiClient } from '@/hooks/useApiClient';
import { FinanceIcon } from '@/components/sections/AgentIcons';
import shell from '../../../agent/[name]/page.module.css';
import styles from '../page.module.css';
import local from './page.module.css';

interface CategoryBucket {
  category: string;
  label: string;
  count: number;
  totalAbs: number;
  inflow: number;
  outflow: number;
}

function formatMoney(amount: number): string {
  const abs = Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `$${abs}`;
}

// Each visible category gets a short description so users can tell at a
// glance what's in the bucket without having to click in.
const CATEGORY_BLURB: Record<string, string> = {
  internal_transfer: 'Money moving between your own accounts. Excluded from spending totals.',
  income: 'Salary, refunds, deposits — money coming in.',
  subscription: 'Fixed-amount recurring charges (Netflix, Spotify, gym).',
  loan_emi: 'Loan repayments, EMIs, mortgages.',
  fee_interest: 'Bank fees and interest charges.',
  variable_recurring: 'Bills with variable amounts (utilities, phone, groceries).',
  miscellaneous: 'Everything else — one-off purchases.',
  uncategorized: 'Not yet classified.',
};

// Categories the user can drill into (linked detail pages). Others render
// as plain rows for now.
const DRILLABLE = new Set(['internal_transfer']);

export default function CategoriesPage() {
  const api = useApiClient();
  const [buckets, setBuckets] = useState<CategoryBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getFinanceCategories();
        if (!cancelled) setBuckets(res.categories);
      } catch (err) {
        if (!cancelled) {
          setError((err as { message?: string })?.message ?? 'Failed to load categories');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
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
              <h1 className={shell.agentName}>Categories</h1>
            </div>
            <p className={shell.since}>How your money breaks down by purpose.</p>
          </div>
        </div>

        <div className={local.tabs}>
          <Link href="/finance/breakdown" className={local.tab}>
            All Transactions
          </Link>
          <Link href="/finance/breakdown/clusters" className={local.tab}>
            Merchant Clusters
          </Link>
          <Link href="/finance/breakdown/categories" className={`${local.tab} ${local.tabActive}`}>
            Categories
          </Link>
        </div>

        {loading ? (
          <p className={styles.loading}>Loading categories…</p>
        ) : error ? (
          <p className={styles.loading}>Error: {error}</p>
        ) : buckets.length === 0 ? (
          <p className={styles.loading}>
            No categorized transactions yet. Categorization runs in the background after
            ingestion — give it a minute.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
            {buckets.map((b) => {
              const drillable = DRILLABLE.has(b.category);
              const inner = (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    padding: '16px 18px',
                    border: '1px solid var(--border-light)',
                    borderRadius: '12px',
                    background: 'var(--bg)',
                    transition: 'background 0.15s ease',
                    cursor: drillable ? 'pointer' : 'default',
                  }}
                  onMouseEnter={(e) => {
                    if (drillable) e.currentTarget.style.background = 'var(--card-hover)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--bg)';
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                      <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
                        {b.label}
                      </h3>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                        {b.count} txn{b.count === 1 ? '' : 's'}
                      </span>
                    </div>
                    <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'var(--text-mid)' }}>
                      {CATEGORY_BLURB[b.category] ?? '—'}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    <div style={{ fontSize: '0.95rem', fontWeight: 500 }}>
                      {formatMoney(b.totalAbs)}
                    </div>
                    {b.inflow > 0 && b.outflow > 0 && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '2px' }}>
                        in {formatMoney(b.inflow)} · out {formatMoney(b.outflow)}
                      </div>
                    )}
                  </div>
                  {drillable && (
                    <span style={{ color: 'var(--text-dim)', fontSize: '1.2rem' }}>→</span>
                  )}
                </div>
              );
              if (drillable) {
                const href = b.category === 'internal_transfer'
                  ? '/finance/breakdown/categories/internal-transfers'
                  : '#';
                return (
                  <Link
                    key={b.category}
                    href={href}
                    style={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    {inner}
                  </Link>
                );
              }
              return <div key={b.category}>{inner}</div>;
            })}
          </div>
        )}
      </main>
    </div>
  );
}
