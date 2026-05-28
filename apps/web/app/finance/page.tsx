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
import { usePasswordedUpload } from '@/hooks/usePasswordedUpload';
import PasswordPromptDialog from '@/components/sections/PasswordPromptDialog';
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

// PLACEHOLDER brief used while categorization + brief generation are paused
// (Challenge 1 only ingests transactions). The numbers are dummy values
// shaped to make the bar graph and cards visually populated. Real
// generation will overwrite this.
function buildPlaceholderBrief(accountCount: number, txnCount: number): Brief {
  // Engaging mock numbers — realistic shape, not 0s, with a clear surplus so
  // the flow bar shows the "left over" tail. Replaces the older "Placeholder"
  // copy that made the homepage feel empty before real categorization is in.
  const income = 7800;
  const subscriptions = 350;
  const loans = 1800;
  const other = 850;
  const variable = 2400;
  const outflow = subscriptions + loans + other + variable;
  const leftover = income - outflow;

  return {
    id: 'preview',
    verdict:
      "You're tracking well this month — $2,400 ahead of spending with no surprises in your recurring lineup.",
    numbers: [
      { value: '$7,800/mo', phrase: 'coming in across all accounts' },
      { value: '$2,400/mo', phrase: 'left over after recurring + variable spend' },
      { value: '$3,000/mo', phrase: 'locked in to subscriptions, loans, and bills' },
    ],
    paragraph:
      "Income is steady on the 1st and 15th. Subscriptions are stable at $350 — no price changes detected. Loans and EMI take the biggest chunk at $1,800; variable spend (groceries, dining, fuel) averages $2,400. You're keeping ~31% of income, which is healthy by most benchmarks.",
    summary: {
      income,
      outflow,
      leftover,
      breakdown: [
        {
          id: 'subscriptions',
          label: 'Subscriptions',
          sublabel: '5 active · Netflix, Spotify, Adobe, NYT, iCloud',
          amount: subscriptions,
          count: 5,
        },
        {
          id: 'loans',
          label: 'Loans & EMI',
          sublabel: 'Auto loan · $1,800/mo · 14 months left',
          amount: loans,
          count: 1,
        },
        {
          id: 'other',
          label: 'Other recurring',
          sublabel: 'Rent, utilities, phone, insurance',
          amount: other,
        },
      ],
    },
    data_scope: `Preview brief · based on ${accountCount} account${accountCount === 1 ? '' : 's'}, ${txnCount.toLocaleString()} transactions ingested · real analysis lands here once categorization runs.`,
    generated_at: new Date().toISOString(),
  };
}

