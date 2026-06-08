'use client';

import React, { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { AGENTS } from '@artifigenz/shared';
import { useActivatedAgents, agentSlug } from '@/hooks/useActivatedAgents';
import { useApiClient } from '@/hooks/useApiClient';
import ExploreGrid from './ExploreGrid';
import * as Icons from './AgentIcons';
import styles from './AgentGrid.module.css';

interface FinanceData {
  verdict: string | null;
  insights: string[];
}

// Preview insights shown on the homepage card before real brief +
// categorization runs. Same shapes the rest of the product uses
// (upcoming, observed, new, price-change, category-trend) so the
// rotation looks like the live product, not a placeholder.
const FINANCE_PREVIEW_INSIGHTS: string[] = [
  "You're tracking $2,400 ahead of spending this month",
  "Netflix will charge $17.99 tomorrow",
  "Spotify charged $12.99 — as expected",
  "New subscription detected: Audible $14.95",
  "Adobe increased $19.99 → $22.99",
  "Groceries trending high: $612 vs. $480 average",
];

const CATEGORY_LABEL: Record<string, string> = {
  subscription: 'Subscriptions',
  loan_emi: 'Loans & EMI',
  fee_interest: 'Fees & interest',
  variable_recurring: 'Recurring bills',
  miscellaneous: 'Discretionary spend',
};

function fmt(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1000) return `$${Math.round(abs / 100) / 10}K`;
  return `$${Math.round(abs)}`;
}

/**
 * Turn the brief's ranked signals + headline numbers into a small array
 * of short, glanceable insight strings the home card can rotate through.
 * Order matters — earlier entries cycle first.
 */
interface BriefForCard {
  headline: string;
  numbers: { income: number; outflow: number; leftover: number };
  signals: {
    ranked: Array<Record<string, unknown> & { type: string }>;
  };
}

function derivedInsights(brief: BriefForCard): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    const trimmed = s.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  };

  // Leftover headline number first — it's the single most-glanceable fact.
  const { income, outflow, leftover } = brief.numbers;
  if (leftover > 0) {
    push(`${fmt(leftover)} left so far this month`);
  } else if (leftover < 0 && income > 0) {
    push(`Spending exceeds income by ${fmt(leftover)} this month`);
  }

  for (const sig of brief.signals.ranked) {
    switch (sig.type) {
      case 'new_subscription': {
        const brands = ((sig as { brands?: string[] }).brands ?? []).slice(0, 2);
        if (brands.length === 1) push(`New subscription: ${brands[0]}`);
        else if (brands.length > 1)
          push(`New subscriptions: ${brands.join(', ')}`);
        break;
      }
      case 'potentially_cancelled_subscription': {
        const brands = ((sig as { brands?: string[] }).brands ?? []).slice(0, 2);
        if (brands.length === 1)
          push(`${brands[0]} didn't post this month — paused?`);
        else if (brands.length > 1)
          push(`${brands.join(', ')} didn't post this month`);
        break;
      }
      case 'mom_spend_change': {
        const d = (sig as unknown as { deltaPercent: number }).deltaPercent;
        if (Math.abs(d) >= 8) {
          const dir = d > 0 ? 'up' : 'down';
          push(`Total spend ${dir} ${Math.abs(d)}% vs. last month`);
        }
        break;
      }
      case 'category_mover': {
        const cat = (sig as unknown as { category: string }).category;
        const d = (sig as unknown as { deltaPercent: number }).deltaPercent;
        const label = CATEGORY_LABEL[cat] ?? cat;
        const dir = d > 0 ? 'up' : 'down';
        push(`${label} ${dir} ${Math.abs(d)}% vs. last month`);
        break;
      }
      case 'surplus': {
        const pct = (sig as unknown as { percent: number }).percent;
        push(`On pace to save ${pct}% of income`);
        break;
      }
      case 'deficit':
        // Already covered by the leftover headline; skip to avoid dupe.
        break;
    }
  }

  // Always have something in the rotation. If signals are sparse,
  // fall back to a generic verdict line drawn from the headline.
  if (out.length < 2 && brief.headline) {
    push(brief.headline);
  }

  return out;
}

