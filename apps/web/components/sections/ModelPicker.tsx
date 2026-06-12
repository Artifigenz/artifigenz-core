'use client';

import { useEffect, useRef, useState } from 'react';
import {
  MODELS,
  findModel,
  type ChatModel,
  type Intelligence,
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
  const currentModel = findModel(modelId);
  // Intelligence still flows server-side (Instant routes to Haiku, High
  // enables extended thinking). The UI row was noise — keep the state
  // pass-through so callers don't have to change, but stop rendering it.
  void intelligence;
  void onIntelligenceChange;

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

  const pickModel = (m: ChatModel) => {
    const locked = m.tier === 'pro' && plan !== 'pro';
    if (locked) return;
    onModelChange(m.id);
    setOpen(false);
  };

  // Group models by family/provider for clean Claude / OpenAI sections.
  const groups = groupByFamily(MODELS);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.trigger} ${variant === 'menu' ? styles.triggerMenu : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={`${currentModel.family} · ${currentModel.label}`}
      >
        <span className={styles.triggerLabel}>{currentModel.label}</span>
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
            {/* ── Models grouped by provider ─────────────────────── */}
            {groups.map(([family, models]) => (
              <div key={family} className={styles.group}>
                <div className={styles.groupLabel}>{family}</div>
                {models.map((m) => {
                  const locked = m.tier === 'pro' && plan !== 'pro';
                  const active = m.id === modelId;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={`${styles.item} ${active ? styles.itemActive : ''} ${locked ? styles.itemLocked : ''}`}
                      onClick={() => pickModel(m)}
                      disabled={locked}
                      title={
                        locked
                          ? 'Available on Pro'
                          : `${m.family} · ${m.label}`
                      }
                    >
                      <div className={styles.itemBody}>
                        <div className={styles.itemLabel}>{m.label}</div>
                        {m.description && (
                          <div className={styles.itemDesc}>{m.description}</div>
                        )}
                      </div>
                      {active && !locked && <CheckIcon />}
                      {locked && <LockIcon />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function groupByFamily(models: ChatModel[]): Array<[string, ChatModel[]]> {
  const map = new Map<string, ChatModel[]>();
  for (const m of models) {
    const arr = map.get(m.family) ?? [];
    arr.push(m);
    map.set(m.family, arr);
  }
  return Array.from(map.entries());
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

function LockIcon() {
  return (
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
  );
}
