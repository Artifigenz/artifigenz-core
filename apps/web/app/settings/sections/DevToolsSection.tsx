'use client';

import { useDevtools } from '@/lib/devtools-context';
import styles from '../page.module.css';

/**
 * Developer affordance — for now visible to everyone, intended to be
 * gated to internal users later (one-line change once we add a
 * users.isInternal flag).
 *
 * The single setting today is "Agent mode": flipping it on reveals
 * /agents, /finance, /agent/*, and the agent grid on the home page.
 * Off (the default for public users) keeps the product chat-only.
 */
export function DevToolsSection() {
  const { agentMode, setAgentMode, hydrated } = useDevtools();

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>DevTools</h2>
        <p className={styles.sectionDesc}>
          Internal-only switches. Persisted in this browser; not synced across devices.
        </p>
      </div>

      <div className={styles.card}>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <div className={styles.rowName}>Agent mode</div>
            <div className={styles.rowHint}>
              Show the /agents page and unlock the Finance dashboard. Off keeps the product chat-only.
            </div>
          </div>
          <div className={styles.rowControl}>
            <button
              type="button"
              role="switch"
              aria-checked={agentMode}
              disabled={!hydrated}
              className={`${styles.toggle} ${agentMode ? styles.toggleOn : ''}`}
              onClick={() => setAgentMode(!agentMode)}
            >
              <span className={styles.toggleKnob} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