const ICON_MAP: Record<string, ReactNode> = {
  Finance: <Icons.FinanceIcon />,
  Travel: <Icons.TravelIcon />,
  Health: <Icons.HealthIcon />,
  Research: <Icons.ResearchIcon />,
  'Job Search': <Icons.JobSearchIcon />,
};

/** Format insight text with bold merchant names and dollar amounts */
function formatInsightText(text: string): ReactNode[] {
  // Match merchant name (before "will charge", "charged", etc.) and dollar amounts
  const patterns = [
    /^(.+?)(\s+(?:will charge|charged|is charging))/i,
    /(\$[\d,]+(?:\.\d{2})?)/g,
  ];

  // First, extract and bold the merchant name
  const merchantMatch = text.match(patterns[0]);
  let result = text;
  let merchantName = '';

  if (merchantMatch) {
    merchantName = merchantMatch[1];
    // Capitalize first letter of merchant name
    merchantName = merchantName.charAt(0).toUpperCase() + merchantName.slice(1);
  }

  // Split by dollar amounts and bold them
  const dollarPattern = /(\$[\d,]+(?:\.\d{2})?)/g;
  const parts = result.split(dollarPattern);

  return parts.map((part, i) => {
    // Check if this part is a dollar amount
    if (dollarPattern.test(part)) {
      dollarPattern.lastIndex = 0; // Reset regex
      return <strong key={i}>{part}</strong>;
    }
    // Check if this part contains the merchant name at the start
    if (i === 0 && merchantMatch) {
      const merchantPattern = new RegExp(`^(${merchantMatch[1]})`, 'i');
      const m = part.match(merchantPattern);
      if (m) {
        const rest = part.slice(m[1].length);
        return (
          <React.Fragment key={i}>
            <strong>{merchantName}</strong>{rest}
          </React.Fragment>
        );
      }
    }
    return part;
  });
}

function CyclingInsight({ insights, tick }: { insights: string[]; tick: number }) {
  const index = tick % insights.length;
  const [visible, setVisible] = useState(true);
  const [display, setDisplay] = useState(index);
  const textRef = React.useRef<HTMLParagraphElement>(null);
  const [shouldScroll, setShouldScroll] = useState(false);

  useEffect(() => {
    if (index === display) return;
    setVisible(false);
    setShouldScroll(false);
    const t = setTimeout(() => {
      setDisplay(index);
      setVisible(true);
    }, 250);
    return () => clearTimeout(t);
  }, [index, display]);

  // Check if text overflows on mobile, then trigger scroll
  useEffect(() => {
    if (!textRef.current || !visible) return;
    const el = textRef.current;
    const overflows = el.scrollWidth > el.clientWidth + 4;
    if (overflows) {
      const dist = el.scrollWidth - el.clientWidth;
      el.style.setProperty('--scroll-dist', `-${dist}px`);
      const timer = setTimeout(() => setShouldScroll(true), 800);
      return () => clearTimeout(timer);
    }
  }, [display, visible]);

  return (
    <p
      ref={textRef}
      key={display}
      className={`${styles.activeInsight} ${!visible ? styles.insightOut : ''} ${shouldScroll ? styles.insightScroll : ''}`}
    >
      {formatInsightText(insights[display])}
    </p>
  );
}

