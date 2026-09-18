import InsightStack from './InsightStack';
import styles from './HowItWorks.module.css';

function Arrow() {
  return (
    <div className={styles.connector} aria-hidden="true">
      <svg width="72" height="12" viewBox="0 0 72 12" fill="none">
        <path
          d="M2 6 L62 6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="3 5"
          strokeLinecap="round"
        />
        <path
          d="M58 2 L66 6 L58 10"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </div>
  );
}

export default function HowItWorks() {
  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>How it works</p>
        <h2 className={styles.title}>From signup to insights in three steps.</h2>
        <p className={styles.subtitle}>
          No prompts to write. No workflows to build. Activate a consultant, give it
          access to what matters, and it handles the rest — every morning, every week,
          forever.
        </p>
      </div>

      <div className={styles.flow}>
        {/* ─── Stage 1: Activate ─── */}
        <div className={styles.stage}>
          <span className={styles.stageNumber}>01</span>
          <div className={styles.stageVisual}>
            <div className={styles.agentsCluster}>
              <div className={`${styles.agentOrb} ${styles.agentOrbActive}`} style={{ '--orb-delay': '0s' } as React.CSSProperties}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z"/>
                </svg>
              </div>
              <div className={styles.agentOrb} style={{ '--orb-delay': '0.05s' } as React.CSSProperties}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
                </svg>
              </div>
              <div className={`${styles.agentOrb} ${styles.agentOrbActive}`} style={{ '--orb-delay': '0.1s' } as React.CSSProperties}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
              </div>
              <div className={styles.agentOrb} style={{ '--orb-delay': '0.15s' } as React.CSSProperties}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6h-2c0-2.76-2.24-5-5-5S7 3.24 7 6H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-7-3c1.66 0 3 1.34 3 3H9c0-1.66 1.34-3 3-3zm0 10c-2.76 0-5-2.24-5-5h2c0 1.66 1.34 3 3 3s3-1.34 3-3h2c0 2.76-2.24 5-5 5z"/>
                </svg>
              </div>
            </div>
          </div>
          <h3 className={styles.stageHeading}>Activate your consultants</h3>
          <p className={styles.stageCopy}>
            Pick specialists for the parts of your life you want handled. Each one is
            pre-trained — no prompts, no setup, no configuration.
          </p>
        </div>

        <Arrow />

        {/* ─── Stage 2: Connect ─── */}
        <div className={styles.stage}>
          <span className={styles.stageNumber}>02</span>
          <div className={styles.stageVisual}>
            <div className={styles.sourcesStack}>
              <div className={`${styles.sourceCard} ${styles.sourceCardBank}`}>
                <div className={styles.sourceStripe} />
                <div className={styles.sourceRow}>
                  <span className={styles.sourceChip} />
                  <span className={styles.sourceDots}>•••• 4821</span>
                </div>
              </div>
              <div className={`${styles.sourceCard} ${styles.sourceCardCalendar}`}>
                <div className={styles.sourceCalendarHeader}>APR</div>
                <div className={styles.sourceCalendarDay}>08</div>
              </div>
              <div className={`${styles.sourceCard} ${styles.sourceCardHealth}`}>
                <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
              </div>
            </div>
          </div>
          <h3 className={styles.stageHeading}>Connect the sources</h3>
          <p className={styles.stageCopy}>
            Read-only access to whatever they need — accounts, calendar, health, inbox.
            Your consultants only see what their job requires.
          </p>
        </div>

        <Arrow />

        {/* ─── Stage 3: Wake up to answers ─── */}
        <div className={styles.stage}>
          <span className={styles.stageNumber}>03</span>
          <div className={styles.stageVisual}>
            <InsightStack />
          </div>
          <h3 className={styles.stageHeading}>Wake up to answers</h3>
          <p className={styles.stageCopy}>
            Overnight they assess, analyze, and prepare proposals. Every morning, a
            short list of things worth your attention — in-app, email, or Telegram.
          </p>
        </div>
      </div>
    </section>
  );
}
