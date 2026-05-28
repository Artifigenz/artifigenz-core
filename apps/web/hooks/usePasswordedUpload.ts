'use client';

import { useCallback, useState } from 'react';
import { useApiClient } from '@/hooks/useApiClient';
import type { StatementMetadata } from '@/lib/api-client';

interface PendingUnlock {
  fileId: string;
  filename: string;
  encryptedKind: 'pdf' | 'xlsx' | 'zip';
}

interface UseResult {
  /**
   * Run an upload. If the file's encrypted, exposes pendingUnlock so the
   * caller can render the password prompt; resolves once the user
   * cancels or the file is fully validated.
   *
   * Returns { fileId, metadata } on success, null on cancel/unsupported.
   */
  upload: (file: File) => Promise<{ fileId: string; metadata: StatementMetadata } | null>;
  /** Set when the upload is paused waiting for a password. */
  pendingUnlock: PendingUnlock | null;
  submittingPassword: boolean;
  wrongPassword: boolean;
  submitPassword: (password: string) => void;
  cancelPassword: () => void;
  /** Surfaced when the file's unsupported (bad encryption scheme, etc.) */
  unsupportedReason: string | null;
}

/**
 * Drives the two-phase upload-then-maybe-unlock flow. The hook centralises
 * the state machine so each caller (Activate, FinanceConnect, /finance
 * settings tab) just renders the dialog and forwards events.
 */
export function usePasswordedUpload(): UseResult {
  const api = useApiClient();
  const [pendingUnlock, setPendingUnlock] = useState<PendingUnlock | null>(null);
  const [submittingPassword, setSubmittingPassword] = useState(false);
  const [wrongPassword, setWrongPassword] = useState(false);
  const [unsupportedReason, setUnsupportedReason] = useState<string | null>(null);

  // Each upload that hits needs_password parks a resolver here; the
  // password dialog handlers resolve it once we know the outcome.
  const [resolver, setResolver] = useState<
    ((value: { fileId: string; metadata: StatementMetadata } | null) => void) | null
  >(null);

  const upload = useCallback(
    async (file: File) => {
      setUnsupportedReason(null);
      setWrongPassword(false);

      const formData = new FormData();
      formData.append('file', file);
      const result = await api.uploadFile(formData);

      if (result.status === 'validated') {
        return { fileId: result.fileId, metadata: result.metadata };
      }

      // needs_password — park a promise and wait for dialog interaction.
      const fileId = result.fileId;
      return new Promise<{ fileId: string; metadata: StatementMetadata } | null>((resolve) => {
        setResolver(() => resolve);
        setPendingUnlock({
          fileId,
          filename: result.file.name,
          encryptedKind: result.encryptedKind,
        });
      });
    },
    [api],
  );

  const submitPassword = useCallback(
    async (password: string) => {
      if (!pendingUnlock || !resolver) return;
      setSubmittingPassword(true);
      setWrongPassword(false);
      try {
        const res = await api.unlockUpload(pendingUnlock.fileId, password);
        if (res.status === 'validated') {
          resolver({ fileId: pendingUnlock.fileId, metadata: res.metadata });
          setResolver(null);
          setPendingUnlock(null);
          return;
        }
        if (res.status === 'wrong_password') {
          setWrongPassword(true);
          return;
        }
        if (res.status === 'rejected') {
          // The file decrypted but wasn't a statement. Bubble up as
          // "no metadata" by resolving with null + setting reason.
          setUnsupportedReason(res.reason || 'Not recognized as a bank statement');
          resolver(null);
          setResolver(null);
          setPendingUnlock(null);
          return;
        }
        // unsupported
        setUnsupportedReason(res.reason ?? 'Unsupported encryption');
        resolver(null);
        setResolver(null);
        setPendingUnlock(null);
      } catch (err) {
        setUnsupportedReason(
          (err as { message?: string })?.message ?? 'Unlock failed',
        );
        resolver(null);
        setResolver(null);
        setPendingUnlock(null);
      } finally {
        setSubmittingPassword(false);
      }
    },
    [api, pendingUnlock, resolver],
  );

  const cancelPassword = useCallback(() => {
    if (resolver) resolver(null);
    setResolver(null);
    setPendingUnlock(null);
    setSubmittingPassword(false);
    setWrongPassword(false);
  }, [resolver]);

  return {
    upload,
    pendingUnlock,
    submittingPassword,
    wrongPassword,
    submitPassword,
    cancelPassword,
    unsupportedReason,
  };
}
