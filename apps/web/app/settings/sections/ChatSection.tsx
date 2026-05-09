'use client';

import { useEffect, useState, useCallback } from 'react';
import { useApiClient } from '@/hooks/useApiClient';
import type { ApiError } from '@/lib/api-client';
import styles from '../page.module.css';

const REPLY_LENGTHS = ['Concise', 'Balanced', 'Thorough'] as const;
type ReplyLength = (typeof REPLY_LENGTHS)[number];

export function ChatSection() {
  const api = useApiClient();
  const [instructions, setInstructions] = useState('');
  const [replyLength, setReplyLength] = useState<ReplyLength>('Balanced');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getChatInstructions()
      .then((data) => {
        if (cancelled) return;
        setInstructions(data.instructions ?? '');
      })
      .catch((err: ApiError) => console.error(err.message));
    return () => {
      cancelled = true;
    };
  }, [api]);

  // Debounced auto-save for instructions
  const saveInstructions = useCallback(async (value: string) => {
    setSaving(true);
    try {
      await api.updateChatInstructions(value.trim() ? value.trim() : null);
    } catch (err) {
      console.error((err as ApiError).message);
    } finally {
      setSaving(false);
    }
  }, [api]);

  // Auto-save on blur
  function handleInstructionsBlur() {
    saveInstructions(instructions);
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Chat behavior</h2>
        <p className={styles.sectionDesc}>
          Personalize how every agent talks back.
        </p>
      </div>

      <div className={styles.card}>
        {/* Custom instructions */}
        <div className={`${styles.row} ${styles.rowStack}`}>
          <div className={styles.rowLabel}>
            <div className={styles.rowName}>Custom instructions</div>
            <div className={styles.rowHint} style={{ maxWidth: '100%' }}>
              Included in every chat. Try preferences for length, tone, currency, units, location.
            </div>
          </div>
          <div className={styles.rowControl}>
            <textarea
              className={styles.textarea}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              onBlur={handleInstructionsBlur}
              maxLength={1500}
              rows={5}
              placeholder="I prefer concise answers. I'm based in SF. Always show amounts in USD."
            />
            <div className={styles.counter}>
              {instructions.length} / 1500
            </div>
          </div>
        </div>

        {/* Reply length */}
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <div className={styles.rowName}>Reply length</div>
            <div className={styles.rowHint}>
              Default verbosity. Override in any chat with <code>/concise</code> or <code>/thorough</code>.
            </div>
          </div>
          <div className={styles.rowControl}>
            <div className={styles.segmented}>
              {REPLY_LENGTHS.map((length) => (
                <button
                  key={length}
                  className={`${styles.seg} ${replyLength === length ? styles.segActive : ''}`}
                  onClick={() => setReplyLength(length)}
                >
                  {length}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
