'use client';

import { useEffect, useState } from 'react';
import type { Plan } from '@artifigenz/shared';
import { useDevtools } from '@/lib/devtools-context';
import { readDevPlanOverride, setDevPlanOverride } from '@/hooks/usePlan';
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
  const [planOverride, setPlanOverride] = useState<Plan | null>(null);

  useEffect(() => {
    setPlanOverride(readDevPlanOverride());
  }, []);

  const pickPlan = (plan: Plan) => {
    setPlanOverride(plan);
    setDevPlanOverride(plan);
  };
  const clearPlan = () => {
    setPlanOverride(null);
    setDevPlanOverride(null);
  };

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

        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <div className={styles.rowName}>Simulate plan</div>
            <div className={styles.rowHint}>
              Pretend the user is on this plan in the model picker. Billing is
              unaffected. Default behavior (Clear) treats everyone as Basic.
            </div>
          </div>
          <div
            className={styles.rowControl}
            style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}
          >
            <PlanChip
              label="Basic"
              active={planOverride === 'basic'}
              onClick={() => pickPlan('basic')}
            />
            <PlanChip
              label="Pro"
              active={planOverride === 'pro'}
              onClick={() => pickPlan('pro')}
            />
            <button
              type="button"
              onClick={clearPlan}
              disabled={planOverride === null}
              style={{
                fontSize: '0.78rem',
                padding: '6px 12px',
                background: 'transparent',
                border: '1px solid var(--border-light)',
                borderRadius: 999,
                color: 'var(--text-mid)',
                cursor: planOverride === null ? 'default' : 'pointer',
                opacity: planOverride === null ? 0.5 : 1,
                fontFamily: 'inherit',
              }}
            >
              Clear
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function PlanChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: '0.78rem',
        padding: '6px 14px',
        borderRadius: 999,
        border: active ? '1px solid var(--text)' : '1px solid var(--border-light)',
        background: active ? 'var(--text)' : 'transparent',
        color: active ? 'var(--bg)' : 'var(--text)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontWeight: 500,
      }}
    >
      {label}
    </button>
  );
}
