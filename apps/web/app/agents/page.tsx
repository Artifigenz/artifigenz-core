'use client';

import Link from 'next/link';
import { AGENTS } from '@artifigenz/shared';
import Header from '@/components/layout/Header';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import {
  FinanceIcon,
  TravelIcon,
  HealthIcon,
  ResearchIcon,
  JobSearchIcon,
} from '@/components/sections/AgentIcons';
import { useActivatedAgents, agentSlug } from '@/hooks/useActivatedAgents';
import styles from './page.module.css';

const ICON_MAP: Record<string, React.ReactNode> = {
  Finance: <FinanceIcon />,
  Travel: <TravelIcon />,
  Health: <HealthIcon />,
  Research: <ResearchIcon />,
  'Job Search': <JobSearchIcon />,
};

export default function AgentsPage() {
  return (
    <ProtectedRoute>
      <AgentsContent />
    </ProtectedRoute>
  );
}

function AgentsContent() {
  const { slugs } = useActivatedAgents();
  const activated = new Set(slugs);

  // Only Finance is real today. The rest are roadmap placeholders kept
  // here so the page reads like "what's available" rather than "Finance
  // alone in a vacuum". Marked disabled so users can't activate them.
  const enabledAgents = ['Finance'];

  return (
    <div className={styles.page}>
      <Header />
      <main className={styles.main}>
        <div className={styles.hero}>
          <h1 className={styles.title}>Agents</h1>
          <p className={styles.subtitle}>
            Specialist agents that watch your data, surface insights, and deliver them by email, Telegram, or in-app.
          </p>
        </div>

        <div className={styles.grid}>
          {AGENTS.map((agent) => {
            const slug = agentSlug(agent.name);
            const isEnabled = enabledAgents.includes(agent.name);
            const isActivated = activated.has(slug);
            const icon = ICON_MAP[agent.name];

            const cardInner = (
              <>
                <div className={styles.cardHead}>
                  <span className={styles.icon}>{icon}</span>
                  <span className={styles.cardName}>{agent.name}</span>
                  {isEnabled ? (
                    isActivated ? (
                      <span className={`${styles.badge} ${styles.badgeActive}`}>
                        Active
                      </span>
                    ) : (
                      <span className={styles.badge}>Available</span>
                    )
                  ) : (
                    <span className={`${styles.badge} ${styles.badgeMuted}`}>
                      Coming soon
                    </span>
                  )}
                </div>
                <p className={styles.pitch}>{agent.pitch}</p>
                <div className={styles.skills}>
                  {agent.skills.slice(0, 3).map((skill) => (
                    <span key={skill} className={styles.skillChip}>
                      {skill}
                    </span>
                  ))}
                </div>
              </>
            );

            if (!isEnabled) {
              return (
                <div
                  key={agent.name}
                  className={`${styles.card} ${styles.cardDisabled}`}
                >
                  {cardInner}
                </div>
              );
            }

            const href = isActivated ? `/${slug}` : `/agent/${slug}`;
            return (
              <Link
                key={agent.name}
                href={href}
                className={`${styles.card} ${styles.cardLink}`}
              >
                {cardInner}
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
