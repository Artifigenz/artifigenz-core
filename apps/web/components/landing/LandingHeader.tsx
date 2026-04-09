'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useTheme } from '@/components/ThemeProvider';
import styles from './LandingHeader.module.css';

type Mode = 'system' | 'light' | 'dark';

const MODES: Mode[] = ['system', 'light', 'dark'];

export default function LandingHeader() {
  const { theme, setTheme } = useTheme();

  return (
    <header className={styles.header}>
      <Link href="/" className={styles.logoMark}>
        <Image
          className={styles.logoIcon}
          src="/logo_transparent.png"
          alt="Artifigenz"
          width={30}
          height={30}
          priority
        />
        <span className={styles.logoText}>Artifigenz</span>
      </Link>

      <div className={styles.actions}>
        <div className={styles.themeToggle} role="group" aria-label="Color mode">
          {MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              className={`${styles.themeBtn} ${theme === mode ? styles.themeBtnActive : ''}`}
              aria-label={mode === 'system' ? 'Auto' : mode}
              aria-pressed={theme === mode}
              onClick={() => setTheme(mode)}
            >
              {mode === 'system' && (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              )}
              {mode === 'light' && (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              )}
              {mode === 'dark' && (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
          ))}
        </div>

        <Link href="/sign-in" className={styles.signIn}>
          Sign in
        </Link>

        <Link href="/sign-up" className={styles.getStarted}>
          Get started
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
            <path d="M12 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
    </header>
  );
}
