'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import Header from '@/components/layout/Header';
import { useApiClient } from '@/hooks/useApiClient';
import { FinanceIcon } from '@/components/sections/AgentIcons';
import shell from '../../agent/[name]/page.module.css';
import styles from './page.module.css';

const POLL_INTERVAL_MS = 3000;
const ACTIVITY_ROTATE_MS = 2800;

type ConnState = 'pending' | 'in_progress' | 'complete' | 'needs_auth' | 'failed';

interface ConnectionStatus {
  id: string;
  dataSourceTypeId: string;
  displayName: string | null;
  ingestionState: ConnState;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  transactionCount: number;
  accountCount: number;
}

function formatElapsed(startIso: string | null): string {
  if (!startIso) return '';
  const elapsed = Date.now() - new Date(startIso).getTime();
  const sec = Math.floor(elapsed / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

/**
 * Build a rotating list of activity strings driven by the actual connection
 * state. We don't fake bank names like the design mockup did — these strings
 * reference real connections that are actively pulling.
 */
function buildActivityFrames(
  connections: ConnectionStatus[],
  totalTxns: number,
): string[] {
  const active = connections.filter((c) => c.ingestionState === 'in_progress');
  const queued = connections.filter((c) => c.ingestionState === 'pending');
  const done = connections.filter((c) => c.ingestionState === 'complete');

  const frames: string[] = [];

  if (active.length === 0 && queued.length === 0 && done.length > 0) {
    frames.push(`Read <strong>${totalTxns.toLocaleString()}</strong> transactions`);
    return frames;
  }

  for (const c of active) {
    const name = c.displayName ?? 'your bank';
    frames.push(`Pulling transactions from <strong>${name}</strong>`);
    if (c.transactionCount > 0) {
      frames.push(`<strong>${c.transactionCount.toLocaleString()}</strong> transactions from ${name} so far`);
    }
  }

  for (const c of queued) {
    const name = c.displayName ?? 'queued source';
    frames.push(`Up next: <strong>${name}</strong>`);
  }

  if (totalTxns > 0) {
    frames.push(`<strong>${totalTxns.toLocaleString()}</strong> transactions ingested so far`);
  }

  if (frames.length === 0) {
    frames.push('Connecting…');
  }
  return frames;
}

export default function FinanceLoadingPage() {
  const api = useApiClient();
  const router = useRouter();
  const { user } = useUser();
  const firstName =
    user?.firstName ||
    user?.username ||
    user?.emailAddresses[0]?.emailAddress?.split('@')[0] ||
    'there';

  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [totalTxns, setTotalTxns] = useState<number>(0);
  const [agentStartedAt, setAgentStartedAt] = useState<string | null>(null);
  const [ingestionComplete, setIngestionComplete] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activityIdx, setActivityIdx] = useState(0);
  const [notifyClicked, setNotifyClicked] = useState(false);
  const navigatedRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.getAgentStatus();
      if (!res.agentExists) {
        router.replace('/app');
        return;
      }
      setConnections(res.connections);
      setTotalTxns(res.totalTransactions);
      setIngestionComplete(res.ingestionComplete);
      // Find earliest ingestion start across connections for the "started X
      // seconds ago" meta line.
      const starts = res.connections
        .map((c) => c.ingestionStartedAt)
        .filter((s): s is string => !!s)
        .sort();
      if (starts.length > 0) setAgentStartedAt(starts[0]);
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : (err as { message?: string })?.message ?? 'Failed to load status',
      );
    }
  }, [api, router]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Rotate activity subtext every ACTIVITY_ROTATE_MS.
  useEffect(() => {
    const interval = setInterval(() => {
      setActivityIdx((i) => i + 1);
    }, ACTIVITY_ROTATE_MS);
    return () => clearInterval(interval);
  }, []);

  // Force re-render every second so "Started Xs ago" updates.
  const [, forceTick] = useState(0);
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

  // Typewriter greeting.
  const greetingTarget = `Setting up Finance, ${firstName}.`;
  const greetingDimTarget = 'A minute or two — close the tab whenever, I\u2019ll ping you when the brief is ready.';
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

  const activityFrames = buildActivityFrames(connections, totalTxns);
  const activityText =
    activityFrames.length > 0
      ? activityFrames[activityIdx % activityFrames.length]
      : '';

  const needsAuth = connections.filter((c) => c.ingestionState === 'needs_auth');
  const failed = connections.filter((c) => c.ingestionState === 'failed');

  // Step 1 is "Connected your accounts" — true once we have any connection
  // row. Step 2 is "Reading your transaction history" — active while any
  // Plaid/upload pull is in flight, done once ingestionComplete is true.
  const accountsConnected = connections.length > 0;
  const accountCount = connections.reduce((sum, c) => sum + c.accountCount, 0);

  const startedMeta = agentStartedAt
    ? `Started ${formatElapsed(agentStartedAt)} ago`
    : 'Starting up';

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
            <p className={shell.since}>{startedMeta}</p>
          </div>
          <div className={shell.badges}>
            <span className={shell.activeBadge}><span className={shell.dot} />Active</span>
          </div>
        </div>

        <h2 className={styles.greeting}>
          {typedGreeting}
          {isTyping && <span className={styles.cursor} />}
          {!isTyping && (
            <span className={styles.greetingDim}>{greetingDimTarget}</span>
          )}
        </h2>

        <ol className={styles.steps}>
          {/* Step 1: Connected your accounts */}
          <li
            className={`${styles.step} ${accountsConnected ? styles.stepDone : ''}`}
          >
            <div className={styles.stepRail}>
              <span className={styles.stepMark}>
                {accountsConnected && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                )}
              </span>
            </div>
            <div className={styles.stepBody}>
              <div className={styles.stepRow}>
                <h3 className={styles.stepTitle}>Connected your accounts</h3>
                <span className={styles.stepStatus}>
                  {accountsConnected
                    ? `${accountCount} account${accountCount === 1 ? '' : 's'}`
                    : '—'}
                </span>
              </div>
            </div>
          </li>

          {/* Step 2: Reading your transaction history — the active phase */}
          <li
            className={`${styles.step} ${
              ingestionComplete ? styles.stepDone : styles.stepActive
            }`}
          >
            <div className={styles.stepRail}>
              <span className={styles.stepMark}>
                {ingestionComplete && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                )}
              </span>
            </div>
            <div className={styles.stepBody}>
              <div className={styles.stepRow}>
                <h3 className={styles.stepTitle}>Reading your transaction history</h3>
                <span className={styles.stepStatus}>
                  {totalTxns.toLocaleString()} transactions
                </span>
              </div>
              {!ingestionComplete && activityText && (
                <p
                  key={activityIdx}
                  className={styles.activitySub}
                  dangerouslySetInnerHTML={{ __html: activityText }}
                />
              )}
            </div>
          </li>

          {/* Step 3: placeholder (next phase) */}
          <li className={styles.step}>
            <div className={styles.stepRail}>
              <span className={styles.stepMark} />
            </div>
            <div className={styles.stepBody}>
              <div className={styles.stepRow}>
                <h3 className={styles.stepTitle}>
                  Analyzing patterns &amp; recurring obligations
                </h3>
                <span className={styles.stepStatus}>next phase</span>
              </div>
            </div>
          </li>

          {/* Step 4: placeholder (next phase) */}
          <li className={styles.step}>
            <div className={styles.stepRail}>
              <span className={styles.stepMark} />
            </div>
            <div className={styles.stepBody}>
              <div className={styles.stepRow}>
                <h3 className={styles.stepTitle}>Preparing your brief</h3>
                <span className={styles.stepStatus}>next phase</span>
              </div>
            </div>
          </li>
        </ol>

        {needsAuth.length > 0 && (
          <div className={styles.banner}>
            <strong>
              {needsAuth.map((c) => c.displayName ?? c.dataSourceTypeId).join(', ')}
            </strong>{' '}
            need re-linking. Go back to onboarding and reconnect.
          </div>
        )}

        {failed.length > 0 && (
          <div className={`${styles.banner} ${styles.bannerError}`}>
            <strong>
              {failed.map((c) => c.displayName ?? c.dataSourceTypeId).join(', ')}
            </strong>{' '}
            could not be ingested. Open Devtools → Re-sync banks to retry.
          </div>
        )}

        <div className={styles.leaveRow}>
          <div className={styles.leaveCopy}>
            Close this whenever you like — I&apos;ll send you a note the moment the brief is ready.
          </div>
          <div className={styles.leaveActions}>
            <button
              type="button"
              className={`${styles.btn} ${
                notifyClicked ? styles.btnPrimaryDone : styles.btnPrimary
              }`}
              onClick={() => setNotifyClicked(true)}
            >
              {notifyClicked ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                  You&apos;ll get a ping
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.7 21a2 2 0 01-3.4 0" />
                  </svg>
                  Notify me when ready
                </>
              )}
            </button>
            <button type="button" className={`${styles.btn} ${styles.btnGhost}`}>
              Keep watching
            </button>
          </div>
        </div>

        {errorMessage && (
          <p className={`${styles.note} ${styles.errorNote}`}>
            Status fetch failed: {errorMessage} — retrying every {POLL_INTERVAL_MS / 1000}s.
          </p>
        )}
      </main>
    </div>
  );
}
