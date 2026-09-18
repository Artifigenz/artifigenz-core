import ComingSoonBadge from './ComingSoonBadge';
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
          Your team of consultants is waiting.
        </p>
        <ComingSoonBadge />
      </div>
    </section>
  );
}
