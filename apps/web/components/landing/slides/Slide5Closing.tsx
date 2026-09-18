'use client';

import ComingSoonBadge from '../ComingSoonBadge';
import Slide, { type SlideProps } from './Slide';
import sharedStyles from './Slide.module.css';
import styles from './Slide5Closing.module.css';

export default function Slide5Closing(props: SlideProps) {
  return (
    <Slide {...props} className={styles.slide5}>
      <div className={`${sharedStyles.inner} ${styles.inner}`}>
        <p className={sharedStyles.eyebrow}>
          <span className={sharedStyles.eyebrowDot} />
          Always on
        </p>
        <h2 className={`${sharedStyles.title} ${styles.title}`}>
          Minutes to set up.<br />
          Then nothing.
        </h2>
        <p className={`${sharedStyles.subtitle} ${styles.subtitle}`}>
          Your consultants run 24/7 — analyzing, watching, drafting proposals — while you
          live your life. The only thing left for you is to approve.
        </p>

        {/* Decorative pulse rings */}
        <div className={styles.pulseWrap} aria-hidden="true">
          <div className={styles.pulseRing} />
          <div className={styles.pulseRing} />
          <div className={styles.pulseRing} />
          <div className={styles.pulseCore}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
          </div>
        </div>

        <ComingSoonBadge />
      </div>
    </Slide>
  );
}