function buildPlaceholderInsights(): Insight[] {
  // Preview insights — populated until real categorization + skill execution
  // takes over. Covers the four main insight shapes (upcoming, observed,
  // new, price-change) so the feed renders varied content out of the gate.
  const now = new Date();
  const iso = (offsetMs: number) => new Date(now.getTime() - offsetMs).toISOString();
  return [
    {
      id: 'preview-1',
      title: 'Netflix will charge $17.99 tomorrow',
      description: 'Same as last month. Comes off your TD chequing.',
      insightTypeId: 'subscription-upcoming',
      data: { merchant: 'netflix', amount: 17.99, daysUntil: 1 },
      isCritical: false,
      isRead: false,
      createdAt: iso(0),
    },
    {
      id: 'preview-2',
      title: 'Spotify charged $12.99 — as expected',
      description: 'Monthly cadence, no change since March.',
      insightTypeId: 'subscription-observed',
      data: { merchant: 'spotify', amount: 12.99 },
      isCritical: false,
      isRead: false,
      createdAt: iso(3 * 3600_000),
    },
    {
      id: 'preview-3',
      title: 'New subscription detected: Audible',
      description: 'First $14.95 charge on May 24 — flagging it so you can confirm.',
      insightTypeId: 'subscription-new',
      data: { merchant: 'audible', amount: 14.95 },
      isCritical: true,
      isRead: false,
      createdAt: iso(24 * 3600_000),
    },
    {
      id: 'preview-4',
      title: 'Adobe increased $19.99 → $22.99',
      description: 'Up 15% from last billing cycle. Annual cost: +$36.',
      insightTypeId: 'price-change',
      data: { merchant: 'adobe', oldAmount: 19.99, newAmount: 22.99 },
      isCritical: true,
      isRead: false,
      createdAt: iso(2 * 24 * 3600_000),
    },
    {
      id: 'preview-5',
      title: 'Groceries trending high this month',
      description: '$612 so far vs. your $480 monthly average. 10 days left in cycle.',
      insightTypeId: 'category-trend',
      data: { merchant: 'groceries', amount: 612, monthlyTotal: 480 },
      isCritical: false,
      isRead: false,
      createdAt: iso(4 * 24 * 3600_000),
    },
  ];
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

interface ConnectionHealth {
  isHealthy: boolean;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  requiresReauth: boolean;
  consecutiveFailures: number;
  suggestedAction: 'reconnect' | 'upload' | null;
}

interface Connection {
  id: string;
  displayName: string | null;
  status: string;
  institutionName: string | null;
  lastSyncedAt: string | null;
  accounts: { id: string; name: string; mask: string | null }[];
  health?: ConnectionHealth;
}

interface DeliveryPrefs {
  email: { enabled: boolean; address: string | null };
  telegram: { enabled: boolean; chatId: string | null };
  whatsapp: { enabled: boolean; number: string | null };
}

type SettingsTab = 'accounts' | 'upload' | 'delivery';

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
  const [syncingBanks, setSyncingBanks] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(true);
  // Dev-mode (Challenge 1): no real brief is generated. We populate a
  // placeholder brief from agent-status counts so the verdict / cards /
  // insights panel all render with dummy content.

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

  // Category override state
  const [streams, setStreams] = useState<Array<{
    id: string;
    merchantName: string;
    category: string | null;
    monthlyAmount: number;
  }>>([]);
  const [loadingStreams, setLoadingStreams] = useState(false);
  const [selectedStreamId, setSelectedStreamId] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [overriding, setOverriding] = useState(false);
  const [overrideResult, setOverrideResult] = useState<string | null>(null);
  const [resettingCategories, setResettingCategories] = useState(false);

  // Upload tab state
  const [uploadHistory, setUploadHistory] = useState<Array<{
    id: string;
    filename: string;
    fileType: string;
    status: string;
    transactionCount: number | null;
    uploadedAt: string;
    processedAt: string | null;
    statementPeriod: { start: string; end: string } | null;
  }>>([]);
  const [uploadHistoryLoading, setUploadHistoryLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const pwUpload = usePasswordedUpload();

  // Dev-only: ?regen triggers fresh brief generation
  const shouldRegen = searchParams.get('regen') === '1';

  useEffect(() => {
    let cancelled = false;

    // Challenge 1 dev mode: skip the brief pipeline. We populate a
    // PLACEHOLDER brief so the verdict heading, bar graph, cards, and
    // insight panel all render with dummy content. Once categorization +
    // brief generation get wired back in, this branch goes away.
    (async () => {
      try {
        if (shouldRegen) {
          // No-op in dev mode — brief generation is disabled. Strip the
          // query param and reload cleanly so the user doesn't get stuck.
          window.location.href = '/finance';
          return;
        }
        const status = await api.getAgentStatus();
        if (cancelled) return;
        if (!status.agentExists) {
          router.replace('/app');
          return;
        }
        // First-time setup: no connection has completed yet → loading page.
        // After the first one completes, ANY subsequent in_progress connection
        // (e.g., a freshly added bank) should NOT kick the user back to setup
        // — we stay on the brief and surface a "Syncing…" indicator instead.
        const hasCompletedConnection = status.connections.some(
          (c) => c.ingestionState === 'complete',
        );
        if (!hasCompletedConnection) {
          router.replace('/finance/loading');
          return;
        }
        setSyncingBanks(
          status.connections
            .filter(
              (c) =>
                c.ingestionState === 'in_progress' ||
                c.ingestionState === 'pending',
            )
            .map((c) => c.displayName ?? 'a new bank'),
        );
        const accountCount = status.connections.reduce(
          (sum, c) => sum + c.accountCount,
          0,
        );
        // Dummy brief — visual scaffold while categorization is paused.
        setBrief(buildPlaceholderBrief(accountCount, status.totalTransactions));
      } catch (err) {
        if (cancelled) return;
        setError(
          (err as { message?: string })?.message ??
            'Failed to load agent status',
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, router, shouldRegen]);

  // While any bank is still syncing, re-poll status every 5s so the
  // "Syncing N bank(s)…" indicator clears itself when ingestion completes.
  // This is light — same endpoint the loading page uses.
  useEffect(() => {
    if (syncingBanks.length === 0) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const status = await api.getAgentStatus();
        if (cancelled) return;
        setSyncingBanks(
          status.connections
            .filter(
              (c) =>
                c.ingestionState === 'in_progress' ||
                c.ingestionState === 'pending',
            )
            .map((c) => c.displayName ?? 'a new bank'),
        );
      } catch {
        // swallow; the indicator will just stay until the next poll succeeds
      }
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [api, syncingBanks.length]);

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

  // Fetch insights. In Challenge 1 dev mode there are none — fall back to
  // placeholders so the insight panel renders with example content.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const feed = await api.getInsights({ limit: 20 });
        if (!cancelled) {
          setInsights(feed.insights.length > 0 ? feed.insights : buildPlaceholderInsights());
          setInsightsLoading(false);
        }
      } catch {
        if (!cancelled) {
          setInsights(buildPlaceholderInsights());
          setInsightsLoading(false);
        }
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
          // Try to fetch health data and merge it
          try {
            const healthData = await api.getConnectionsHealth(activation.id);
            for (const conn of data) {
              if (healthData[conn.id]) {
                conn.health = healthData[conn.id];
              }
            }
          } catch {
            // Health endpoint may not work yet (migration not run) - that's okay
          }
          if (!cancelled) setConnections(data);
        } catch {
          // ignore
        } finally {
          if (!cancelled) setConnectionsLoading(false);
        }
      } else if (settingsTab === 'upload') {
        setUploadHistoryLoading(true);
        try {
          const data = await api.getUploadHistory();
          if (!cancelled) setUploadHistory(data.uploads);
        } catch {
          // ignore
        } finally {
          if (!cancelled) setUploadHistoryLoading(false);
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

  async function handleLoadStreams() {
    setLoadingStreams(true);
    setOverrideResult(null);
    try {
      const breakdown = await api.getBriefBreakdown();
      // Collect all streams from all categories
      const allStreams: Array<{
        id: string;
        merchantName: string;
        category: string | null;
        monthlyAmount: number;
      }> = [];

      const addItems = (items: Array<{ id: string; merchantName: string; category?: string | null; monthlyAmount: number }>, cat: string) => {
        items.forEach(item => {
          allStreams.push({
            id: item.id,
            merchantName: item.merchantName,
            category: item.category ?? cat,
            monthlyAmount: item.monthlyAmount,
          });
        });
      };

      addItems(breakdown.income.items, 'income');
      addItems(breakdown.subscriptions.items, 'subscription');
      addItems(breakdown.loans.items, 'loan');
      if (breakdown.fees) addItems(breakdown.fees.items, 'fee');
      if (breakdown.rent) addItems(breakdown.rent.items, 'rent');
      if (breakdown.utilities) addItems(breakdown.utilities.items, 'utility');
      if (breakdown.insurance) addItems(breakdown.insurance.items, 'insurance');
      if (breakdown.variable) addItems(breakdown.variable.items, 'variable');
      addItems(breakdown.other.items, 'other');
      addItems(breakdown.transfersOut.items, 'transfer');
      addItems(breakdown.transfersIn.items, 'transfer');

      setStreams(allStreams);
    } catch {
      // ignore
    } finally {
      setLoadingStreams(false);
    }
  }

  async function handleOverrideCategory() {
    if (!selectedStreamId || !selectedCategory) return;
    setOverriding(true);
    setOverrideResult(null);
    try {
      const result = await api.overrideStreamCategory(selectedStreamId, selectedCategory);
      setOverrideResult(`Updated "${result.merchantName}" to "${result.category}"`);
      // Refresh streams list
      await handleLoadStreams();
      setSelectedStreamId('');
      setSelectedCategory('');
    } catch (err) {
      setOverrideResult(`Error: ${(err as { message?: string })?.message ?? 'Failed to override'}`);
    } finally {
      setOverriding(false);
    }
  }

  async function handleFileUpload(file: File) {
    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      const result = await pwUpload.upload(file);
      if (!result) {
        // User cancelled the password prompt or file was unsupported.
        if (pwUpload.unsupportedReason) setUploadError(pwUpload.unsupportedReason);
        return;
      }
      const inst = result.metadata.institutionName ?? 'statement';
      const last4 = result.metadata.accountLast4 ? ` ••${result.metadata.accountLast4}` : '';
      setUploadSuccess(`Validated ${inst}${last4} — parsing in background.`);
      // Refresh upload history
      const history = await api.getUploadHistory();
      setUploadHistory(history.uploads);
    } catch (err) {
      setUploadError((err as { message?: string })?.message ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileUpload(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
  }

  async function handleResetCategories() {
    if (!confirm('This will clear ALL categorization data (global cache + stream categories). You\'ll need to regenerate your brief to re-categorize. Continue?')) {
      return;
    }
    setResettingCategories(true);
    try {
      await api.resetAllCategories();
      setStreams([]);
      setOverrideResult('All categories cleared. Click "Regenerate Brief" to re-categorize.');
    } catch (err) {
      setOverrideResult(`Error: ${(err as { message?: string })?.message ?? 'Failed to reset'}`);
    } finally {
      setResettingCategories(false);
    }
  }

  const since = activation ? formatSince(activation.activatedAt) : '';
  const lastAnalyzed = brief ? formatAgo(brief.generated_at) : '';

  return (
    <div className={shell.page}>
      <Header />
      {pwUpload.pendingUnlock && (
        <PasswordPromptDialog
          filename={pwUpload.pendingUnlock.filename}
          encryptedKind={pwUpload.pendingUnlock.encryptedKind}
          submitting={pwUpload.submittingPassword}
          wrongPassword={pwUpload.wrongPassword}
          onSubmit={pwUpload.submitPassword}
          onCancel={pwUpload.cancelPassword}
        />
      )}
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
            {syncingBanks.length > 0 && (
              <span className={styles.syncingPill} title={syncingBanks.join(', ')}>
                <span className={styles.syncingDot} />
                Syncing {syncingBanks.length === 1 ? syncingBanks[0] : `${syncingBanks.length} banks`}…
              </span>
            )}
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

            {brief.summary && (() => {
              const { income, outflow, leftover, breakdown } = brief.summary;
              const subscriptions = breakdown.find(b => b.id === 'subscriptions')?.amount ?? 0;
              const loans = breakdown.find(b => b.id === 'loans')?.amount ?? 0;
              const other = breakdown.find(b => b.id === 'other')?.amount ?? 0;
              const variable = outflow - subscriptions - loans - other;

              // Scale the bar to whichever side is bigger, so segments are
              // honest and the leftover space tells the story at a glance.
              //   • Surplus (income > outflow): bar = income, outflow
              //     segments fill the left, the empty tail to the right
              //     IS the surplus.
              //   • Deficit (outflow > income): bar = outflow, outflow
              //     segments fill the whole bar, a marker shows where
              //     income runs out — the segments past that marker are
              //     what you couldn't afford.
              const scale = Math.max(income, outflow, 1);
              const pctSub = (subscriptions / scale) * 100;
              const pctLoans = (loans / scale) * 100;
              const pctOther = (other / scale) * 100;
              const pctVariable = (variable / scale) * 100;
              const incomePct = (income / scale) * 100;
              const isDeficit = leftover < 0;
              const surplusAbs = Math.abs(leftover);

              return (
                <>
                  {/* Bar Graph — bar width = max(income, outflow) */}
                  <div className={styles.aFlow}>
                    <div className={styles.afbBar}>
                      <div className={styles.afbTrack}>
                        {pctSub > 0 && (
                          <div className={`${styles.afbSeg} ${styles.s1}`} style={{ width: `${pctSub}%` }} title={`Subscriptions ${formatMoney(subscriptions)}/mo`} />
                        )}
                        {pctLoans > 0 && (
                          <div className={`${styles.afbSeg} ${styles.s2}`} style={{ width: `${pctLoans}%` }} title={`Loans & EMI ${formatMoney(loans)}/mo`} />
                        )}
                        {pctOther > 0 && (
                          <div className={`${styles.afbSeg} ${styles.s3}`} style={{ width: `${pctOther}%` }} title={`Other recurring ${formatMoney(other)}/mo`} />
                        )}
                        {pctVariable > 0 && (
                          <div className={`${styles.afbSeg} ${styles.s4}`} style={{ width: `${pctVariable}%` }} title={`Variable spend ${formatMoney(variable)}/mo`} />
                        )}
                      </div>
                      {/* Income marker — only meaningful in deficit mode,
                          where it shows where income runs out and the
                          segments past it are the shortfall. */}
                      {isDeficit && (
                        <div className={styles.afbIncome} style={{ left: `${incomePct}%` }} />
                      )}
                    </div>
                    <div className={styles.afbAxis}>
                      {/* Bookend labels: what's being shown on each side. */}
                      <span className={styles.afbAxisL}>
                        spent · {formatMoney(outflow)}
                      </span>
                      <span className={styles.afbAxisR}>
                        {isDeficit ? (
                          <>
                            income · {formatMoney(income)} <span style={{ color: '#c1432f', fontWeight: 600 }}>· over by {formatMoney(surplusAbs)}</span>
                          </>
                        ) : (
                          <>
                            income · {formatMoney(income)} <span style={{ color: '#2f7a3e', fontWeight: 600 }}>· {formatMoney(surplusAbs)} left</span>
                          </>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Cards Grid */}
                  <div className={styles.numGrid}>
                    {/* Income Card */}
                    <div className={styles.numCard}>
                      <div className={styles.ncTag}>Income</div>
                      <div className={styles.ncVal}>
                        {formatMoney(income)}<span className={styles.ncUnit}>/mo</span>
                      </div>
                      <div className={styles.ncNote}>Salary & deposits</div>
                    </div>

                    {/* Outflow Card - Split */}
                    <div className={styles.numCard}>
                      <div className={styles.ncTag}>
                        Outflow <span className={styles.ncTagSum}>· {formatMoney(outflow)}/mo</span>
                      </div>
                      <div className={styles.split}>
                        {breakdown.map((item, idx) => (
                          <div key={item.id} className={styles.splitRow}>
                            <div className={styles.srK}>
                              <span className={`${styles.sw} ${styles[`s${idx + 1}`]}`} />
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
                        {leftover < 0 ? '−' : ''}{formatMoney(leftover)}<span className={styles.ncUnit}>/mo</span>
                      </div>
                      <div className={styles.ncNote}>
                        {leftover < 0 ? 'Covered on credit' : 'Available'}
                      </div>
                    </div>
                  </div>

                  {/* View Details Link */}
                  <div className={styles.detailsLink}>
                    <Link href="/finance/breakdown">
                      View detailed breakdown
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12h14M13 5l7 7-7 7" />
                      </svg>
                    </Link>
                    <Link href="/finance/accounts" style={{ marginLeft: '24px' }}>
                      View accounts
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12h14M13 5l7 7-7 7" />
                      </svg>
                    </Link>
                  </div>
                </>
              );
            })()}

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
                  className={`${styles.navItem} ${settingsTab === 'upload' ? styles.navItemActive : ''}`}
                  onClick={() => setSettingsTab('upload')}
                >
                  Upload
                </button>
                <button
                  className={`${styles.navItem} ${settingsTab === 'delivery' ? styles.navItemActive : ''}`}
                  onClick={() => setSettingsTab('delivery')}
                >
                  Delivery
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
                        {connections.map((conn) => {
                          const health = conn.health;
                          const isUnhealthy = health && !health.isHealthy;

                          return (
                            <div
                              key={conn.id}
                              className={`${styles.connectionCard} ${isUnhealthy ? styles.connectionUnhealthy : ''}`}
                            >
                              <div className={styles.connectionInfo}>
                                <span className={styles.connectionName}>
                                  {conn.institutionName}
                                  {isUnhealthy && (
                                    <span className={styles.connectionWarning} title={health.lastSyncError ?? 'Connection issue'}>
                                      ⚠️
                                    </span>
                                  )}
                                </span>
                                <span className={styles.connectionAccounts}>
                                  {conn.accounts.map((a) => `${a.name} ••${a.mask}`).join(', ')}
                                </span>
                                {isUnhealthy && (
                                  <span className={styles.connectionError}>
                                    {health.requiresReauth
                                      ? 'Bank requires re-authentication'
                                      : health.consecutiveFailures >= 3
                                        ? 'Connection unstable — consider uploading statements'
                                        : 'Sync issue — will retry'}
                                  </span>
                                )}
                              </div>
                              <div className={styles.connectionActions}>
                                {health?.suggestedAction === 'reconnect' && (
                                  <button
                                    className={styles.reconnectBtn}
                                    onClick={handleAddAccount}
                                    disabled={plaidBusy}
                                  >
                                    Reconnect
                                  </button>
                                )}
                                {health?.suggestedAction === 'upload' && (
                                  <button
                                    className={styles.uploadInsteadBtn}
                                    onClick={() => setSettingsTab('upload')}
                                  >
                                    Upload Instead
                                  </button>
                                )}
                                <button
                                  className={styles.disconnectBtn}
                                  onClick={() => setDisconnectConfirm(conn)}
                                >
                                  Disconnect
                                </button>
                              </div>
                            </div>
                          );
                        })}
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

                {settingsTab === 'upload' && (
                  <div className={styles.uploadTab}>
                    <p className={styles.tabDescription}>
                      Upload bank statements for accounts that don&apos;t support Plaid (RBC, international banks).
                      Supports PDF, CSV, and images.
                    </p>

                    {/* Drop Zone */}
                    <div
                      className={`${styles.dropZone} ${dragActive ? styles.dropZoneActive : ''} ${uploading ? styles.dropZoneUploading : ''}`}
                      onDrop={handleDrop}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                    >
                      {uploading ? (
                        <div className={styles.dropZoneContent}>
                          <div className={styles.spinner} />
                          <span>Processing with AI...</span>
                        </div>
                      ) : (
                        <div className={styles.dropZoneContent}>
                          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                          </svg>
                          <span>Drop bank statement here</span>
                          <span className={styles.dropZoneHint}>or click to browse</span>
                          <input
                            type="file"
                            accept=".pdf,.csv,.txt,.jpg,.jpeg,.png,.webp"
                            onChange={handleFileSelect}
                            className={styles.fileInput}
                          />
                        </div>
                      )}
                    </div>

                    {uploadError && (
                      <p className={styles.uploadError}>{uploadError}</p>
                    )}
                    {uploadSuccess && (
                      <p className={styles.uploadSuccess}>{uploadSuccess}</p>
                    )}

                    {/* Upload History */}
                    {uploadHistoryLoading ? (
                      <p className={styles.loading}>Loading history...</p>
                    ) : uploadHistory.length > 0 ? (
                      <div className={styles.uploadHistory}>
                        <h4 className={styles.uploadHistoryTitle}>Uploaded Statements</h4>
                        {uploadHistory.map((upload) => (
                          <div key={upload.id} className={styles.uploadItem}>
                            <div className={styles.uploadItemInfo}>
                              <span className={styles.uploadFilename}>{upload.filename}</span>
                              {upload.statementPeriod && (
                                <span className={styles.uploadPeriod}>
                                  {new Date(upload.statementPeriod.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                  {' – '}
                                  {new Date(upload.statementPeriod.end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                </span>
                              )}
                            </div>
                            <div className={styles.uploadItemMeta}>
                              <span className={`${styles.uploadStatus} ${styles[`status${upload.status}`]}`}>
                                {upload.status === 'processed' ? `${upload.transactionCount} txns` : upload.status}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className={styles.emptyState}>No statements uploaded yet.</p>
                    )}
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
