'use client';

import Link from 'next/link';
import Slide, { type SlideProps } from './Slide';
import sharedStyles from './Slide.module.css';
import styles from './Slide2HowItWorks.module.css';

function Arrow() {
  return (
    <div className={styles.connector} aria-hidden="true">
      <svg width="84" height="12" viewBox="0 0 84 12" fill="none">
        <path
          d="M2 6 L74 6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="3 5"
          strokeLinecap="round"
        />
        <path
          d="M70 2 L78 6 L70 10"
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

export default function Slide2HowItWorks(props: SlideProps) {
  return (
    <Slide {...props} className={styles.slide2}>
      <div className={`${sharedStyles.inner} ${styles.inner}`}>
        <p className={sharedStyles.eyebrow}>
          <span className={sharedStyles.eyebrowDot} />
          How it works
        </p>
        <h2 className={`${sharedStyles.title} ${styles.title}`}>Three steps. That&rsquo;s it.</h2>
        <p className={sharedStyles.subtitle}>
          Activate. Connect. Then live your life — they handle the rest.
        </p>

        <div className={styles.flow}>
          {/* Stage 1 */}
          <div className={styles.stage}>
            <span className={styles.stageNumber}>01</span>
            <div className={styles.stageVisual}>
              <div className={styles.agentsCluster}>
                <div className={`${styles.agentOrb} ${styles.agentOrbActive}`} style={{ '--orb-delay': '0s' } as React.CSSProperties}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z"/>
                  </svg>
                </div>
                <div className={styles.agentOrb} style={{ '--orb-delay': '0.05s' } as React.CSSProperties}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
                  </svg>
                </div>
                <div className={`${styles.agentOrb} ${styles.agentOrbActive}`} style={{ '--orb-delay': '0.1s' } as React.CSSProperties}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                  </svg>
                </div>
                <div className={styles.agentOrb} style={{ '--orb-delay': '0.15s' } as React.CSSProperties}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6h-2c0-2.76-2.24-5-5-5S7 3.24 7 6H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-7-3c1.66 0 3 1.34 3 3H9c0-1.66 1.34-3 3-3z"/>
                  </svg>
                </div>
              </div>
            </div>
            <h3 className={styles.stageHeading}>Activate consultants</h3>
            <p className={styles.stageCopy}>Pick the specialists you need. Pre-trained, no setup.</p>
          </div>

          <Arrow />

          {/* Stage 2 */}
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
                  <div className={styles.sourceCalendarDay}>09</div>
                </div>
                <div className={`${styles.sourceCard} ${styles.sourceCardHealth}`}>
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                  </svg>
                </div>
              </div>
            </div>
            <h3 className={styles.stageHeading}>Connect the sources</h3>
            <p className={styles.stageCopy}>Read-only access to whatever they need. They only see what their job requires.</p>
          </div>

          <Arrow />

          {/* Stage 3 */}
          <div className={styles.stage}>
            <span className={styles.stageNumber}>03</span>
            <div className={styles.stageVisual}>
              <div className={styles.notificationPreview}>
                <div className={styles.previewIcon}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1zm1 17v-1.07c1.855-.3 3-1.47 3-2.93 0-3-5-2-5-4 0-.58.5-1 1.5-1 1.036 0 1.643.404 1.853.924l1.895-.63C14.93 8.423 13.863 7.5 13 7.26V6h-2v1.2c-1.98.393-3 1.66-3 2.8 0 2.96 5 2 5 4 0 .69-.59 1-1.5 1-1.036 0-1.759-.469-2.06-1.02l-1.89.73c.5 1.26 1.74 2.06 3.45 2.28V18h2z"/>
                  </svg>
                </div>
                <div className={styles.previewBody}>
                  <div className={styles.previewMeta}>Finance · now</div>
                  <div className={styles.previewTitle}>Netflix +48%</div>
                  <div className={styles.previewDetail}>$15.49 → $22.99/mo</div>
                </div>
              </div>
            </div>
            <h3 className={styles.stageHeading}>Wake up to answers</h3>
            <p className={styles.stageCopy}>Overnight they assess. Every morning a short list lands in your inbox.</p>
          </div>
        </div>

        <Link href="/sign-up" className={`${sharedStyles.cta} ${styles.cta}`}>
          Get started
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
            <path d="M12 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
    </Slide>
  );
}
