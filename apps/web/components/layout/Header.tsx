'use client';

import Image from 'next/image';
import Link from 'next/link';
import ProfileMenu from '@/components/layout/ProfileMenu';
import MobileMenu from '@/components/layout/MobileMenu';
import { useDevtools } from '@/lib/devtools-context';
import styles from './Header.module.css';

interface HeaderProps {
  /**
   * If provided, intercepts the logo click instead of navigating. Useful on
   * the home page itself, where clicking the logo should reset the chat
   * back to the intro state rather than no-op-navigate to /app.
   */
  onLogoClick?: () => void;
}

export default function Header({ onLogoClick }: HeaderProps = {}) {
  const { agentMode } = useDevtools();
  return (
    <header className={styles.header}>
      <Link
        href="/app"
        className={styles.logoMark}
        onClick={(e) => {
          if (onLogoClick) {
            e.preventDefault();
            onLogoClick();
          }
        }}
      >
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
      <div aria-hidden="true" />
      <div className={styles.actions}>
        {agentMode && (
          <Link href="/agents" className={styles.navLink}>
            Agents
          </Link>
        )}
        <ProfileMenu />
      </div>
      <div className={styles.mobileActions}>
        <MobileMenu />
      </div>
    </header>
  );
}
