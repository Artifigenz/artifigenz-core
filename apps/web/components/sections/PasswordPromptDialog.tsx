'use client';

import { useEffect, useState } from 'react';
import styles from './PasswordPromptDialog.module.css';

interface Props {
  filename: string;
  encryptedKind: 'pdf' | 'xlsx' | 'zip';
  submitting: boolean;
  wrongPassword: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

// Common Indian-bank password formats shown as a one-line hint. We don't
// know the bank yet (the file's still encrypted), so we list the patterns
// rather than try to auto-detect.
const HINTS: Record<Props['encryptedKind'], string> = {
  pdf: 'Most banks use: first 4 of name + DDMM of DOB (HDFC), name + DDMMYYYY (ICICI), or your account number (SBI). Try without padding zeros first.',
  xlsx: 'Try the same password your bank uses for PDF statements — usually account number, customer ID, or name + DOB.',
  zip: 'The password your bank emailed with the statement. Often customer ID or last 4 of account.',
};

const KIND_LABEL: Record<Props['encryptedKind'], string> = {
  pdf: 'PDF',
  xlsx: 'Excel file',
  zip: 'ZIP archive',
};

export default function PasswordPromptDialog({
  filename,
  encryptedKind,
  submitting,
  wrongPassword,
  onSubmit,
  onCancel,
}: Props) {
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);

  // Reset password input each time the dialog opens fresh (different file).
  useEffect(() => {
    setPassword('');
    setReveal(false);
  }, [filename]);

  // ESC to cancel — only when not mid-submit so we don't lose typed pw.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submitting, onCancel]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || submitting) return;
    onSubmit(password);
  };

  return (
    <div className={styles.backdrop} onClick={() => !submitting && onCancel()}>
      <form
        className={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <div className={styles.header}>
          <div className={styles.iconRing}>
            {/* Padlock icon */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
          </div>
          <div>
            <h3 className={styles.title}>This {KIND_LABEL[encryptedKind]} needs a password</h3>
            <p className={styles.filename}>{filename}</p>
          </div>
        </div>

        <p className={styles.hint}>{HINTS[encryptedKind]}</p>

        <div className={styles.inputRow}>
          <input
            type={reveal ? 'text' : 'password'}
            className={styles.input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Statement password"
            autoFocus
            disabled={submitting}
          />
          <button
            type="button"
            className={styles.revealBtn}
            onClick={() => setReveal((v) => !v)}
            tabIndex={-1}
            aria-label={reveal ? 'Hide password' : 'Show password'}
          >
            {reveal ? 'Hide' : 'Show'}
          </button>
        </div>

        {wrongPassword && (
          <p className={styles.error}>That password didn&apos;t work — try another format.</p>
        )}

        <p className={styles.security}>
          Your password is sent encrypted (HTTPS), used once to decrypt the file, then discarded. We never store it.
        </p>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cancel}
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={styles.submit}
            disabled={!password || submitting}
          >
            {submitting ? 'Unlocking…' : 'Unlock'}
          </button>
        </div>
      </form>
    </div>
  );
}
