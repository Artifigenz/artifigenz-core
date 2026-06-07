'use client';

import { useCallback, useEffect, useState } from 'react';
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

interface PairedTransfer {
  pairId: string;
  fromLabel: string;
  toLabel: string;
  amount: number;
  date: string;
  systemCategory: string | null;
  outDescription: string;
  inDescription: string;
}

interface UnpairedTransfer {
  id: string;
  label: string;
  direction: 'in' | 'out' | null;
  amount: number;
  date: string;
  description: string;
  systemCategory: string | null;
  reasoning: string | null;
}

interface InternalTransferData {
  pairs: PairedTransfer[];
  unpaired: UnpairedTransfer[];
  total: number;
}

function formatMoney(amount: number): string {
  const abs = Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `$${abs}`;
}

function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    year: '2-digit',
    month: 'short',
    day: 'numeric',
  });
}

// Each visible category gets a short description so users can tell at a
// glance what's in the bucket without having to expand it.
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

// Categories that have expandable detail content. Adding a category here
// means we need a matching loader + renderer below.
const EXPANDABLE = new Set(['internal_transfer']);

export default function CategoriesPage() {
  const api = useApiClient();
  const [buckets, setBuckets] = useState<CategoryBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-category expansion + lazy-loaded detail cache. Once a category is
  // opened the data stays in memory until the page unmounts — collapsing
  // and re-opening is instant.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [internalTransfers, setInternalTransfers] =
    useState<InternalTransferData | null>(null);
  const [loadingInternalTransfers, setLoadingInternalTransfers] = useState(false);

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

  const ensureInternalTransfersLoaded = useCallback(async () => {
    if (internalTransfers || loadingInternalTransfers) return;
    setLoadingInternalTransfers(true);
    try {
      const data = await api.getFinanceInternalTransfers();
      setInternalTransfers(data);
    } catch {
      // Soft-fail — show an inline message in the panel rather than
      // breaking the whole categories list.
    } finally {
      setLoadingInternalTransfers(false);
    }
  }, [api, internalTransfers, loadingInternalTransfers]);

  const toggle = useCallback(
    (category: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(category)) {
          next.delete(category);
        } else {
          next.add(category);
          if (category === 'internal_transfer') void ensureInternalTransfersLoaded();
        }
        return next;
      });
    },
    [ensureInternalTransfersLoaded],
  );

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
              const expandable = EXPANDABLE.has(b.category);
              const isOpen = expanded.has(b.category);

              return (
                <div
                  key={b.category}
                  style={{
                    border: '1px solid var(--border-light)',
                    borderRadius: '12px',
                    background: 'var(--bg)',
                    overflow: 'hidden',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => expandable && toggle(b.category)}
                    disabled={!expandable}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '16px',
                      padding: '16px 18px',
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      color: 'inherit',
                      font: 'inherit',
                      textAlign: 'left',
                      cursor: expandable ? 'pointer' : 'default',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (expandable) e.currentTarget.style.background = 'var(--card-hover)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
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
                    {expandable && (
                      <span
                        aria-hidden
                        style={{
                          display: 'inline-flex',
                          color: 'var(--text-dim)',
                          transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 0.2s ease',
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </span>
                    )}
                  </button>

                  {expandable && isOpen && (
                    <div
                      style={{
                        borderTop: '1px solid var(--border-light)',
                        padding: '16px 18px 20px',
                        background: 'var(--card-hover)',
                      }}
                    >
                      {b.category === 'internal_transfer' && (
                        <InternalTransfersPanel
                          data={internalTransfers}
                          loading={loadingInternalTransfers}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function InternalTransfersPanel({
  data,
  loading,
}: {
  data: InternalTransferData | null;
  loading: boolean;
}) {
  if (loading && !data) {
    return <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-mid)' }}>Loading transfers…</p>;
  }
  if (!data) {
    return <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-mid)' }}>Couldn&apos;t load transfer detail.</p>;
  }
  const totalRows = data.pairs.length + data.unpaired.length;
  if (totalRows === 0) {
    return <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-mid)' }}>No internal transfers detected yet.</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          fontSize: '0.78rem',
          color: 'var(--text-mid)',
        }}
      >
        <span>
          {data.pairs.length} paired · {data.unpaired.length} unpaired · {totalRows} total
        </span>
      </div>

      {data.pairs.length > 0 && (
        <section>
          <h4
            style={{
              fontSize: '0.7rem',
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              color: 'var(--text-dim)',
              margin: '0 0 8px',
            }}
          >
            Paired transfers
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {data.pairs.map((p) => (
              <div
                key={p.pairId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 12px',
                  background: 'var(--bg)',
                  border: '1px solid var(--border-light)',
                  borderRadius: '8px',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '0.88rem',
                      fontWeight: 500,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span>{p.fromLabel}</span>
                    <span style={{ color: 'var(--text-dim)' }}>→</span>
                    <span>{p.toLabel}</span>
                    {p.systemCategory === 'credit_card_payment' && (
                      <span
                        style={{
                          marginLeft: '4px',
                          fontSize: '0.66rem',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: 'var(--card-hover)',
                          color: 'var(--text-mid)',
                          fontWeight: 400,
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                        }}
                      >
                        Card payment
                      </span>
                    )}
                  </div>
                  <div style={{ marginTop: '2px', fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                    {formatDate(p.date)}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: '0.9rem',
                    fontWeight: 500,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatMoney(p.amount)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.unpaired.length > 0 && (
        <section>
          <h4
            style={{
              fontSize: '0.7rem',
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              color: 'var(--text-dim)',
              margin: '0 0 4px',
            }}
          >
            Unpaired internal transfers
          </h4>
          <p
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-mid)',
              margin: '0 0 8px',
            }}
          >
            The other side of these isn&apos;t in your connected accounts — we still exclude them from spending.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {data.unpaired.map((u) => (
              <div
                key={u.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 12px',
                  background: 'var(--bg)',
                  border: '1px solid var(--border-light)',
                  borderRadius: '8px',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '0.85rem',
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {u.description}
                  </div>
                  <div style={{ marginTop: '2px', fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                    {u.label} · {formatDate(u.date)}
                    {u.direction && (
                      <>
                        {' '}
                        ·{' '}
                        <span
                          style={{
                            color:
                              u.direction === 'in' ? '#16a34a' : 'var(--text-mid)',
                          }}
                        >
                          {u.direction === 'in' ? 'inflow' : 'outflow'}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: '0.9rem',
                    fontWeight: 500,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatMoney(u.amount)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