export default function AgentGrid() {
  const { slugs, hydrated } = useActivatedAgents();
  const api = useApiClient();
  const active = AGENTS.filter((a) => slugs.includes(agentSlug(a.name)));
  const [visibleItems, setVisibleItems] = useState<Set<number>>(new Set());
  const [ticks, setTicks] = useState<number[]>([]);
  const [financeData, setFinanceData] = useState<FinanceData>({ verdict: null, insights: [] });

  // Pull the current-month brief and derive rotating micro-insights from
  // its ranked signals. Falls back to the previous month if there's no
  // current-month data yet, and to All if neither exists. Pure derivation
  // — no separate insight feed call.
  useEffect(() => {
    if (!slugs.includes('finance')) return;
    let cancelled = false;

    (async () => {
      try {
        const { scopes } = await api.getFinanceBriefScopes();
        if (cancelled) return;
        if (scopes.length === 0) return;
        const preferred =
          scopes.find((s) => s.kind === 'current') ??
          scopes.find((s) => s.kind === 'previous') ??
          scopes.find((s) => s.kind === 'all')!;
        const brief = await api.getFinanceBrief(preferred.scope);
        if (cancelled) return;
        setFinanceData({
          verdict: brief.headline ?? null,
          insights: derivedInsights(brief),
        });
      } catch {
        // Soft-fail. The card still renders with the placeholder insights.
      }
    })();

    return () => { cancelled = true; };
  }, [api, slugs]);

  useEffect(() => {
    setVisibleItems(new Set());
    const timeouts: NodeJS.Timeout[] = [];
    active.forEach((_, index) => {
      const timeout = setTimeout(() => {
        setVisibleItems((prev) => new Set(prev).add(index));
      }, 300 + index * 70);
      timeouts.push(timeout);
    });
    return () => timeouts.forEach((t) => clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.length]);

  // Keep ticks array aligned with current active length
  useEffect(() => {
    setTicks((prev) => {
      if (prev.length === active.length) return prev;
      return active.map((_, i) => prev[i] ?? 0);
    });
  }, [active.length]);

  // Cycle one agent at a time
  useEffect(() => {
    if (active.length === 0) return;
    let current = 0;
    const interval = setInterval(() => {
      setTicks((prev) => {
        if (prev.length === 0) return prev;
        const next = [...prev];
        next[current] = (prev[current] ?? 0) + 1;
        return next;
      });
      current = (current + 1) % active.length;
    }, 4000);
    return () => clearInterval(interval);
  }, [active.length]);

  // Before hydration, render nothing to avoid flashing the empty state
  // for users who already have activated agents
  if (!hydrated) {
    return <section className={styles.section} />;
  }

  if (active.length === 0) {
    const available = AGENTS.filter((a) => !slugs.includes(agentSlug(a.name)));
    return (
      <section className={styles.section}>
        <ExploreGrid agents={available} ctaLabel="Activate" />
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <div className={styles.activeList}>
        {active.map((agent, index) => (
          <Link
            href={`/agent/${agentSlug(agent.name)}`}
            key={agent.name}
            className={`${styles.activeCard} ${visibleItems.has(index) ? styles.visible : ''}`}
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <div className={styles.activeLeft}>
              <div className={styles.activeIcon}>{ICON_MAP[agent.name]}</div>
              <div className={styles.activeInfo}>
                <div className={styles.activeNameRow}>
                  <span className={styles.activeName}>{agent.name}</span>
                  <span className={styles.dot} />
                  <span className={styles.activeTime}>{agent.lastActive}</span>
                </div>
                {agentSlug(agent.name) === 'finance' ? (
                  (() => {
                    // Prefer real brief/insights; fall back to preview strings
                    // so the card never looks empty before categorization runs.
                    const real = [
                      ...(financeData.verdict ? [financeData.verdict] : []),
                      ...financeData.insights,
                    ];
                    const insights = real.length > 0 ? real : FINANCE_PREVIEW_INSIGHTS;
                    return <CyclingInsight insights={insights} tick={ticks[index] ?? 0} />;
                  })()
                ) : (
                  agent.insights && <CyclingInsight insights={agent.insights} tick={ticks[index] ?? 0} />
                )}
              </div>
            </div>
            <span className={styles.activeArrow}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
                <path d="M12 5l7 7-7 7" />
              </svg>
            </span>
          </Link>
        ))}
        <Link href="/explore" className={styles.addAgent}>
          + Add an agent
        </Link>
      </div>
    </section>
  );
}
