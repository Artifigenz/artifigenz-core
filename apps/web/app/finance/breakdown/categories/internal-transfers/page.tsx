'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import { useApiClient } from '@/hooks/useApiClient';
import { FinanceIcon } from '@/components/sections/AgentIcons';
import shell from '../../../../agent/[name]/page.module.css';
import styles from '../../page.module.css';
import local from './page.module.css';

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

export default function InternalTransfersPage() {
  const api = useApiClient();
  const [pairs, setPairs] = useState<PairedTransfer[]>([]);
  const [unpaired, setUnpaired] = useState<UnpairedTransfer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getFinanceInternalTransfers();
        if (!cancelled) {
          setPairs(res.pairs);
          setUnpaired(res.unpaired);
          setTotal(res.total);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as { message?: string })?.message ?? 'Failed to load');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const totalRows = pairs.length + unpaired.length;

  return (
    <div className={shell.page}>
      <Header />
      <main className={shell.main}>
        <Link href="/finance/breakdown/categories" className={shell.back}>← Categories</Link>

        <div className={shell.agentHeader}>
          <div>
            <div className={shell.nameRow}>
              <span className={shell.icon}><FinanceIcon /></span>
              <h1 className={shell.agentName}>Internal Transfers</h1>
            </div>
            <p className={shell.since}>
              Money moving between your own accounts. Excluded from spending totals.
            </p>
          </div>
        </div>

        {loading ? (
          <p className={styles.loading}>Loading transfers…</p>
        ) : error ? (
          <p className={styles.loading}>Error: {error}</p>
        ) : totalRows === 0 ? (
          <p className={styles.loading}>
            No internal transfers detected yet. They&apos;ll appear here once they&apos;re classified
            in the background.
          </p>
        ) : (
          <>
            {/* Summary band */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                padding: '14px 18px',
                border: '1px solid var(--border-light)',
                borderRadius: '12px',
                background: 'var(--card-hover)',
                marginTop: '12px',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <span style={{ fontSize: '0.82rem', color: 'var(--text-mid)' }}>
                {pairs.length} paired · {unpaired.length} unpaired · {totalRows} total
              </span>
              <span style={{ fontSize: '1.05rem', fontWeight: 600 }}>
                {formatMoney(total)}
              </span>
            </div>

            {/* Paired transfers */}
            {pairs.length > 0 && (
              <section style={{ marginTop: '24px' }}>
                <h2 style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-dim)', margin: '0 0 10px' }}>
                  Paired transfers
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {pairs.map((p) => (
                    <div
                      key={p.pairId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px 16px',
                        border: '1px solid var(--border-light)',
                        borderRadius: '10px',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.92rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>{p.fromLabel}</span>
                          <span style={{ color: 'var(--text-dim)' }}>→</span>
                          <span>{p.toLabel}</span>
                          {p.systemCategory === 'credit_card_payment' && (
                            <span
                              style={{
                                marginLeft: '8px',
                                fontSize: '0.68rem',
                                padding: '2px 7px',
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
                        <div style={{ marginTop: '3px', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                          {formatDate(p.date)}
                        </div>
                      </div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                        {formatMoney(p.amount)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Unpaired transfers */}
            {unpaired.length > 0 && (
              <section style={{ marginTop: '24px' }}>
                <h2 style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-dim)', margin: '0 0 4px' }}>
                  Unpaired internal transfers
                </h2>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-mid)', margin: '0 0 12px' }}>
                  The other side of these moves isn&apos;t in your connected accounts — we can&apos;t
                  show the destination, but we&apos;re still excluding them from spending.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {unpaired.map((u) => (
                    <div
                      key={u.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px 16px',
                        border: '1px solid var(--border-light)',
                        borderRadius: '10px',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.9rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {u.description}
                        </div>
                        <div style={{ marginTop: '3px', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                          {u.label} · {formatDate(u.date)}
                          {u.direction && (
                            <> · <span style={{ color: u.direction === 'in' ? '#16a34a' : 'var(--text-mid)' }}>{u.direction === 'in' ? 'inflow' : 'outflow'}</span></>
                          )}
                        </div>
                      </div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                        {formatMoney(u.amount)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
