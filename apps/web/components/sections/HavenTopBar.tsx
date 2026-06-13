'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
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
  onSettings?: () => void;
  /**
   * When provided AND the bar is in thread mode (title set), shows a
   * Share button that opens the share modal for the current conversation.
   */
  onShare?: () => void;
  /**
   * Click handler for the logo. When provided, the brand is rendered as
   * a button — useful on the home route where we want clicking the logo
   * to reset to a fresh chat instead of doing a no-op Link nav. Pages
   * without this just get the default Link → "/" behavior.
   */
  onLogoClick?: () => void;
  /**
   * When set, the bar enters thread mode: wordmark hides and this title
   * is shown centered (matches the Haven Thread design).
   */
  title?: string | null;
}

export default function HavenTopBar({
  onHistory,
  onSettings,
  onShare,
  onLogoClick,
  title,
}: HavenTopBarProps) {
  const { user, isLoaded } = useUser();
  const { theme, setTheme } = useTheme();
  const [titleVisible, setTitleVisible] = useState(true);

  const isDark = theme === 'dark';

  // Fade the conversation title out once the user starts scrolling so it
  // doesn't visibly overlap the chat content (the topbar is transparent
  // and fixed). Re-appears when scrolled back to the top.
  useEffect(() => {
    if (!title) return;
    const onScroll = () => setTitleVisible(window.scrollY < 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [title]);

  const initial =
    user?.firstName?.[0]?.toUpperCase() ||
    user?.username?.[0]?.toUpperCase() ||
    user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() ||
    'A';

  return (
    <header className={styles.bar}>
      {onLogoClick ? (
        <button
          type="button"
          onClick={onLogoClick}
          className={styles.brand}
          aria-label="Artifigenz home"
        >
          <Logo size={24} />
          {!title && <span className={styles.wordmark}>ARTIFIGENZ</span>}
        </button>
      ) : (
        <Link href="/" className={styles.brand} aria-label="Artifigenz home">
          <Logo size={24} />
          {!title && <span className={styles.wordmark}>ARTIFIGENZ</span>}
        </Link>
      )}

      {title && (
        <div
          className={`${styles.title} ${titleVisible ? '' : styles.titleHidden}`}
        >
          {title}
        </div>
      )}

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

        {onShare && title && (
          <button
            type="button"
            className={styles.modeToggle}
            onClick={onShare}
            title="Share this chat"
            aria-label="Share this chat"
          >
            <ShareIcon />
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

        {onSettings ? (
          <button
            type="button"
            className={styles.avatar}
            onClick={onSettings}
            aria-label="Open settings"
          >
            <span>{isLoaded ? initial : ''}</span>
          </button>
        ) : (
          <Link
            href="/?settings=1"
            className={styles.avatar}
            aria-label="Open settings"
          >
            <span>{isLoaded ? initial : ''}</span>
          </Link>
        )}
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

function ShareIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
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
