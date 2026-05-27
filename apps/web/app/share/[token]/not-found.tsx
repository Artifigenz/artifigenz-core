import Link from 'next/link';
import styles from './page.module.css';

export default function ShareNotFound() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          Artifigenz
        </Link>
        <Link href="/sign-up" className={styles.ctaSmall}>
          Try Artifigenz →
        </Link>
      </header>
      <article className={styles.article} style={{ textAlign: 'center', paddingTop: 120 }}>
        <h1 className={styles.title}>This share isn&apos;t available</h1>
        <p className={styles.byline}>
          The link is invalid, expired, or the owner revoked access.
        </p>
        <div className={styles.footer} style={{ borderTop: 'none', marginTop: 32, paddingTop: 0 }}>
          <Link href="/sign-up" className={styles.cta}>
            Start your own conversation
          </Link>
        </div>
      </article>
    </main>
  );
}
