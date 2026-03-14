import Image from 'next/image';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import styles from './Header.module.css';

export default function Header() {
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
      <ThemeToggle />
    </header>
  );
}
