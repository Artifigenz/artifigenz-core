'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser, useClerk, useAuth } from '@clerk/nextjs';
import { useTheme } from '@/components/ThemeProvider';
import styles from './ProfileMenu.module.css';

export default function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { theme, setTheme } = useTheme();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const displayName = user?.firstName || user?.username || user?.emailAddresses[0]?.emailAddress?.split('@')[0] || 'Account';
  const initial = (displayName[0] ?? 'A').toUpperCase();
  const email = user?.emailAddresses[0]?.emailAddress ?? '';

  const handleSignOut = async () => {
    setOpen(false);
    await signOut();
    router.replace('/sign-in');
  };

  if (!authLoaded) {
    return <div className={styles.trigger} style={{ opacity: 0.4 }} />;
  }

  if (!isSignedIn) {
    return (
      <Link href="/sign-in" className={styles.signInBtn}>
        Sign in
      </Link>
    );
  }

  return (
    <>
      <div>
        <div className={styles.wrap} ref={menuRef}>
          <button
            className={styles.trigger}
            aria-label="Profile menu"
            onClick={() => setOpen(!open)}
          >
            <span className={styles.avatar}>
              <span className={styles.avatarInitial}>{initial}</span>
            </span>
            <span className={styles.triggerName}>{isLoaded ? displayName : ''}</span>
          </button>

          {open && (
            <div className={styles.menu}>
              <div className={styles.user}>
                <span className={styles.userName}>{displayName}</span>
                <span className={styles.userEmail}>{email}</span>
              </div>

              <div className={styles.divider} />

              <Link href="#" className={styles.menuLink} onClick={() => setOpen(false)}>
                Plan
              </Link>
              <Link href="/settings" className={styles.menuLink} onClick={() => setOpen(false)}>
                Settings
              </Link>

              <button className={styles.menuLink} onClick={handleSignOut} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer' }}>
                Sign out
              </button>

              <div className={styles.divider} />

              <div className={styles.modeToggle}>
                {(['system', 'light', 'dark'] as const).map((m) => (
                  <button
                    key={m}
                    className={`${styles.modeBtn} ${theme === m ? styles.modeBtnActive : ''}`}
                    onClick={() => setTheme(m)}
                    aria-label={m === 'system' ? 'Auto' : m}
                  >
                    {m === 'light' && (
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
                    {m === 'system' && (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                        <line x1="8" y1="21" x2="16" y2="21" />
                        <line x1="12" y1="17" x2="12" y2="21" />
                      </svg>
                    )}
                    {m === 'dark' && (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
