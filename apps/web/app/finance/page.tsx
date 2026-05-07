'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { usePlaidLink } from 'react-plaid-link';
import Header from '@/components/layout/Header';
import ChatInput from '@/components/sections/ChatInput';
import { useApiClient } from '@/hooks/useApiClient';
import { useActivatedAgents } from '@/hooks/useActivatedAgents';
import { FinanceIcon } from '@/components/sections/AgentIcons';
import { savePlaidPending, clearPlaidPending } from '@/lib/plaid-pending';
import shell from '../agent/[name]/page.module.css';
import styles from './page.module.css';


interface BriefNumber {
  value: string;
  phrase: string;
}

interface BreakdownItem {
  id: string;
  label: string;
  sublabel: string;
  amount: number;
  count?: number;
}

interface FinanceSummary {
  income: number;
  outflow: number;
  leftover: number;
  breakdown: BreakdownItem[];
}

interface Brief {
  id: string;
  verdict: string;
  numbers: BriefNumber[];
  paragraph: string;
  summary: FinanceSummary;
  data_scope: string;
  generated_at: string;
}

function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .split(/[\s-_]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatMoney(amount: number): string {
  const absAmount = Math.abs(amount);
  if (absAmount >= 1000) {
    return `$${absAmount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }
  return `$${absAmount.toFixed(0)}`;
}

interface Insight {
  id: string;
  title: string;
  description: string | null;
  insightTypeId: string;
  data: Record<string, unknown>;
  isCritical: boolean;
  isRead: boolean;
  createdAt: string;
}

interface Connection {
  id: string;
  displayName: string | null;
  status: string;
  institutionName: string | null;
  lastSyncedAt: string | null;
  accounts: { id: string; name: string; mask: string | null }[];
}

interface DeliveryPrefs {
  email: { enabled: boolean; address: string | null };
  telegram: { enabled: boolean; chatId: string | null };
  whatsapp: { enabled: boolean; number: string | null };
}

type SettingsTab = 'accounts' | 'delivery' | 'devtools';

function formatSince(iso: number): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

function formatAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function formatAmount(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

interface InsightData {
  merchant?: string;
  amount?: number;
  oldAmount?: number;
  newAmount?: number;
  count?: number;
  monthlyTotal?: number;
  daysUntil?: number;
  [key: string]: unknown;
}

function renderInsightTitle(
  typeId: string,
  title: string,
  data: InsightData | null
): React.ReactNode {
  // If no structured data, return plain title
  if (!data) return title;

  const merchant = data.merchant ? toTitleCase(data.merchant) : '';

  // Welcome insight: "Monitoring X subscriptions"
  if (typeId.includes('welcome') && data.count !== undefined) {
    return (
      <>
        <span className={styles.textLight}>Monitoring </span>
        <span className={styles.textBold}>{data.count} subscriptions</span>
      </>
    );
  }

  // Price change: "Netflix increased $15.99 → $17.99"
  if (typeId.includes('price-change') && merchant && data.oldAmount !== undefined && data.newAmount !== undefined) {
    const direction = data.newAmount > data.oldAmount ? 'increased' : 'decreased';
    return (
      <>
        <span className={styles.textBold}>{merchant}</span>
        <span className={styles.textLight}> {direction} </span>
        <span className={styles.textMedium}>{formatAmount(data.oldAmount)}</span>
        <span className={styles.textLight}> → </span>
        <span className={styles.textBold}>{formatAmount(data.newAmount)}</span>
      </>
    );
  }

  // Charged: "Spotify charged $12.99 — as expected."
  if (typeId.includes('charged') && merchant && data.amount !== undefined) {
    return (
      <>
        <span className={styles.textBold}>{merchant}</span>
        <span className={styles.textLight}> charged </span>
        <span className={styles.textBold}>{formatAmount(data.amount)}</span>
        <span className={styles.textLight}> — as expected.</span>
      </>
    );
  }

  // Upcoming: "Netflix will charge $23.99 tomorrow."
  if (typeId.includes('upcoming') && merchant && data.amount !== undefined) {
    const dayLabel = data.daysUntil === 0 ? 'today' : data.daysUntil === 1 ? 'tomorrow' : `in ${data.daysUntil} days`;
    return (
      <>
        <span className={styles.textBold}>{merchant}</span>
        <span className={styles.textLight}> will charge </span>
        <span className={styles.textBold}>{formatAmount(data.amount)}</span>
        <span className={styles.textLight}> {dayLabel}.</span>
      </>
    );
  }

  // New subscription: "New subscription: Netflix"
  if (typeId.endsWith('.new') && merchant) {
    return (
      <>
        <span className={styles.textLight}>New subscription: </span>
        <span className={styles.textBold}>{merchant}</span>
      </>
    );
  }

  // Fallback to plain title
  return title;
}

export default function FinanceBriefPage() {
  const api = useApiClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { getActivation } = useActivatedAgents();
  const activation = getActivation('finance');

  const [brief, setBrief] = useState<Brief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(true);

  // Settings modal state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('accounts');
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [delivery, setDelivery] = useState<DeliveryPrefs | null>(null);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [deliverySaving, setDeliverySaving] = useState(false);
  const [disconnectConfirm, setDisconnectConfirm] = useState<Connection | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [plaidBusy, setPlaidBusy] = useState(false);
  const [resettingSkill, setResettingSkill] = useState(false);
  const [clearingInsights, setClearingInsights] = useState(false);
  const [debugInfo, setDebugInfo] = useState<{
    transactionCount: number;
    insightCount: number;
    skillRecord: { exists: boolean; state?: unknown; lastRunAt?: string };
    sampleTransactions: Array<{ merchant: string | null; description: string; amount: string; date: string }>;
  } | null>(null);
  const [loadingDebug, setLoadingDebug] = useState(false);

  // Dev-only: ?regen triggers fresh brief generation
  const shouldRegen = searchParams.get('regen') === '1';

  useEffect(() => {
    let cancelled = false;

    async function waitForGeneration(generationId: string): Promise<void> {
      const res = await api.briefEventsResponse(generationId);
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done || cancelled) break;
        buffer += decoder.decode(value, { stream: true });

        let sepIdx;
        while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);
          const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          try {
            const event = JSON.parse(dataLine.slice(5).trim());
            if (event.type === 'complete' || event.type === 'error') return;
          } catch {
            // ignore malformed
          }
        }
      }
    }

    (async () => {
      try {
        if (shouldRegen) {
          setRegenerating(true);
          const { generation_id } = await api.generateBrief();
          await waitForGeneration(generation_id);
          if (cancelled) return;
          // Reload page without ?regen to fetch fresh brief
          window.location.href = '/finance';
          return;
        }
        const data = await api.getCurrentBrief();
        if (!cancelled) setBrief(data);
      } catch (err) {
        if (cancelled) return;
        setRegenerating(false);
        const status = (err as { status?: number })?.status;
        if (status === 404) {
          router.replace('/finance/loading');
          return;
        }
        setError(
          (err as { message?: string })?.message ??
            'Failed to load your brief',
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, router, shouldRegen]);

  // Typewriter reveal for the verdict — matches onboarding's 26ms cadence.
  const verdictTarget = brief?.verdict ?? '';
  const [typedChars, setTypedChars] = useState(0);
  useEffect(() => {
    setTypedChars(0);
    if (!verdictTarget) return;
    const interval = setInterval(() => {
      setTypedChars((prev) => {
        if (prev >= verdictTarget.length) {
          clearInterval(interval);
          return prev;
        }
        return prev + 1;
      });
    }, 26);
    return () => clearInterval(interval);
  }, [verdictTarget]);
  const typedVerdict = verdictTarget.slice(0, typedChars);
  const isTyping = typedChars < verdictTarget.length;

  // Fetch insights
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const feed = await api.getInsights({ limit: 20 });
        if (!cancelled) {
          setInsights(feed.insights);
          setInsightsLoading(false);
        }
      } catch {
        if (!cancelled) setInsightsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api]);

  // Fetch settings data when modal opens
  useEffect(() => {
    if (!settingsOpen || !activation) return;
    let cancelled = false;

    (async () => {
      if (settingsTab === 'accounts') {
        setConnectionsLoading(true);
        try {
          const data = await api.listConnections(activation.id);
          if (!cancelled) setConnections(data);
        } catch {
          // ignore
        } finally {
          if (!cancelled) setConnectionsLoading(false);
        }
      } else if (settingsTab === 'delivery') {
        setDeliveryLoading(true);
        try {
          const data = await api.getDeliveryPreferences();
          if (!cancelled) setDelivery(data);
        } catch {
          // ignore
        } finally {
          if (!cancelled) setDeliveryLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [settingsOpen, settingsTab, activation, api]);

  async function handleDisconnectConfirm() {
    if (!activation || !disconnectConfirm) return;
    setDisconnecting(true);
    try {
      await api.disconnectConnection(activation.id, disconnectConfirm.id);
      setConnections((prev) => prev.filter((c) => c.id !== disconnectConfirm.id));
      setDisconnectConfirm(null);
    } catch {
      // ignore
    } finally {
      setDisconnecting(false);
    }
  }

  // Plaid Link hook
  const { open: openPlaidLink, ready: plaidReady } = usePlaidLink({
    token: linkToken,
    onSuccess: async (publicToken, metadata) => {
      if (!activation) return;
      setPlaidBusy(true);
      try {
        await api.finalizeConnection(activation.id, 'plaid', {
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
        // Refresh connections list
        const updated = await api.listConnections(activation.id);
        setConnections(updated);
        // Sync in background
        api.syncAgent(activation.id).catch(() => {});
      } catch {
        // ignore
      } finally {
        clearPlaidPending();
        setPlaidBusy(false);
        setLinkToken(null);
      }
    },
    onExit: () => {
      clearPlaidPending();
      setLinkToken(null);
      setPlaidBusy(false);
    },
  });

  // Auto-open Plaid Link when token is ready
  useEffect(() => {
    if (linkToken && plaidReady) {
      openPlaidLink();
    }
  }, [linkToken, plaidReady, openPlaidLink]);

  const handleAddAccount = useCallback(async () => {
    if (!activation || plaidBusy) return;
    setPlaidBusy(true);
    try {
      const { linkToken: token } = await api.initConnection(
        activation.id,
        'plaid',
        { redirectUri: window.location.origin + '/plaid/oauth' }
      );
      savePlaidPending({
        linkToken: token,
        agentInstanceId: activation.id,
        returnTo: '/finance',
      });
      setLinkToken(token);
    } catch {
      setPlaidBusy(false);
    }
  }, [activation, api, plaidBusy]);

  async function handleDeliveryToggle(
    channel: 'email' | 'telegram' | 'whatsapp',
    enabled: boolean
  ) {
    if (!delivery) return;
    setDeliverySaving(true);
    try {
      await api.updateDeliveryPreferences({
        [channel]: { enabled },
      });
      // Re-fetch to get updated state
      const fresh = await api.getDeliveryPreferences();
      setDelivery(fresh);
    } catch {
      // ignore
    } finally {
      setDeliverySaving(false);
    }
  }

  async function handleRegenerate() {
    setSettingsOpen(false);
    window.location.href = '/finance?regen=1';
  }

  async function handleResetSkillState() {
    if (!activation) return;
    setResettingSkill(true);
    try {
      await api.resetSkillState(activation.id, 'finance.subscriptions');
    } catch {
      // ignore
    } finally {
      setResettingSkill(false);
    }
  }

  async function handleClearInsights() {
    if (!activation) return;
    setClearingInsights(true);
    try {
      await api.clearInsights(activation.id);
      setInsights([]);
    } catch {
      // ignore
    } finally {
      setClearingInsights(false);
    }
  }

  async function handleLoadDebug() {
    if (!activation) return;
    setLoadingDebug(true);
    try {
      const info = await api.getDebugInfo(activation.id);
      setDebugInfo(info);
    } catch {
      // ignore
    } finally {
      setLoadingDebug(false);
    }
  }

  const since = activation ? formatSince(activation.activatedAt) : '';
  const lastAnalyzed = brief ? formatAgo(brief.generated_at) : '';

  return (
    <div className={shell.page}>
      <Header />
      <main className={shell.main}>
        <Link href="/app" className={shell.back}>← Back</Link>

        <div className={shell.agentHeader}>
          <div>
            <div className={shell.nameRow}>
              <span className={shell.icon}><FinanceIcon /></span>
              <h1 className={shell.agentName}>Finance</h1>
            </div>
            <p className={shell.since}>
              {since ? `Running since ${since}` : 'Running'}
              {lastAnalyzed ? ` — last analyzed ${lastAnalyzed}` : ''}
            </p>
          </div>
          <div className={shell.badges}>
            <button
              className={shell.headerBtn}
              type="button"
              onClick={() => setSettingsOpen(true)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Configure
            </button>
            <button className={shell.headerBtn} type="button">Stop agent</button>
            <span className={shell.activeBadge}><span className={shell.dot} />Active</span>
          </div>
        </div>

        {regenerating ? (
          <p className={styles.verdict}>Regenerating your brief…</p>
        ) : error ? (
          <p className={styles.verdict}>{error}</p>
        ) : brief ? (
          <>
            <h2 className={styles.verdict}>
              {typedVerdict}
              {isTyping && <span className={styles.cursor} />}
            </h2>

            {brief.summary && (
              <div className={styles.numGrid}>
                {/* Income Card */}
                <div className={styles.numCard}>
                  <div className={styles.ncTag}>Income</div>
                  <div className={styles.ncVal}>
                    {formatMoney(brief.summary.income)}<span className={styles.ncUnit}>/mo</span>
                  </div>
                  <div className={styles.ncNote}>Salary & deposits</div>
                </div>

                {/* Outflow Card - Split */}
                <div className={styles.numCard}>
                  <div className={styles.ncTag}>
                    Outflow <span className={styles.ncTagSum}>· {formatMoney(brief.summary.outflow)}/mo</span>
                  </div>
                  <div className={styles.split}>
                    {brief.summary.breakdown.map((item) => (
                      <div key={item.id} className={styles.splitRow}>
                        <div className={styles.srK}>
                          {item.label}
                          <small>{item.sublabel}</small>
                        </div>
                        <div className={styles.srV}>
                          {formatMoney(item.amount)}<span className={styles.ncUnit}>/mo</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Leftover Card */}
                <div className={styles.numCard}>
                  <div className={styles.ncTag}>Leftover</div>
                  <div className={styles.ncVal}>
                    {brief.summary.leftover < 0 ? '−' : ''}{formatMoney(brief.summary.leftover)}<span className={styles.ncUnit}>/mo</span>
                  </div>
                  <div className={styles.ncNote}>
                    {brief.summary.leftover < 0 ? 'Covered on credit' : 'Available'}
                  </div>
                </div>
              </div>
            )}

            {/* Insights Feed */}
            {!insightsLoading && insights.length > 0 && (
              <section className={styles.insightsFeed}>
                <div className={styles.insightsStack}>
                  <div className={styles.insightsDay}>
                    <h4 className={`${styles.dateLabel} ${styles.dateLabelToday}`}>
                      <span className={styles.dateDot} />
                      Today · {new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short' }).toUpperCase()}
                    </h4>
                    <div className={styles.insightsStream}>
                      {insights.map((insight) => (
                        <article
                          key={insight.id}
                          className={`${styles.insightCard} ${insight.isCritical ? styles.critical : ''} ${insight.isRead ? styles.read : ''}`}
                        >
                          <header className={styles.insightHeader}>
                            <span className={styles.insightSkill}>
                              <i className={styles.insightSkillDot} />
                              Subscriptions
                            </span>
                            <time className={styles.insightTime}>
                              {new Date(insight.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
                            </time>
                          </header>
                          <h3 className={styles.insightTitle}>
                            {renderInsightTitle(insight.insightTypeId, insight.title, insight.data as InsightData)}
                          </h3>
                          {insight.description && (
                            <p className={styles.insightDescription}>{insight.description}</p>
                          )}
                        </article>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            )}
          </>
        ) : (
          <div className={styles.empty} />
        )}
      </main>
      <ChatInput agent="Finance" />

      {/* Settings Modal */}
      {settingsOpen && (
        <div className={styles.modalOverlay} onClick={() => setSettingsOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Finance Settings</h2>
              <button
                className={styles.modalClose}
                onClick={() => setSettingsOpen(false)}
                aria-label="Close"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className={styles.modalBody}>
              <nav className={styles.modalNav}>
                <button
                  className={`${styles.navItem} ${settingsTab === 'accounts' ? styles.navItemActive : ''}`}
                  onClick={() => setSettingsTab('accounts')}
                >
                  Accounts
                </button>
                <button
                  className={`${styles.navItem} ${settingsTab === 'delivery' ? styles.navItemActive : ''}`}
                  onClick={() => setSettingsTab('delivery')}
                >
                  Delivery
                </button>
                <button
                  className={`${styles.navItem} ${settingsTab === 'devtools' ? styles.navItemActive : ''}`}
                  onClick={() => setSettingsTab('devtools')}
                >
                  Dev Tools
                </button>
              </nav>

              <div className={styles.modalContent}>
                {settingsTab === 'accounts' && (
                  <div className={styles.accountsTab}>
                    <p className={styles.tabDescription}>
                      Connected bank accounts that your finance agent monitors.
                    </p>

                    {connectionsLoading ? (
                      <p className={styles.loading}>Loading accounts...</p>
                    ) : connections.length === 0 ? (
                      <p className={styles.emptyState}>No accounts connected yet.</p>
                    ) : (
                      <div className={styles.connectionsList}>
                        {connections.map((conn) => (
                          <div key={conn.id} className={styles.connectionCard}>
                            <div className={styles.connectionInfo}>
                              <span className={styles.connectionName}>{conn.institutionName}</span>
                              <span className={styles.connectionAccounts}>
                                {conn.accounts.map((a) => `${a.name} ••${a.mask}`).join(', ')}
                              </span>
                            </div>
                            <button
                              className={styles.disconnectBtn}
                              onClick={() => setDisconnectConfirm(conn)}
                            >
                              Disconnect
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <button
                      className={styles.addAccountBtn}
                      onClick={handleAddAccount}
                      disabled={plaidBusy}
                    >
                      {plaidBusy ? (
                        'Connecting...'
                      ) : (
                        <>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 5v14M5 12h14" />
                          </svg>
                          Add bank account
                        </>
                      )}
                    </button>
                  </div>
                )}

                {settingsTab === 'delivery' && (
                  <div className={styles.deliveryTab}>
                    <p className={styles.tabDescription}>
                      Choose how you want to receive insights and alerts.
                    </p>

                    {deliveryLoading ? (
                      <p className={styles.loading}>Loading preferences...</p>
                    ) : delivery ? (
                      <div className={styles.deliveryOptions}>
                        <label className={styles.deliveryRow}>
                          <div className={styles.deliveryInfo}>
                            <span className={styles.deliveryLabel}>Email</span>
                            <span className={styles.deliveryHint}>
                              {delivery.email.address || 'Not configured'}
                            </span>
                          </div>
                          <input
                            type="checkbox"
                            className={styles.toggle}
                            checked={delivery.email.enabled}
                            disabled={deliverySaving}
                            onChange={(e) => handleDeliveryToggle('email', e.target.checked)}
                          />
                        </label>

                        <label className={styles.deliveryRow}>
                          <div className={styles.deliveryInfo}>
                            <span className={styles.deliveryLabel}>Telegram</span>
                            <span className={styles.deliveryHint}>
                              {delivery.telegram.chatId ? 'Connected' : 'Not configured'}
                            </span>
                          </div>
                          <input
                            type="checkbox"
                            className={styles.toggle}
                            checked={delivery.telegram.enabled}
                            disabled={deliverySaving || !delivery.telegram.chatId}
                            onChange={(e) => handleDeliveryToggle('telegram', e.target.checked)}
                          />
                        </label>

                        <label className={styles.deliveryRow}>
                          <div className={styles.deliveryInfo}>
                            <span className={styles.deliveryLabel}>Text (SMS)</span>
                            <span className={styles.deliveryHint}>
                              {delivery.whatsapp.number || 'Not configured'}
                            </span>
                          </div>
                          <input
                            type="checkbox"
                            className={styles.toggle}
                            checked={delivery.whatsapp.enabled}
                            disabled={deliverySaving || !delivery.whatsapp.number}
                            onChange={(e) => handleDeliveryToggle('whatsapp', e.target.checked)}
                          />
                        </label>
                      </div>
                    ) : (
                      <p className={styles.emptyState}>Unable to load preferences.</p>
                    )}
                  </div>
                )}

                {settingsTab === 'devtools' && (
                  <div className={styles.devtoolsTab}>
                    <p className={styles.tabDescription}>
                      Development tools for testing and debugging.
                    </p>

                    <div className={styles.devtoolsActions}>
                      <div className={styles.devtoolsAction}>
                        <div className={styles.devtoolsInfo}>
                          <span className={styles.devtoolsLabel}>Regenerate Brief</span>
                          <span className={styles.devtoolsHint}>
                            Re-run the brief generation pipeline and refresh insights.
                          </span>
                        </div>
                        <button
                          className={styles.devtoolsBtn}
                          onClick={handleRegenerate}
                          disabled={regenerating}
                        >
                          {regenerating ? 'Regenerating...' : 'Regenerate'}
                        </button>
                      </div>

                      <div className={styles.devtoolsAction}>
                        <div className={styles.devtoolsInfo}>
                          <span className={styles.devtoolsLabel}>Reset Subscription Skill</span>
                          <span className={styles.devtoolsHint}>
                            Clear skill state to trigger first-run welcome insights on next generation.
                          </span>
                        </div>
                        <button
                          className={styles.devtoolsBtn}
                          onClick={handleResetSkillState}
                          disabled={resettingSkill}
                        >
                          {resettingSkill ? 'Resetting...' : 'Reset State'}
                        </button>
                      </div>

                      <div className={styles.devtoolsAction}>
                        <div className={styles.devtoolsInfo}>
                          <span className={styles.devtoolsLabel}>Clear All Insights</span>
                          <span className={styles.devtoolsHint}>
                            Remove all generated insights from the feed.
                          </span>
                        </div>
                        <button
                          className={`${styles.devtoolsBtn} ${styles.dangerBtn}`}
                          onClick={handleClearInsights}
                          disabled={clearingInsights}
                        >
                          {clearingInsights ? 'Clearing...' : 'Clear Insights'}
                        </button>
                      </div>

                      <div className={styles.devtoolsAction}>
                        <div className={styles.devtoolsInfo}>
                          <span className={styles.devtoolsLabel}>Debug Info</span>
                          <span className={styles.devtoolsHint}>
                            Show transaction count, skill state, and sample data.
                          </span>
                        </div>
                        <button
                          className={styles.devtoolsBtn}
                          onClick={handleLoadDebug}
                          disabled={loadingDebug}
                        >
                          {loadingDebug ? 'Loading...' : 'Load Debug'}
                        </button>
                      </div>
                    </div>

                    {debugInfo && (
                      <div className={styles.debugOutput}>
                        <div className={styles.debugStats}>
                          <strong>Transactions:</strong> {debugInfo.transactionCount} |{' '}
                          <strong>Insights:</strong> {debugInfo.insightCount} |{' '}
                          <strong>Skill Record:</strong> {debugInfo.skillRecord.exists ? 'Yes' : 'No'}
                          {debugInfo.skillRecord.lastRunAt && (
                            <> | <strong>Last Run:</strong> {new Date(debugInfo.skillRecord.lastRunAt).toLocaleString()}</>
                          )}
                        </div>
                        <div className={styles.debugState}>
                          <strong>Skill State:</strong>
                          <pre>{JSON.stringify(debugInfo.skillRecord.state, null, 2)}</pre>
                        </div>
                        <div className={styles.debugTx}>
                          <strong>Sample Transactions:</strong>
                          {debugInfo.sampleTransactions.length === 0 ? (
                            <p>No transactions found</p>
                          ) : (
                            <ul>
                              {debugInfo.sampleTransactions.slice(0, 10).map((tx, i) => (
                                <li key={i}>
                                  {tx.date} | {tx.merchant || tx.description} | ${tx.amount}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Disconnect Confirmation Dialog */}
      {disconnectConfirm && (
        <div className={styles.confirmOverlay} onClick={() => !disconnecting && setDisconnectConfirm(null)}>
          <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.confirmTitle}>Disconnect account?</h3>
            <p className={styles.confirmText}>
              This will remove <strong>{disconnectConfirm.institutionName}</strong> from your finance agent.
              You can reconnect it anytime.
            </p>
            <div className={styles.confirmActions}>
              <button
                className={styles.cancelBtn}
                onClick={() => setDisconnectConfirm(null)}
                disabled={disconnecting}
              >
                Cancel
              </button>
              <button
                className={styles.dangerBtn}
                onClick={handleDisconnectConfirm}
                disabled={disconnecting}
              >
                {disconnecting ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
