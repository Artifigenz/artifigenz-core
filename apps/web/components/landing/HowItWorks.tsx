import styles from './HowItWorks.module.css';

interface Step {
  number: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}

const STEPS: Step[] = [
  {
    number: '01',
    title: 'Connect',
    description:
      'Link the accounts and sources you care about. Bank, calendar, health, inbox — read-only, never stored in plaintext.',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    ),
  },
  {
    number: '02',
    title: 'Activate',
    description:
      'Pick the consultants that fit your life. Each one specialises in one domain and gets to work immediately.',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  },
  {
    number: '03',
    title: 'Receive',
    description:
      'Insights and proposals arrive where you already are — in-app, email, Telegram. You review, approve, move on.',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
  },
];

export default function HowItWorks() {
  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>How it works</p>
        <h2 className={styles.title}>Three steps. No management.</h2>
        <p className={styles.subtitle}>
          Artifigenz isn&apos;t another assistant waiting for instructions. It&apos;s a
          team that assesses your situation and comes back with specific things worth doing.
        </p>
      </div>

      <div className={styles.grid}>
        {STEPS.map((step) => (
          <div key={step.number} className={styles.card}>
            <div className={styles.cardTop}>
              <span className={styles.cardNumber}>{step.number}</span>
              <span className={styles.cardIcon}>{step.icon}</span>
            </div>
            <h3 className={styles.cardTitle}>{step.title}</h3>
            <p className={styles.cardDescription}>{step.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
