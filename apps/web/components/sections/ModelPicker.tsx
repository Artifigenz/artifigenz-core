'use client';

import { useEffect, useRef, useState } from 'react';
import {
  MODELS,
  type ChatModel,
  type Intelligence,
  type Plan,
  intelligenceAvailableForPlan,
} from '@artifigenz/shared';
import { usePlan } from '@/hooks/usePlan';
import styles from './ModelPicker.module.css';

interface Props {
  modelId: string;
  intelligence: Intelligence;
  onModelChange: (modelId: string) => void;
  onIntelligenceChange: (intel: Intelligence) => void;
  /** Render variant: 'toolbar' (pill in chat input) or 'menu' (rows in popover). */
  variant?: 'toolbar' | 'menu';
}

const INTELLIGENCE_LABEL: Record<Intelligence, string> = {
  instant: 'Instant',
  medium: 'Medium',
  high: 'High',
};

const INTELLIGENCE_DESC: Record<Intelligence, string> = {
  instant: 'Fastest answer. Routes to Haiku.',
  medium: 'Balanced default.',
  high: 'Extended thinking. Slower, deeper.',
};

export default function ModelPicker({
  modelId,
  intelligence,
  onModelChange,
  onIntelligenceChange,
  variant = 'toolbar',
}: Props) {
  const plan = usePlan();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const intelAvailable = intelligenceAvailableForPlan(plan);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const pickIntelligence = (intel: Intelligence) => {
    if (!intelAvailable[intel]) return;
    onIntelligenceChange(intel);
    setOpen(false);
  };

  const pickModel = (id: string, locked: boolean) => {
    if (locked) return;
    onModelChange(id);
    setOpen(false);
  };

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.trigger} ${variant === 'menu' ? styles.triggerMenu : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={`Intelligence: ${INTELLIGENCE_LABEL[intelligence]}`}
      >
        <span className={styles.triggerLabel}>
          {INTELLIGENCE_LABEL[intelligence]}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          className={`${styles.menu} ${variant === 'menu' ? styles.menuAlignLeft : ''}`}
        >
          <div className={styles.menuBody}>
          {/* ── Intelligence ───────────────────────────────────── */}
          <div className={styles.group}>
            <div className={styles.groupLabel}>Intelligence</div>
            {(['instant', 'medium', 'high'] as Intelligence[]).map((intel) => {
              const locked = !intelAvailable[intel];
              const active = intelligence === intel && !locked;
              return (
                <button
                  key={intel}
                  type="button"
                  className={`${styles.item} ${active ? styles.itemActive : ''} ${locked ? styles.itemLocked : ''}`}
                  onClick={() => pickIntelligence(intel)}
                >
                  <div className={styles.itemBody}>
                    <div className={styles.itemLabel}>
                      {INTELLIGENCE_LABEL[intel]}
                    </div>
                    <div className={styles.itemDesc}>
                      {INTELLIGENCE_DESC[intel]}
                    </div>
                  </div>
                  {active && <CheckIcon />}
                  {locked && <LockBadge />}
                </button>
              );
            })}
          </div>

          {/* ── Model (Basic-tier available) ───────────────────── */}
          <div className={styles.group}>
            <div className={styles.groupLabel}>Model</div>
            {MODELS.filter((m) => m.tier === 'basic').map((m) => (
              <ModelRow
                key={m.id}
                model={m}
                active={modelId === m.id}
                locked={false}
                onPick={pickModel}
              />
            ))}
          </div>

          {/* ── Pro models (locked on Basic) ───────────────────── */}
          {(() => {
            const proModels = MODELS.filter((m) => m.tier === 'pro');
            if (proModels.length === 0) return null;
            return (
              <div className={styles.group}>
                <div className={styles.groupLabel}>
                  {plan === 'pro' ? 'Pro models' : 'Available on Pro'}
                </div>
                {proModels.map((m) => (
                  <ModelRow
                    key={m.id}
                    model={m}
                    active={modelId === m.id}
                    locked={plan !== 'pro'}
                    onPick={pickModel}
                  />
                ))}
              </div>
            );
          })()}

          </div>
          {/* ── Upgrade CTA (Basic only, pinned outside scroll) ── */}
          {plan !== 'pro' && (
            <a
              href="/settings#plan"
              className={styles.upgrade}
              onClick={() => setOpen(false)}
            >
              <span>Upgrade to Pro</span>
              <ArrowRightIcon />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function ModelRow({
  model,
  active,
  locked,
  onPick,
}: {
  model: ChatModel;
  active: boolean;
  locked: boolean;
  onPick: (id: string, locked: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.item} ${active ? styles.itemActive : ''} ${locked ? styles.itemLocked : ''}`}
      onClick={() => onPick(model.id, locked)}
      title={locked ? 'Available on Pro' : `${model.family} · ${model.label}`}
    >
      <div className={styles.itemBody}>
        <div className={styles.itemLabel}>{model.label}</div>
        {model.description && (
          <div className={styles.itemDesc}>{model.description}</div>
        )}
      </div>
      {active && <CheckIcon />}
      {locked && <LockBadge />}
    </button>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function LockBadge() {
  return (
    <span className={styles.lockBadge} aria-label="Pro only">
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    </span>
  );
}

function ArrowRightIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

export type { Plan };
