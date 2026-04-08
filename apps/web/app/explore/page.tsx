'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import { AGENTS } from '@artifigenz/shared';
import { useActivatedAgents, agentSlug } from '@/hooks/useActivatedAgents';
import * as Icons from '@/components/sections/AgentIcons';
import styles from './page.module.css';

const ICON_MAP: Record<string, ReactNode> = {
  Finance: <Icons.FinanceIcon />,
  Travel: <Icons.TravelIcon />,
  Health: <Icons.HealthIcon />,
  Research: <Icons.ResearchIcon />,
  Learning: <Icons.LearningIcon />,
  Shopping: <Icons.ShoppingIcon />,
  Content: <Icons.ContentIcon />,
  Time: <Icons.TimeIcon />,
  Legal: <Icons.LegalIcon />,
  Career: <Icons.CareerIcon />,
  'Real Estate': <Icons.RealEstateIcon />,
  Parenting: <Icons.ParentingIcon />,
  Fitness: <Icons.FitnessIcon />,
  Nutrition: <Icons.NutritionIcon />,
  Events: <Icons.EventsIcon />,
  Tax: <Icons.TaxIcon />,
  News: <Icons.NewsIcon />,
  Relationships: <Icons.RelationshipsIcon />,
  Home: <Icons.HomeIcon />,
  Investments: <Icons.InvestmentsIcon />,
};

export default function ExplorePage() {
  const { slugs, hydrated } = useActivatedAgents();
  const [visibleItems, setVisibleItems] = useState<Set<number>>(new Set());
  const explore = AGENTS.filter((a) => !slugs.includes(agentSlug(a.name)));

  useEffect(() => {
    setVisibleItems(new Set());
    const timeouts: NodeJS.Timeout[] = [];
    explore.forEach((_, index) => {
      const timeout = setTimeout(() => {
        setVisibleItems((prev) => new Set(prev).add(index));
      }, 200 + index * 40);
      timeouts.push(timeout);
    });
    return () => timeouts.forEach((t) => clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, explore.length]);

  return (
    <div className={styles.page}>
      <Header />
      <main className={styles.main}>
        <div className={styles.header}>
          <h1 className={styles.title}>Explore Agents</h1>
          <p className={styles.sub}>Specialists ready to work for you. Activate any agent and it starts immediately.</p>
        </div>
        <div className={styles.grid}>
          {explore.map((agent, index) => (
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
                  Activate
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
      </main>
    </div>
  );
}
