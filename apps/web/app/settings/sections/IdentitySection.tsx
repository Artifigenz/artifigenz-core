'use client';

import { useEffect, useState } from 'react';
import { useApiClient } from '@/hooks/useApiClient';
import type { ApiError } from '@/lib/api-client';
import styles from '../page.module.css';

type EditingField = 'name' | 'currency' | null;

export function IdentitySection() {
  const api = useApiClient();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('USD — US Dollar');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditingField>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getMe()
      .then((data) => {
        if (cancelled) return;
        setEmail(data.email);
        setName(data.name ?? '');
      })
      .catch((err: ApiError) => console.error(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [api]);

  function startEdit(field: EditingField) {
    if (!field) return;
    setEditing(field);
    if (field === 'name') setEditValue(name);
    if (field === 'currency') setEditValue(currency);
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    try {
      if (editing === 'name') {
        await api.patchMe({ name: editValue });
        setName(editValue);
      }
      if (editing === 'currency') {
        setCurrency(editValue);
      }
    } catch (err) {
      console.error((err as ApiError).message);
    } finally {
      setSaving(false);
      setEditing(null);
    }
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Identity</h2>
        <p className={styles.sectionDesc}>
          How you appear to your agents and to other humans on shared work.
        </p>
      </div>

      <div className={styles.card}>
        {/* Display name */}
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <div className={styles.rowName}>Display name</div>
            <div className={styles.rowHint}>Used by agents in greetings.</div>
          </div>
          <div className={styles.rowControl}>
            {editing === 'name' ? (
              <div className={styles.inputRow}>
                <input
                  className={styles.input}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  autoFocus
                  style={{ maxWidth: 200 }}
                />
                <button
                  className={styles.btnGhost}
                  onClick={saveEdit}
                  disabled={saving}
                >
                  Done
                </button>
              </div>
            ) : (
              <div className={styles.inlineDisplay}>
                <span className={styles.inlineValue}>
                  {loading ? '...' : name || 'Not set'}
                </span>
                <button className={styles.btnLink} onClick={() => startEdit('name')}>
                  Edit
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Account email */}
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <div className={styles.rowName}>Account email</div>
            <div className={styles.rowHint}>
              A verification link is sent before any change takes effect.
            </div>
          </div>
          <div className={styles.rowControl}>
            <div className={styles.inlineDisplay}>
              <span className={styles.inlineValue}>
                {loading ? '...' : email}
              </span>
              <span className={`${styles.pill} ${styles.pillOk}`}>✓ verified</span>
            </div>
          </div>
        </div>

        {/* Currency */}
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <div className={styles.rowName}>Currency</div>
            <div className={styles.rowHint}>Used everywhere amounts appear.</div>
          </div>
          <div className={styles.rowControl}>
            {editing === 'currency' ? (
              <div className={styles.inputRow}>
                <input
                  className={styles.input}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  autoFocus
                  style={{ maxWidth: 200 }}
                />
                <button
                  className={styles.btnGhost}
                  onClick={saveEdit}
                  disabled={saving}
                >
                  Done
                </button>
              </div>
            ) : (
              <div className={styles.inlineDisplay}>
                <span className={styles.inlineValue}>{currency}</span>
                <button className={styles.btnLink} onClick={() => startEdit('currency')}>
                  Change
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
