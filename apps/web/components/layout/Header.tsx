'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ProfileMenu from '@/components/layout/ProfileMenu';
import MobileMenu from '@/components/layout/MobileMenu';
import styles from './Header.module.css';

export default function Header() {
  const pathname = usePathname();
  const isHome = pathname === '/';
  const isExplore = pathname === '/explore';

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
      <nav className={styles.nav}>
        <Link href="/" className={`${styles.navLink} ${isHome ? styles.navLinkActive : ''}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          Home
        </Link>
        <Link href="/explore" className={`${styles.navLink} ${isExplore ? styles.navLinkActive : ''}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
          </svg>
          Explore
        </Link>
      </nav>
      <div className={styles.actions}>
        <ProfileMenu />
      </div>
      <div className={styles.mobileActions}>
        <MobileMenu />
      </div>
    </header>
  );
}
