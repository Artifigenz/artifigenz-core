import Link from 'next/link';
import styles from './LandingFooter.module.css';

export default function LandingFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <p className={styles.company}>
          &copy; {new Date().getFullYear()} Artifigenz AI Labs, LLC.
        </p>
        <nav className={styles.links}>
          <Link href="/privacy" className={styles.link}>
            Privacy Statement
          </Link>
          <Link href="/terms" className={styles.link}>
            Terms of Use
          </Link>
        </nav>
      </div>
    </footer>
  );
}
