import { AGENTS } from '@artifigenz/shared';
import * as Icons from '@/components/sections/AgentIcons';
import styles from './Consultants.module.css';

const ICON_MAP: Record<string, React.ComponentType> = {
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
  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>The team</p>
        <h2 className={styles.title}>Meet the consultants.</h2>
        <p className={styles.subtitle}>
          Each one is a specialist in a single domain. They share one unified
          understanding of you — so a fact told to one becomes context for all.
        </p>
      </div>

      <div className={styles.grid}>
        {AGENTS.map((agent) => {
          const IconComponent = ICON_MAP[agent.name];
          const hasInsights = agent.insights && agent.insights.length > 0;
          const sampleInsight = hasInsights ? agent.insights![0] : null;
          const topSkills = agent.skills.slice(0, 3);

          return (
            <article key={agent.name} className={styles.card}>
              <header className={styles.cardHeader}>
                <div className={styles.cardIcon}>
                  {IconComponent && <IconComponent />}
                </div>
                <div className={styles.cardName}>
                  <h3>{agent.name}</h3>
                  {!hasInsights && (
                    <span className={styles.comingSoon}>Coming soon</span>
                  )}
                </div>
              </header>

              <p className={styles.pitch}>{agent.pitch}</p>

              <div className={styles.skillsRow}>
                {topSkills.map((skill) => (
                  <span key={skill} className={styles.skillChip}>
                    {skill}
                  </span>
                ))}
              </div>

              {sampleInsight && (
                <div className={styles.sampleInsight}>
                  <span className={styles.sampleLabel}>Sample insight</span>
                  <p className={styles.sampleText}>&ldquo;{sampleInsight}&rdquo;</p>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
