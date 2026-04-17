'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AGENTS } from '@artifigenz/shared';
import * as Icons from '@/components/sections/AgentIcons';
import { LANDING_AGENT_ICONS } from '../LandingAgentIcons';
import Slide, { type SlideProps } from './Slide';
import sharedStyles from './Slide.module.css';
import styles from './Slide3Consultants.module.css';

const ROTATE_MS = 2200;

const OUTLINE_MAP: Record<string, React.ComponentType> = {
  Finance: Icons.FinanceIcon,
  Travel: Icons.TravelIcon,
  Health: Icons.HealthIcon,
  Research: Icons.ResearchIcon,
  'Job Search': Icons.JobSearchIcon,
  Learning: Icons.LearningIcon,
  Shopping: Icons.ShoppingIcon,
  Parenting: Icons.ParentingIcon,
  Events: Icons.EventsIcon,
  Pulse: Icons.NewsIcon,
};

export default function Slide3Consultants(props: SlideProps) {
  const [highlight, setHighlight] = useState(0);

  // Auto-rotate the spotlighted agent so it feels alive
  useEffect(() => {
    if (!props.isActive) return;
    const interval = setInterval(() => {
      setHighlight((h) => (h + 1) % AGENTS.length);
    }, ROTATE_MS);
    return () => clearInterval(interval);
  }, [props.isActive]);

  const featured = AGENTS[highlight];
  const FeaturedOutline = OUTLINE_MAP[featured.name];
  const FeaturedFilled = LANDING_AGENT_ICONS[featured.name];
  const sampleInsight = featured.insights?.[0] ?? null;
  const topSkills = featured.skills.slice(0, 5);

  return (
    <Slide {...props} className={styles.slide3}>
      <div className={`${sharedStyles.inner} ${styles.inner}`}>
        <p className={sharedStyles.eyebrow}>
          <span className={sharedStyles.eyebrowDot} />
          The team
        </p>
        <h2 className={sharedStyles.title}>Meet your consultants.</h2>
        <p className={sharedStyles.subtitle}>
          Each one specializes in a single domain. Together they share one understanding
          of you — what you tell one becomes context for all.
        </p>

        {/* Constellation of consultant icons */}
        <div className={styles.constellation}>
          {AGENTS.map((agent, i) => {
            const Outline = OUTLINE_MAP[agent.name];
            const Filled = LANDING_AGENT_ICONS[agent.name];
            const isFeatured = i === highlight;
            return (
              <button
                key={agent.name}
                type="button"
                className={`${styles.orb} ${isFeatured ? styles.orbFeatured : ''}`}
                onClick={() => setHighlight(i)}
                aria-label={agent.name}
                aria-pressed={isFeatured}
              >
                <span className={styles.iconOutline}>
                  {Outline && <Outline />}
                </span>
                <span className={styles.iconFilled}>
                  {Filled && <Filled size={28} />}
                </span>
              </button>
            );
          })}
        </div>

        {/* Featured spotlight beneath */}
        <div className={styles.featured}>
          <div className={styles.featuredIcon}>
            <span className={styles.featuredIconFilled}>
              {FeaturedFilled && <FeaturedFilled size={32} />}
            </span>
            <span className={styles.featuredIconOutline}>
              {FeaturedOutline && <FeaturedOutline />}
            </span>
          </div>
          <div className={styles.featuredBody}>
            <div className={styles.featuredName}>{featured.name} Consultant</div>
            <p className={styles.featuredPitch}>
              {sampleInsight ? `“${sampleInsight}”` : featured.pitch}
            </p>
            <div className={styles.featuredSkills}>
              {topSkills.map((skill) => (
                <span key={skill} className={styles.skillChip}>
                  {skill}
                </span>
              ))}
            </div>
          </div>
        </div>

        <Link href="/sign-up" className={`${sharedStyles.cta} ${styles.cta}`}>
          Get started
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
            <path d="M12 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
    </Slide>
  );
}
