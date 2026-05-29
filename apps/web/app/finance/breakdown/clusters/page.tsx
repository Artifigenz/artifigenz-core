'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import { useApiClient } from '@/hooks/useApiClient';
import { FinanceIcon } from '@/components/sections/AgentIcons';
import shell from '../../../agent/[name]/page.module.css';
import styles from '../page.module.css';
import local from './page.module.css';

interface Cluster {
  merchantNormalized: string;
  displayName: string;
  logoUrl: string | null;
  website: string | null;
  txnCount: number;
  totalAmount: number;
  inflowAmount: number;
  outflowAmount: number;
  firstSeen: string;
  lastSeen: string;
  category: string | null;
  isRecurring: boolean | null;
}

function formatMoney(amount: number): string {
  const abs = Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return amount < 0 ? `−$${abs}` : `$${abs}`;
}

function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    year: '2-digit',
    month: 'short',
    day: 'numeric',
  });
}

function direction(c: Cluster): 'in' | 'out' | 'mixed' {
  if (c.inflowAmount > 0 && c.outflowAmount === 0) return 'in';
  if (c.outflowAmount > 0 && c.inflowAmount === 0) return 'out';
  return 'mixed';
}

// Stable color per merchant so the initials fallback isn't a bag of random
// colors on every render. Hash the display name into one of 8 tints.
const AVATAR_TINTS = [
  '#1d4ed8', '#0e7490', '#15803d', '#ca8a04',
  '#c2410c', '#be123c', '#7e22ce', '#475569',
];

function avatarTint(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_TINTS[hash % AVATAR_TINTS.length];
}

/**
 * 28x28 avatar that shows the merchant's logo if we have one, falling back
 * to a tinted initials chip. The img onError flips to the fallback when
 * the logo URL is dead or CORS-blocked.
 */
function BrandAvatar({
  logoUrl,
  displayName,
}: {
  logoUrl: string | null;
  displayName: string;
}) {
  const [errored, setErrored] = useState(false);
  const initials = displayName
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';
  const baseStyle: React.CSSProperties = {
    width: '28px',
    height: '28px',
    borderRadius: '6px',
    flexShrink: 0,
    objectFit: 'cover',
    background: 'var(--card-hover, rgba(0,0,0,0.05))',
  };
  if (logoUrl && !errored) {
    return (
      <img
        src={logoUrl}
        alt=""
        loading="lazy"
        style={baseStyle}
        onError={() => setErrored(true)}
      />
    );
  }
  return (
    <div
      style={{
        ...baseStyle,
        background: avatarTint(displayName),
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '0.7rem',
        fontWeight: 600,
        letterSpacing: '0.02em',
      }}
      aria-hidden
    >
      {initials}
    </div>
  );
}

