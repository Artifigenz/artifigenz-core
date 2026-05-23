'use client';

import { useEffect, useRef, useState } from 'react';
import { MODELS, type ChatModel } from '@artifigenz/shared';
import styles from './ModelPicker.module.css';

interface Props {
  value: string;
  onChange: (modelId: string) => void;
  /** Render variant: 'toolbar' (small pill in input) or 'menu' (rows in popover). */
  variant?: 'toolbar' | 'menu';
}

export default function ModelPicker({ value, onChange, variant = 'toolbar' }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const current = MODELS.find((m) => m.id === value) ?? MODELS[0];

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

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.trigger} ${variant === 'menu' ? styles.triggerMenu : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={`${current.family} · ${current.label}`}
      >
        <span className={styles.triggerLabel}>{current.label}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div
          className={`${styles.menu} ${variant === 'menu' ? styles.menuAlignLeft : ''}`}
        >
          {groupByFamily(MODELS).map(([family, models]) => (
            <div key={family} className={styles.group}>
              <div className={styles.groupLabel}>{family}</div>
              {models.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`${styles.item} ${m.id === value ? styles.itemActive : ''}`}
                  onClick={() => {
                    onChange(m.id);
                    setOpen(false);
                  }}
                >
                  <div className={styles.itemBody}>
                    <div className={styles.itemLabel}>{m.label}</div>
                    {m.description && (
                      <div className={styles.itemDesc}>{m.description}</div>
                    )}
                  </div>
                  {m.id === value && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          ))}
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
