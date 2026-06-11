'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUser, useClerk } from '@clerk/nextjs';
import { useTheme } from '@/components/ThemeProvider';
import styles from './HavenTopBar.module.css';

/**
 * Haven top bar — replaces the standard <Header /> on the chat home so
 * we can match the design handoff: triangle logo + wordmark on the
 * left, kbd-hint ⌘K history link + theme toggle + avatar on the right.
 *
 * The avatar opens a small popover with Settings + Sign out so we
 * don't lose any of the affordances ProfileMenu used to provide.
 */

interface HavenTopBarProps {
  onHistory?: () => void;
}

export default function HavenTopBar({ onHistory }: HavenTopBarProps) {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const { theme, setTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  const isDark = theme === 'dark';

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(`.${styles.avatarWrap}`)) setMenuOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen]);

  const initial =
    user?.firstName?.[0]?.toUpperCase() ||
    user?.username?.[0]?.toUpperCase() ||
    user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() ||
    'A';

  return (
    <header className={styles.bar}>
      <Link href="/" className={styles.brand} aria-label="Artifigenz home">
        <Logo size={24} />
        <span className={styles.wordmark}>ARTIFIGENZ</span>
      </Link>

      <div className={styles.right}>
        {onHistory && (
          <button
            type="button"
            className={styles.kbdHint}
            onClick={onHistory}
            title="Open conversation history (⌘K)"
          >
            <kbd className={styles.kbd}>⌘K</kbd>
            <span>history</span>
          </button>
        )}

        <button
          type="button"
          className={styles.modeToggle}
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
          title={isDark ? 'Switch to light' : 'Switch to dark'}
          aria-label="Toggle color mode"
        >
          {isDark ? <SunIcon /> : <MoonIcon />}
        </button>

        <div className={styles.avatarWrap}>
          <button
            type="button"
            className={styles.avatar}
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Account"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <span>{isLoaded ? initial : ''}</span>
          </button>
          {menuOpen && (
            <div className={styles.menu} role="menu">
              <Link
                href="/settings"
                className={styles.menuItem}
                role="menuitem"
                onClick={() => setMenuOpen(false)}
              >
                Settings
              </Link>
              <button
                type="button"
                className={styles.menuItem}
                role="menuitem"
                onClick={() => signOut()}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function Logo({ size }: { size: number }) {
  // Recursive spiral triangle matching the Haven design.
  const cx = 12;
  const cy = 13.2;
  const tris: string[] = [];
  for (let i = 0; i < 7; i++) {
    const sc = 11 * Math.pow(0.86, i);
    const rot = i * 4.2;
    const pts = [0, 1, 2]
      .map((k) => {
        const a = ((-90 + k * 120 + rot) * Math.PI) / 180;
        return `${(cx + sc * Math.cos(a)).toFixed(2)},${(cy + sc * Math.sin(a)).toFixed(2)}`;
      })
      .join(' ');
    tris.push(`<polygon points="${pts}" />`);
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 26"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: tris.join('') }}
    />
  );
}

function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
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
  );
}
