'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from '@/components/ThemeProvider';
import styles from './MobileMenu.module.css';

interface MobileMenuProps {
  hasActivations?: boolean;
}

export default function MobileMenu({ hasActivations = false }: MobileMenuProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const isHome = pathname === '/';
  const isExplore = pathname === '/explore';
  const isSettings = pathname === '/settings';

  return (
    <>
      <button
        className={styles.hamburger}
        onClick={() => setOpen(true)}
        aria-label="Open menu"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {open && (
        <>
          <div className={styles.overlay} onClick={() => setOpen(false)} />
          <div className={styles.drawer}>
            <div className={styles.drawerHeader}>
              <div className={styles.profile}>
                <span className={styles.avatar}>C</span>
                <div>
                  <span className={styles.name}>Cooper</span>
                  <span className={styles.email}>cooper@artifigenz.com</span>
                </div>
              </div>
              <button
                className={styles.close}
                onClick={() => setOpen(false)}
                aria-label="Close menu"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <nav className={styles.nav}>
              {hasActivations && (
                <>
                  <Link
                    href="/"
                    className={`${styles.navLink} ${isHome ? styles.navLinkActive : ''}`}
                    onClick={() => setOpen(false)}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                      <polyline points="9 22 9 12 15 12 15 22" />
                    </svg>
                    Home
                  </Link>
                  <Link
                    href="/explore"
                    className={`${styles.navLink} ${isExplore ? styles.navLinkActive : ''}`}
                    onClick={() => setOpen(false)}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
                    </svg>
                    Explore
                  </Link>

                  <div className={styles.divider} />
                </>
              )}

              <Link href="#" className={styles.navLink} onClick={() => setOpen(false)}>
                Plan
              </Link>
              <Link
                href="/settings"
                className={`${styles.navLink} ${isSettings ? styles.navLinkActive : ''}`}
                onClick={() => setOpen(false)}
              >
                Settings
              </Link>
              <Link href="#" className={styles.navLink} onClick={() => setOpen(false)}>
                Sign out
              </Link>
            </nav>

            <div className={styles.footer}>
              <div className={styles.modeToggle}>
                {(['system', 'light', 'dark'] as const).map((m) => (
                  <button
                    key={m}
                    className={`${styles.modeBtn} ${theme === m ? styles.modeBtnActive : ''}`}
                    onClick={() => setTheme(m)}
                    aria-label={m === 'system' ? 'Auto' : m}
                  >
                    {m === 'system' && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                        <line x1="8" y1="21" x2="16" y2="21" />
                        <line x1="12" y1="17" x2="12" y2="21" />
                      </svg>
                    )}
                    {m === 'light' && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                    {m === 'dark' && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
