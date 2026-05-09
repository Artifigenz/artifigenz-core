'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useClerk } from '@clerk/nextjs';
import { useApiClient } from '@/hooks/useApiClient';
import type { ApiError } from '@/lib/api-client';
import styles from '../page.module.css';

export function PrivacySection() {
  const api = useApiClient();
  const { signOut } = useClerk();
  const router = useRouter();

  const [deleteStep, setDeleteStep] = useState<'idle' | 'confirm' | 'verify'>('idle');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestDeletion() {
    setBusy(true);
    setError(null);
    try {
      await api.requestAccountDeletion();
      setDeleteStep('verify');
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeletion() {
    if (code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await api.confirmAccountDeletion(code);
      await signOut();
      router.replace('/');
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOutAll() {
    // TODO: Implement sign out all sessions
    console.log('Sign out all sessions');
  }

  async function handleExportData() {
    // TODO: Implement data export request
    console.log('Request data export');
  }

  return (
    <>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Privacy & data</h2>
          <p className={styles.sectionDesc}>
            Direct controls over what we keep.
          </p>
        </div>

        <div className={styles.card}>
          {/* Export data */}
          <div className={styles.rowAction}>
            <div className={styles.rowLabel}>
              <div className={styles.rowName}>Export your data</div>
              <div className={styles.rowHint} style={{ maxWidth: '40ch' }}>
                Every chat, insight, and connected source as JSON. Delivered by email within 24h.
              </div>
            </div>
            <button className={styles.btnGhost} onClick={handleExportData}>
              Request export
            </button>
          </div>

          {/* Sign out everywhere */}
          <div className={styles.rowAction}>
            <div className={styles.rowLabel}>
              <div className={styles.rowName}>Sign out everywhere</div>
              <div className={styles.rowHint} style={{ maxWidth: '40ch' }}>
                Revokes all active sessions. You&apos;ll need to sign in again on each device.
              </div>
            </div>
            <button className={styles.btnGhost} onClick={handleSignOutAll}>
              Sign out all
            </button>
          </div>

          {/* Delete account */}
          <div className={styles.rowAction}>
            <div className={styles.rowLabel}>
              <div className={styles.rowName}>
                <span className={styles.textDanger}>Delete account</span>
              </div>
              <div className={styles.rowHint} style={{ maxWidth: '40ch' }}>
                Permanently removes your account, agents, insights, and chat history. This cannot be undone.
              </div>
            </div>
            <button
              className={styles.btnDanger}
              onClick={() => {
                setDeleteStep('confirm');
                setError(null);
                setCode('');
              }}
            >
              Delete account
            </button>
          </div>
        </div>
      </section>

      {/* Delete confirmation modal */}
      {deleteStep === 'confirm' && (
        <div className={styles.modalOverlay} onClick={() => !busy && setDeleteStep('idle')}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Delete your account?</h2>
            <p className={styles.modalCopy}>
              This will permanently delete your Artifigenz account and all associated data.
              We&apos;ll send a 6-digit verification code to your email. You have 10 minutes to enter it.
            </p>
            {error && (
              <p style={{ color: '#c44', fontSize: '0.8rem', marginBottom: 12 }}>{error}</p>
            )}
            <div className={styles.modalActions}>
              <button
                className={styles.btnGhost}
                onClick={() => setDeleteStep('idle')}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className={styles.btnDanger}
                onClick={requestDeletion}
                disabled={busy}
              >
                {busy ? 'Sending code...' : 'Send code'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Verification modal */}
      {deleteStep === 'verify' && (
        <div className={styles.modalOverlay} onClick={() => !busy && setDeleteStep('idle')}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Enter verification code</h2>
            <p className={styles.modalCopy}>
              We sent a 6-digit code to your email. Enter it below to confirm deletion.
              This cannot be undone.
            </p>
            <input
              className={styles.input}
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="6-digit code"
              autoFocus
              style={{
                letterSpacing: '0.2em',
                textAlign: 'center',
                fontSize: '1rem',
                maxWidth: '100%',
              }}
            />
            {error && (
              <p style={{ color: '#c44', fontSize: '0.8rem', marginTop: 8 }}>{error}</p>
            )}
            <div className={styles.modalActions}>
              <button
                className={styles.btnGhost}
                onClick={() => setDeleteStep('idle')}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className={styles.btnDanger}
                onClick={confirmDeletion}
                disabled={busy || code.length !== 6}
              >
                {busy ? 'Deleting...' : 'Permanently delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
