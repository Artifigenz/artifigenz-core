import Link from 'next/link';
import styles from './LandingHero.module.css';

interface Notification {
  agent: string;
  icon: string;
  title: string;
  detail: string;
  time: string;
}

const NOTIFICATIONS: Notification[] = [
  {
    agent: 'Finance',
    icon: '$',
    title: 'Netflix increased by 48%',
    detail: '$15.49/mo → $22.99/mo. Adds $90/year.',
    time: 'now',
  },
  {
    agent: 'Travel',
    icon: '✈',
    title: 'Tokyo flights dropped 34%',
    detail: 'Round-trip from JFK now $287. Lowest in 90 days.',
    time: '8m',
  },
  {
    agent: 'Health',
    icon: '♡',
    title: 'Sleep dropped below 6h',
    detail: 'Three nights this week. 14-day average: 5.2h.',
    time: '2h',
  },
];

export default function LandingHero() {
  return (
    <section className={styles.hero}>
      <div className={styles.text}>
        <p className={styles.eyebrow}>
          <span className={styles.eyebrowDot} />
          AI consultants, not AI tools
        </p>
        <h1 className={styles.title}>
          They work while you<br />
          live your life.
        </h1>
        <p className={styles.subtitle}>
          A team of AI consultants that monitor your world, find opportunities
          you&apos;d miss, and bring you proposals. You just approve.
        </p>
        <div className={styles.ctaRow}>
          <Link href="/sign-up" className={styles.ctaPrimary}>
            Get started
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
              <path d="M12 5l7 7-7 7" />
            </svg>
          </Link>
          <Link href="/sign-in" className={styles.ctaSecondary}>
            Already have an account?
          </Link>
        </div>
      </div>

      {/* Phone mockup placeholder — swap for designed asset later */}
      <div className={styles.phoneWrap} aria-hidden="true">
        <div className={styles.phone}>
          <div className={styles.phoneNotch} />
          <div className={styles.phoneScreen}>
            <div className={styles.lockTime}>7:47</div>
            <div className={styles.lockDate}>Thursday, April 8</div>

            <div className={styles.notificationStack}>
              {NOTIFICATIONS.map((n) => (
                <div key={n.agent} className={styles.notification}>
                  <div className={styles.notificationIcon}>{n.icon}</div>
                  <div className={styles.notificationBody}>
                    <div className={styles.notificationMeta}>
                      <span className={styles.notificationAgent}>{n.agent} Consultant</span>
                      <span className={styles.notificationTime}>{n.time}</span>
                    </div>
                    <p className={styles.notificationTitle}>{n.title}</p>
                    <p className={styles.notificationDetail}>{n.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
