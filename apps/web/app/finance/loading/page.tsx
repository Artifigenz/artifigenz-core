'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import Header from '@/components/layout/Header';
import ChatInput from '@/components/sections/ChatInput';
import { useApiClient } from '@/hooks/useApiClient';
import { useActivatedAgents } from '@/hooks/useActivatedAgents';
import { FinanceIcon } from '@/components/sections/AgentIcons';
import shell from '../../agent/[name]/page.module.css';
import styles from './page.module.css';

const POLL_INTERVAL_MS = 3000;

const CHECKLIST_LINES: Array<{ label: string; live: boolean }> = [
  // The only live phase right now is the ingestion phase (Challenge 1).
  // The rest are placeholders showing the user what's coming next.
  { label: 'Pulling transaction history', live: true },
  { label: 'Mapping recurring obligations', live: false },
  { label: 'Finding patterns in your spending', live: false },
  { label: 'Preparing your brief', live: false },
];

type ConnState = 'pending' | 'in_progress' | 'complete' | 'needs_auth' | 'failed';

interface ConnectionStatus {
  id: string;
  dataSourceTypeId: string;
  displayName: string | null;
  ingestionState: ConnState;
  ingestionStartedAt: string | null;
  ingestionCompletedAt: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  lastSyncAddedCount: number | null;
  consecutiveEmptySyncs: number | null;
  transactionCount: number;
  accountCount: number;
}

