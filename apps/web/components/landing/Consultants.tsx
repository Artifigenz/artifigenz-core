'use client';

import { useState } from 'react';
import { AGENTS } from '@artifigenz/shared';
import * as Icons from '@/components/sections/AgentIcons';
import { LANDING_AGENT_ICONS } from './LandingAgentIcons';
import styles from './Consultants.module.css';

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

export default function Consultants() {
  const [selectedName, setSelectedName] = useState<string>(AGENTS[0].name);
  const selected = AGENTS.find((a) => a.name === selectedName) ?? AGENTS[0];
  const SelectedOutlineIcon = OUTLINE_MAP[selected.name];
  const sampleInsight = selected.insights?.[0] ?? null;
  const hasInsight = Boolean(sampleInsight);

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>The team</p>
        <h2 className={styles.title}>Meet the consultants.</h2>
        <p className={styles.subtitle}>
          Pick one. They share a single understanding of you, so what you tell one becomes context for all.
        </p>
      </div>

      {/* ─── Picker row ─── */}
      <div className={styles.pickerScroll}>
        <div className={styles.picker}>
          {AGENTS.map((agent) => {
            const OutlineIcon = OUTLINE_MAP[agent.name];
            const FilledIcon = LANDING_AGENT_ICONS[agent.name];
            const isActive = agent.name === selectedName;
            return (
              <button
                key={agent.name}
                type="button"
                className={`${styles.pickerItem} ${isActive ? styles.pickerItemActive : ''}`}
                onClick={() => setSelectedName(agent.name)}
                aria-pressed={isActive}
              >
                <span className={styles.pickerOrb}>
                  {isActive
                    ? FilledIcon && <FilledIcon size={24} />
                    : OutlineIcon && <OutlineIcon />}
                </span>
                <span className={styles.pickerName}>{agent.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Spotlight ─── */}
      <div className={styles.spotlight}>
        <div className={styles.spotlightLeft}>
          <div className={styles.spotlightIconWrap}>
            <div className={styles.spotlightIcon}>{SelectedOutlineIcon && <SelectedOutlineIcon />}</div>
          </div>
          <div className={styles.spotlightText}>
            <div className={styles.spotlightNameRow}>
              <h3 className={styles.spotlightName}>{selected.name}</h3>
              {!hasInsight && <span className={styles.spotlightBadge}>Launching soon</span>}
            </div>
            <p className={styles.spotlightPitch}>{selected.pitch}</p>
            <div className={styles.spotlightSkills}>
              {selected.skills.slice(0, 5).map((skill) => (
                <span key={skill} className={styles.skillChip}>
                  {skill}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.spotlightRight}>
          <span className={styles.sampleLabel}>A typical morning</span>
          {hasInsight ? (
            <div className={styles.notification}>
              <div className={styles.notificationIconSlot}>{SelectedOutlineIcon && <SelectedOutlineIcon />}</div>
              <div className={styles.notificationBody}>
                <div className={styles.notificationMeta}>
                  <span className={styles.notificationAgent}>{selected.name} Consultant</span>
                  <span className={styles.notificationTime}>now</span>
                </div>
                <p className={styles.notificationTitle}>{sampleInsight}</p>
              </div>
            </div>
          ) : (
            <div className={styles.comingSoonBox}>
              <p className={styles.comingSoonText}>
                This consultant isn&rsquo;t shipping yet — but it&rsquo;s next on the roster.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
