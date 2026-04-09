import Link from 'next/link';
import styles from './FinalCta.module.css';

export default function FinalCta() {
  return (
    <section className={styles.section}>
      <div className={styles.inner}>
        <h2 className={styles.title}>
          Stop managing AI.<br />
          Start approving it.
        </h2>
        <p className={styles.subtitle}>
          Your team of consultants is waiting. Connect in 30 seconds.
        </p>
        <Link href="/sign-up" className={styles.cta}>
          Get started
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
            <path d="M12 5l7 7-7 7" />
          </svg>
        </Link>
        <p className={styles.footnote}>Free to start · No credit card</p>
      </div>
    </section>
  );
}
