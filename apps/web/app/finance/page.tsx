'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import Header from '@/components/layout/Header';
import ChatInput from '@/components/sections/ChatInput';
import { useApiClient } from '@/hooks/useApiClient';
import { useActivatedAgents } from '@/hooks/useActivatedAgents';
import { FinanceIcon } from '@/components/sections/AgentIcons';
import shell from '../agent/[name]/page.module.css';
import styles from './page.module.css';


interface BriefNumber {
  value: string;
  phrase: string;
}

interface Brief {
  id: string;
  verdict: string;
  numbers: BriefNumber[];
  paragraph: string;
  data_scope: string;
  generated_at: string;
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

/** Highlight dollar amounts and percentages in the paragraph. */
function formatParagraph(text: string): React.ReactNode[] {
  const pattern = /(\$[\d,]+(?:\.\d{2})?(?:\/\w+)?|\d+%)/g;
  const parts = text.split(pattern);
  return parts.map((part, i) =>
    pattern.test(part) ? <strong key={i}>{part}</strong> : part
  );
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
              disabled={regenerating}
              onClick={() => {
                window.location.href = '/finance?regen=1';
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 4v6h-6" />
                <path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              {regenerating ? 'Regenerating...' : 'Regenerate'}
            </button>
            <button className={shell.headerBtn} type="button">
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

            <div className={styles.numbers}>
              {brief.numbers.map((n, i) => {
                const match = n.value.match(/^([^/]+)(\/\w+)?$/);
                const amount = match?.[1]?.trim() ?? n.value;
                const unit = match?.[2] ?? '';
                return (
                  <div key={`${n.value}-${i}`} className={styles.numberCol}>
                    <span className={styles.numberValue}>
                      {amount}
                      {unit && <span className={styles.numberUnit}>{unit}</span>}
                    </span>
                    <span className={styles.numberPhrase}>{n.phrase}</span>
                  </div>
                );
              })}
            </div>

            <p className={styles.paragraph}>
              &ldquo;{formatParagraph(brief.paragraph)}&rdquo;
            </p>

            {/* Insights Feed */}
            {!insightsLoading && insights.length > 0 && (
              <section className={styles.insightsFeed}>
                <h3 className={styles.insightsHeader}>Today's Insights</h3>
                <div className={styles.insightsList}>
                  {insights.map((insight) => (
                    <div
                      key={insight.id}
                      className={`${styles.insightCard} ${insight.isCritical ? styles.critical : ''} ${insight.isRead ? styles.read : ''}`}
                    >
                      <div className={styles.insightIcon}>
                        {insight.insightTypeId.includes('price-change') && '⚠️'}
                        {insight.insightTypeId.includes('upcoming') && '📅'}
                        {insight.insightTypeId.includes('new') && '✨'}
                        {insight.insightTypeId.includes('charged') && '✓'}
                      </div>
                      <div className={styles.insightContent}>
                        <span className={styles.insightTitle}>{insight.title}</span>
                        {insight.description && (
                          <span className={styles.insightDescription}>{insight.description}</span>
                        )}
                      </div>
                      {insight.isCritical && (
                        <span className={styles.criticalBadge}>Action needed</span>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <div className={styles.empty} />
        )}
      </main>
      <ChatInput agent="Finance" />
    </div>
  );
}
