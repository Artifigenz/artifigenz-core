'use client';

import React, { useEffect, useState, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { AGENTS } from '@artifigenz/shared';
import { useActivatedAgents, agentSlug } from '@/hooks/useActivatedAgents';
import * as Icons from './AgentIcons';
import styles from './AgentGrid.module.css';

const ICON_MAP: Record<string, ReactNode> = {
  Finance: <Icons.FinanceIcon />,
  Travel: <Icons.TravelIcon />,
  Health: <Icons.HealthIcon />,
  Research: <Icons.ResearchIcon />,
  'Job Search': <Icons.JobSearchIcon />,
};

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
      {insights[display]}
    </p>
  );
}

export default function AgentGrid() {
  const { slugs, hydrated } = useActivatedAgents();
  const active = AGENTS.filter((a) => slugs.includes(agentSlug(a.name)));
  const [visibleItems, setVisibleItems] = useState<Set<number>>(new Set());
  const [ticks, setTicks] = useState<number[]>([]);

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
    return (
      <section className={styles.section}>
        <div className={styles.emptyState}>
          <h3 className={styles.emptyTitle}>No active agents yet</h3>
          <p className={styles.emptyText}>
            Pick an agent from the explore page and I&apos;ll start working for you.
          </p>
          <Link href="/explore" className={styles.emptyCta}>
            Browse agents →
          </Link>
        </div>
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
                {agent.insights && <CyclingInsight insights={agent.insights} tick={ticks[index] ?? 0} />}
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