function formatSince(ms: number): string {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 5_000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

function stateLabel(s: ConnState): string {
  switch (s) {
    case 'pending':
      return 'queued';
    case 'in_progress':
      return 'pulling history…';
    case 'complete':
      return 'done';
    case 'needs_auth':
      return 'needs re-link';
    case 'failed':
      return 'failed';
  }
}

export default function FinanceLoadingPage() {
  const api = useApiClient();
  const router = useRouter();
  const { user } = useUser();
  const { getActivation } = useActivatedAgents();
  const activation = getActivation('finance');
  const firstName =
    user?.firstName ||
    user?.username ||
    user?.emailAddresses[0]?.emailAddress?.split('@')[0] ||
    'there';

  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [totalTxns, setTotalTxns] = useState<number>(0);
  const [ingestionComplete, setIngestionComplete] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [, forceTick] = useState(0);
  const navigatedRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.getAgentStatus();
      if (!res.agentExists) {
        // No agent — bounce to home so they can onboard.
        router.replace('/app');
        return;
      }
      setConnections(res.connections);
      setTotalTxns(res.totalTransactions);
      setIngestionComplete(res.ingestionComplete);
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : (err as { message?: string })?.message ?? 'Failed to load status',
      );
    }
  }, [api, router]);

  // Poll every 3s.
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Tick once a second so the "last update Xs ago" strings update smoothly
  // between polls without re-fetching.
  useEffect(() => {
    const interval = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // When ingestion completes, advance to /finance.
  useEffect(() => {
    if (ingestionComplete && connections.length > 0 && !navigatedRef.current) {
      navigatedRef.current = true;
      router.replace('/finance');
    }
  }, [ingestionComplete, connections.length, router]);

  const since = activation ? formatSince(activation.activatedAt) : '';

  // Typewriter greeting — same 26ms cadence as onboarding.
  const greetingTarget = `Give me a minute, ${firstName} — I'm pulling your accounts.`;
  const [typedChars, setTypedChars] = useState(0);
  useEffect(() => {
    setTypedChars(0);
    const interval = setInterval(() => {
      setTypedChars((prev) => {
        if (prev >= greetingTarget.length) {
          clearInterval(interval);
          return prev;
        }
        return prev + 1;
      });
    }, 26);
    return () => clearInterval(interval);
  }, [greetingTarget]);
  const typedGreeting = greetingTarget.slice(0, typedChars);
  const isTyping = typedChars < greetingTarget.length;

  const anyInProgress = connections.some(
    (c) => c.ingestionState === 'in_progress' || c.ingestionState === 'pending',
  );
  const needsAuth = connections.filter((c) => c.ingestionState === 'needs_auth');
  const failed = connections.filter((c) => c.ingestionState === 'failed');

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
              {since ? `Running since ${since} — analyzing now` : 'Analyzing now'}
            </p>
          </div>
          <div className={shell.badges}>
            <span className={shell.activeBadge}><span className={shell.dot} />Active</span>
          </div>
        </div>

        <h2 className={styles.greeting}>
          {typedGreeting}
          {isTyping && <span className={styles.cursor} />}
        </h2>

        <div className={styles.eyebrow}>Your agent is ingesting your transactions</div>

        {/* Per-connection ingestion panel */}
        <div className={styles.connections}>
          {connections.length === 0 ? (
            <p className={styles.connectionsEmpty}>
              No data sources connected yet. Go back to onboarding to link a bank
              or upload a statement.
            </p>
          ) : (
            connections.map((c) => {
              const dotClass =
                c.ingestionState === 'complete'
                  ? styles.connDotDone
                  : c.ingestionState === 'needs_auth' || c.ingestionState === 'failed'
                    ? styles.connDotError
                    : styles.connDotActive;
              return (
                <div key={c.id} className={styles.connection}>
                  <span className={`${styles.connDot} ${dotClass}`}>
                    {c.ingestionState === 'complete' && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </span>
                  <div className={styles.connBody}>
                    <div className={styles.connHeader}>
                      <span className={styles.connName}>
                        {c.displayName ?? c.dataSourceTypeId}
                      </span>
                      <span className={styles.connState}>{stateLabel(c.ingestionState)}</span>
                    </div>
                    <div className={styles.connMeta}>
                      {c.transactionCount.toLocaleString()} transactions
                      {c.accountCount > 0 && ` • ${c.accountCount} account${c.accountCount === 1 ? '' : 's'}`}
                      {c.ingestionState === 'in_progress' && (
                        <> • last update {formatRelative(c.lastSyncedAt)}</>
                      )}
                      {c.lastSyncError && c.ingestionState !== 'complete' && (
                        <span className={styles.connError}> — {c.lastSyncError}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Total + helper text */}
        {connections.length > 0 && (
          <p className={styles.totalLine}>
            {totalTxns.toLocaleString()} transactions ingested so far
            {anyInProgress && ' — Plaid usually finishes within 1-5 minutes per bank.'}
          </p>
        )}

        {/* needs_auth banner */}
        {needsAuth.length > 0 && (
          <div className={styles.banner}>
            <strong>
              {needsAuth.map((c) => c.displayName ?? c.dataSourceTypeId).join(', ')}
            </strong>{' '}
            need re-linking. Go back to onboarding and reconnect.
          </div>
        )}

        {/* failure banner */}
        {failed.length > 0 && (
          <div className={`${styles.banner} ${styles.bannerError}`}>
            <strong>
              {failed.map((c) => c.displayName ?? c.dataSourceTypeId).join(', ')}
            </strong>{' '}
            could not be ingested. Open Devtools → Re-sync banks to retry.
          </div>
        )}

        {/* The 4-phase pipeline preview — only the first is live in step 1. */}
        <div className={styles.eyebrow} style={{ marginTop: 36 }}>
          Pipeline · only step 1 is live (dev mode)
        </div>
        <div className={styles.checklist}>
          {CHECKLIST_LINES.map((line, i) => {
            // The "Pulling transaction history" line tracks live ingestion state.
            // Other lines stay pending — they're placeholders for future phases.
            let state: 'pending' | 'active' | 'done' = 'pending';
            if (i === 0) {
              if (ingestionComplete) state = 'done';
              else state = 'active';
            }

            const bulletCls =
              state === 'done'
                ? `${styles.bullet} ${styles.bulletDone}`
                : state === 'active'
                  ? `${styles.bullet} ${styles.bulletActive}`
                  : `${styles.bullet} ${styles.bulletPending}`;
            const textCls =
              state === 'done'
                ? styles.textDone
                : state === 'active'
                  ? styles.textActive
                  : styles.textPending;
            return (
              <div key={line.label} className={styles.line}>
                <span className={bulletCls}>
                  {state === 'done' && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                <span className={textCls}>
                  {line.label}
                  {state === 'active' ? '…' : ''}
                  {!line.live && state === 'pending' && (
                    <span className={styles.placeholderTag}> · next phase</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        {errorMessage && (
          <p className={`${styles.note} ${styles.errorNote}`}>
            Status fetch failed: {errorMessage} — retrying every {POLL_INTERVAL_MS / 1000}s.
          </p>
        )}
      </main>
      <ChatInput agent="Finance" />
    </div>
  );
}
