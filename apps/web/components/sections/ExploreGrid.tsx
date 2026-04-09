'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { Agent } from '@artifigenz/shared';
import { agentSlug } from '@/hooks/useActivatedAgents';
import * as Icons from './AgentIcons';
import styles from './ExploreGrid.module.css';

const ICON_MAP: Record<string, ReactNode> = {
  Finance: <Icons.FinanceIcon />,
  Travel: <Icons.TravelIcon />,
  Health: <Icons.HealthIcon />,
  Research: <Icons.ResearchIcon />,
  'Job Search': <Icons.JobSearchIcon />,
  Learning: <Icons.LearningIcon />,
  Shopping: <Icons.ShoppingIcon />,
  Parenting: <Icons.ParentingIcon />,
  Events: <Icons.EventsIcon />,
  Pulse: <Icons.NewsIcon />,
};

interface ExploreGridProps {
  agents: Agent[];
  ctaLabel?: string;
}

export default function ExploreGrid({ agents, ctaLabel = 'Activate' }: ExploreGridProps) {
  const [visibleItems, setVisibleItems] = useState<Set<number>>(new Set());

  useEffect(() => {
    setVisibleItems(new Set());
    const timeouts: NodeJS.Timeout[] = [];
    agents.forEach((_, index) => {
      const timeout = setTimeout(() => {
        setVisibleItems((prev) => new Set(prev).add(index));
      }, 200 + index * 40);
      timeouts.push(timeout);
    });
    return () => timeouts.forEach((t) => clearTimeout(t));
  }, [agents.length]);

  return (
    <div className={styles.grid}>
      {agents.map((agent, index) => (
        <div
          key={agent.name}
          className={`${styles.card} ${visibleItems.has(index) ? styles.visible : ''}`}
        >
          <div className={styles.top}>
            <div className={styles.icon}>{ICON_MAP[agent.name]}</div>
            <div className={styles.name}>{agent.name}</div>
          </div>
          <p className={styles.pitch}>{agent.pitch}</p>
          <div className={styles.bottom}>
            <Link
              href={`/agent/${agentSlug(agent.name)}/activate`}
              className={styles.activate}
            >
              {ctaLabel}
              <span className={styles.activateIcon}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14" />
                  <path d="M12 5l7 7-7 7" />
                </svg>
              </span>
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
