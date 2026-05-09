'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useApiClient } from '@/hooks/useApiClient';
import type { ApiError } from '@/lib/api-client';
import styles from '../page.module.css';

export function ChannelsSection() {
  const api = useApiClient();
  const [prefs, setPrefs] = useState<{
    email: { enabled: boolean; address: string | null };
    telegram: { enabled: boolean; chatId: string | null };
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Telegram state
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [telegramLinkPending, setTelegramLinkPending] = useState(false);
  const [connectingTelegram, setConnectingTelegram] = useState(false);
  const [telegramExpanded, setTelegramExpanded] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Quiet hours
  const [quietStart, setQuietStart] = useState('22:00');
  const [quietEnd, setQuietEnd] = useState('07:00');

  useEffect(() => {
    let cancelled = false;
    api
      .getDeliveryPreferences()
      .then((data) => {
        if (cancelled) return;
        setPrefs(data);
        if (data.telegram.enabled || data.telegram.chatId) {
          setTelegramExpanded(false);
        }
      })
      .catch(() => {
        // Gracefully handle API errors (e.g., missing DB columns)
        if (!cancelled) {
          setPrefs({
            email: { enabled: false, address: null },
            telegram: { enabled: false, chatId: null },
          });
        }
      });

    api.getTelegramStatus().then((status) => {
      if (cancelled) return;
      setTelegramConnected(status.connected);
      setTelegramLinkPending(status.linkPending);
    }).catch(() => {
      // Ignore telegram status errors
    });

    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  const checkTelegramStatus = useCallback(async () => {
    try {
      const status = await api.getTelegramStatus();
      setTelegramConnected(status.connected);
      setTelegramLinkPending(status.linkPending);

      if (status.connected) {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        setConnectingTelegram(false);
        const fresh = await api.getDeliveryPreferences();
        setPrefs(fresh);
      }
    } catch {
      // Ignore errors during polling
    }
  }, [api]);

  async function update(partial: Parameters<typeof api.updateDeliveryPreferences>[0]) {
    setSaving(true);
    setError(null);
    try {
      await api.updateDeliveryPreferences(partial);
      const fresh = await api.getDeliveryPreferences();
      setPrefs(fresh);
    } catch {
      setError('Unable to save preferences right now');
    } finally {
      setSaving(false);
    }
  }

  async function handleConnectTelegram() {
    setConnectingTelegram(true);
    setError(null);
    try {
      const { linkUrl } = await api.generateTelegramLink();
      window.open(linkUrl, '_blank');
      setTelegramLinkPending(true);
      setTelegramExpanded(true);
      pollIntervalRef.current = setInterval(checkTelegramStatus, 2000);
    } catch (err) {
      setError('Telegram connection temporarily unavailable');
      setConnectingTelegram(false);
    }
  }

  async function handleDisconnectTelegram() {
    setSaving(true);
    setError(null);
    try {
      await api.updateDeliveryPreferences({ telegram: { enabled: false, chatId: '' } });
      const fresh = await api.getDeliveryPreferences();
      setPrefs(fresh);
      setTelegramConnected(false);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setSaving(false);
    }
  }

  const emailEnabled = prefs?.email.enabled ?? false;
  const emailAddress = prefs?.email.address ?? '';
  const telegramEnabled = prefs?.telegram.enabled ?? false;
  const telegramChatId = prefs?.telegram.chatId ?? '';

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Channels</h2>
        <p className={styles.sectionDesc}>
          Where your agents reach you. The same content goes through every enabled channel — pick whichever fits your day.
        </p>
      </div>

      {error && (
        <p style={{ color: '#c44', fontSize: '0.8rem', marginBottom: 12 }}>{error}</p>
      )}

      <div className={styles.card}>
        {/* Email Channel */}
        <div className={`${styles.row} ${styles.rowChannel}`}>
          <div className={styles.rowLabel}>
            <div className={styles.rowName}>Email</div>
            <div className={styles.rowHint}>{emailAddress || 'Not configured'}</div>
          </div>
          <div className={`${styles.rowControl} ${styles.rowControlToggle}`}>
            <button
              type="button"
              className={`${styles.toggle} ${emailEnabled ? styles.toggleOn : ''}`}
              onClick={() => update({ email: { enabled: !emailEnabled, address: emailAddress } })}
              disabled={saving}
              aria-pressed={emailEnabled}
            >
              <span className={styles.toggleKnob} />
            </button>
          </div>
        </div>

        {/* Telegram Channel */}
        <div className={`${styles.row} ${styles.rowChannel}`}>
          <div className={styles.rowLabel}>
            <div className={styles.rowName}>
              Telegram
              {telegramConnected && (
                <span className={`${styles.pill} ${styles.pillOk}`}>Connected</span>
              )}
            </div>
            <div className={styles.rowHint}>
              {telegramConnected
                ? `@Artifigenz_bot · ID ${telegramChatId}`
                : 'Not connected'}
            </div>
          </div>
          <div className={`${styles.rowControl} ${styles.rowControlToggle}`}>
            {telegramConnected ? (
              <>
                <button
                  className={styles.btnLink}
                  onClick={() => setTelegramExpanded(!telegramExpanded)}
                >
                  {telegramExpanded ? 'Hide' : 'Reconnect'}
                </button>
                <button
                  type="button"
                  className={`${styles.toggle} ${telegramEnabled ? styles.toggleOn : ''}`}
                  onClick={() => update({ telegram: { enabled: !telegramEnabled } })}
                  disabled={saving}
                  aria-pressed={telegramEnabled}
                >
                  <span className={styles.toggleKnob} />
                </button>
              </>
            ) : (
              <button
                className={styles.btnGhost}
                onClick={handleConnectTelegram}
                disabled={connectingTelegram || saving}
              >
                {connectingTelegram ? 'Connecting...' : 'Connect'}
              </button>
            )}
          </div>

          {/* Telegram Setup Instructions */}
          {(telegramExpanded || (connectingTelegram && telegramLinkPending)) && (
            <div className={styles.expand}>
              <ol className={styles.steps}>
                <li>Open Telegram, search <code>@Artifigenz_bot</code>, tap Start.</li>
                <li>Search <code>@userinfobot</code> — it replies with your ID.</li>
                <li>Paste your ID below.</li>
                <li>
                  <div className={styles.inputRow} style={{ marginTop: 8 }}>
                    <input
                      className={styles.input}
                      defaultValue={telegramChatId}
                      placeholder="Your Telegram ID"
                      style={{ maxWidth: 180 }}
                    />
                    <button className={styles.btnGhost}>Verify</button>
                  </div>
                </li>
              </ol>
              {telegramConnected && (
                <button
                  className={styles.btnLink}
                  onClick={handleDisconnectTelegram}
                  disabled={saving}
                  style={{ marginTop: 12, color: '#c44' }}
                >
                  Disconnect Telegram
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Quiet Hours */}
      <div className={styles.card} style={{ marginTop: 16 }}>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <div className={styles.rowName}>Quiet hours</div>
            <div className={styles.rowHint}>
              No reminders in this window. Critical alerts (security) ignore quiet hours.
            </div>
          </div>
          <div className={styles.rowControl}>
            <div className={styles.inlineDisplay}>
              <span className={styles.inlineValue}>{quietStart} — {quietEnd}</span>
              <button className={styles.btnLink}>Change</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
