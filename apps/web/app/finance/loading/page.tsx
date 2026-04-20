'use client';

import { useEffect, useRef, useState } from 'react';
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

const CHECKLIST_LINES = [
  'Reviewing your accounts',
  'Mapping your recurring obligations',
  'Finding the patterns in your spending',
  'Preparing your brief',
];

const PHASE_PACE_MS = 2000;
const MIN_TOTAL_MS = 8000;

type Status = 'pending' | 'active' | 'done';

type ServerEvent =
  | { type: 'progress'; phase: 1 | 2 | 3 | 4 }
  | { type: 'complete'; brief_id: string }
  | { type: 'insufficient_data'; days_available: number; min_required: number }
  | { type: 'error'; message: string };

interface QueuedEvent {
  minShowAt: number;
  event: ServerEvent;
}

async function* parseSseStream(res: Response): AsyncGenerator<ServerEvent> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIdx;
    while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      try {
        yield JSON.parse(dataLine.slice(5).trim()) as ServerEvent;
      } catch {
        // ignore malformed frame
      }
    }
  }
}

function formatSince(iso: number): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
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

  const [phase, setPhase] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [insufficient, setInsufficient] = useState<{ days: number; min: number } | null>(null);
  const [attemptKey, setAttemptKey] = useState(0);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    setPhase(0);
    setErrorMessage(null);
    setInsufficient(null);

    const startedAt = Date.now();
    const queue: QueuedEvent[] = [];
    let releaseTimer: ReturnType<typeof setTimeout> | null = null;

    function scheduleRelease() {
      if (releaseTimer) return;
      const now = Date.now();
      const next = queue[0];
      if (!next) return;
      const delay = Math.max(0, next.minShowAt - now);
      releaseTimer = setTimeout(() => {
        releaseTimer = null;
        const item = queue.shift();
        if (!item || cancelled.current) return;
        apply(item.event);
        scheduleRelease();
      }, delay);
    }

    function enqueue(event: ServerEvent) {
      let minShowAt: number;
      if (event.type === 'progress') {
        minShowAt = startedAt + (event.phase - 1) * PHASE_PACE_MS;
      } else if (event.type === 'complete') {
        minShowAt = startedAt + MIN_TOTAL_MS;
      } else {
        minShowAt = startedAt;
      }
      queue.push({ minShowAt, event });
      scheduleRelease();
    }

    function apply(event: ServerEvent) {
      if (event.type === 'progress') {
        setPhase(event.phase);
      } else if (event.type === 'complete') {
        router.replace('/finance');
      } else if (event.type === 'insufficient_data') {
        setInsufficient({ days: event.days_available, min: event.min_required });
      } else if (event.type === 'error') {
        setErrorMessage(event.message);
      }
    }

    (async () => {
      try {
        const { generation_id } = await api.generateBrief();
        const res = await api.briefEventsResponse(generation_id);
        for await (const event of parseSseStream(res)) {
          if (cancelled.current) break;
          enqueue(event);
          if (
            event.type === 'complete' ||
            event.type === 'error' ||
            event.type === 'insufficient_data'
          ) {
            break;
          }
        }
      } catch (err) {
        if (cancelled.current) return;
        setErrorMessage(
          err instanceof Error
            ? err.message
            : (err as { message?: string })?.message ?? 'Failed to start brief generation',
        );
      }
    })();

    return () => {
      cancelled.current = true;
      if (releaseTimer) clearTimeout(releaseTimer);
    };
  }, [api, router, attemptKey]);

  const lines = CHECKLIST_LINES.map((label, i): { label: string; state: Status } => {
    if (insufficient && i === 2) return { label: 'Gathering more signal', state: 'active' };
    if (insufficient && i >= 2) return { label, state: 'pending' };
    const lineIndex = i + 1;
    let state: Status = 'pending';
    if (phase >= lineIndex) state = 'done';
    else if (phase + 1 === lineIndex && phase > 0) state = 'active';
    else if (phase === 0 && i === 0) state = 'active';
    return { label, state };
  });

  const since = activation ? formatSince(activation.activatedAt) : '';

  // Typewriter greeting — same 26ms cadence as onboarding.
  const greetingTarget = `Give me a minute, ${firstName} — I'm reading your accounts.`;
  const [typedChars, setTypedChars] = useState(0);
  useEffect(() => {
    setTypedChars(0);
    if (!greetingTarget) return;
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

  return (
    <div className={shell.page}>
      <Header />
      <main className={`${shell.main} ${styles.mainWide}`}>
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

        <div className={styles.eyebrow}>Your agent is analyzing your accounts</div>

        <div className={styles.checklist}>
          {lines.map((line) => {
            const bulletCls =
              line.state === 'done'
                ? `${styles.bullet} ${styles.bulletDone}`
                : line.state === 'active'
                  ? `${styles.bullet} ${styles.bulletActive}`
                  : `${styles.bullet} ${styles.bulletPending}`;
            const textCls =
              line.state === 'done'
                ? styles.textDone
                : line.state === 'active'
                  ? styles.textActive
                  : styles.textPending;
            return (
              <div key={line.label} className={styles.line}>
                <span className={bulletCls}>{line.state === 'done' ? '✓' : ''}</span>
                <span className={textCls}>
                  {line.label}
                  {line.state === 'active' ? '…' : ''}
                </span>
              </div>
            );
          })}
        </div>

        {insufficient ? (
          <p className={styles.note}>
            I need a little more history before I can give you a real read. Come back tomorrow — I&apos;ll have something for you.
          </p>
        ) : errorMessage ? (
          <>
            <p className={`${styles.note} ${styles.errorNote}`}>
              Something went wrong: {errorMessage}
            </p>
            <button
              type="button"
              className={styles.retryBtn}
              onClick={() => setAttemptKey((k) => k + 1)}
            >
              Try again
            </button>
          </>
        ) : null}
      </main>
      <ChatInput agent="Finance" />
    </div>
  );
}