export default function ClustersPage() {
  const api = useApiClient();
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getFinanceClusters();
        if (!cancelled) setClusters(res.clusters);
      } catch (err) {
        if (!cancelled) {
          setError((err as { message?: string })?.message ?? 'Failed to load clusters');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clusters;
    return clusters.filter((c) => {
      const hay = `${c.displayName} ${c.merchantNormalized}`.toLowerCase();
      return hay.includes(q);
    });
  }, [clusters, search]);

  const totals = useMemo(() => {
    let inflow = 0;
    let outflow = 0;
    for (const c of clusters) {
      inflow += c.inflowAmount;
      outflow += c.outflowAmount;
    }
    return { inflow, outflow, count: clusters.length };
  }, [clusters]);

  return (
    <div className={shell.page}>
      <Header />
      <main className={shell.main}>
        <Link href="/finance" className={shell.back}>← Back to Brief</Link>

        <div className={shell.agentHeader}>
          <div>
            <div className={shell.nameRow}>
              <span className={shell.icon}>
                <FinanceIcon />
              </span>
              <h1 className={shell.agentName}>Merchant Clusters</h1>
            </div>
            <p className={shell.since}>
              Every transaction collapsed into one row per merchant — the
              foundation we&apos;ll layer categories on top of next.
            </p>
          </div>
        </div>

        <div className={local.tabs}>
          <Link href="/finance/breakdown" className={local.tab}>
            All Transactions
          </Link>
          <Link href="/finance/breakdown/clusters" className={`${local.tab} ${local.tabActive}`}>
            Merchant Clusters
          </Link>
        </div>

        {loading ? (
          <p className={styles.loading}>Loading clusters…</p>
        ) : error ? (
          <p className={styles.error}>{error}</p>
        ) : (
          <div className={styles.breakdown}>
            <div className={styles.card}>
              <div className={styles.summaryRow}>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Merchants</span>
                  <span className={styles.summaryValue}>{totals.count}</span>
                </div>
                <span style={{ width: '1px', height: '32px', background: 'var(--border-light)' }} />
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Money in</span>
                  <span className={styles.summaryValue} style={{ color: '#16a34a' }}>
                    {formatMoney(totals.inflow)}
                  </span>
                </div>
                <span style={{ width: '1px', height: '32px', background: 'var(--border-light)' }} />
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Money out</span>
                  <span className={styles.summaryValue}>{formatMoney(totals.outflow)}</span>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: '12px',
                  padding: '16px 24px',
                  borderTop: '1px solid var(--border-light)',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}
              >
                <input
                  type="search"
                  placeholder="Search merchants…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{
                    flex: '1 1 240px',
                    minWidth: 0,
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-light)',
                    background: 'var(--input-bg)',
                    fontSize: '0.85rem',
                    fontFamily: 'inherit',
                    color: 'var(--text)',
                  }}
                />
                <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                  Showing {filtered.length} of {totals.count}
                </span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '0.82rem',
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        background: 'var(--card-hover)',
                        borderTop: '1px solid var(--border-light)',
                      }}
                    >
                      <th style={thStyle}>Merchant</th>
                      <th style={thStyle}>Normalized key</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Txns</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Net</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>In</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Out</th>
                      <th style={thStyle}>First → last</th>
                      <th style={thStyle}>Category</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((c) => {
                      const dir = direction(c);
                      return (
                        <tr
                          key={c.merchantNormalized}
                          style={{ borderTop: '1px solid var(--border-light)' }}
                        >
                          <td style={{ ...tdStyle, maxWidth: '320px' }}>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                overflow: 'hidden',
                              }}
                            >
                              <BrandAvatar
                                logoUrl={c.logoUrl}
                                displayName={c.displayName}
                              />
                              <div
                                style={{
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  fontWeight: 500,
                                }}
                              >
                                {c.displayName}
                              </div>
                            </div>
                          </td>
                          <td
                            style={{
                              ...tdStyle,
                              fontSize: '0.74rem',
                              color: 'var(--text-dim)',
                              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                            }}
                          >
                            {c.merchantNormalized}
                          </td>
                          <td
                            style={{
                              ...tdStyle,
                              textAlign: 'right',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {c.txnCount}
                          </td>
                          <td
                            style={{
                              ...tdStyle,
                              textAlign: 'right',
                              fontVariantNumeric: 'tabular-nums',
                              color:
                                dir === 'in'
                                  ? '#16a34a'
                                  : dir === 'out'
                                    ? 'var(--text)'
                                    : 'var(--text-mid)',
                            }}
                          >
                            {formatMoney(c.totalAmount)}
                          </td>
                          <td
                            style={{
                              ...tdStyle,
                              textAlign: 'right',
                              fontVariantNumeric: 'tabular-nums',
                              color: c.inflowAmount > 0 ? '#16a34a' : 'var(--text-dim)',
                            }}
                          >
                            {c.inflowAmount > 0 ? formatMoney(c.inflowAmount) : '—'}
                          </td>
                          <td
                            style={{
                              ...tdStyle,
                              textAlign: 'right',
                              fontVariantNumeric: 'tabular-nums',
                              color: c.outflowAmount > 0 ? 'var(--text)' : 'var(--text-dim)',
                            }}
                          >
                            {c.outflowAmount > 0 ? formatMoney(c.outflowAmount) : '—'}
                          </td>
                          <td
                            style={{
                              ...tdStyle,
                              fontSize: '0.74rem',
                              color: 'var(--text-dim)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {formatDate(c.firstSeen)} → {formatDate(c.lastSeen)}
                          </td>
                          <td
                            style={{
                              ...tdStyle,
                              fontSize: '0.74rem',
                              color: 'var(--text-dim)',
                            }}
                          >
                            {c.category ?? '—'}
                          </td>
                        </tr>
                      );
                    })}
                    {filtered.length === 0 && (
                      <tr>
                        <td
                          colSpan={8}
                          style={{
                            ...tdStyle,
                            textAlign: 'center',
                            padding: '32px',
                            color: 'var(--text-dim)',
                          }}
                        >
                          No merchant clusters match the current filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
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
