import styles from './ArtifigenzMark.module.css';

/**
 * Artifigenz character mark — pixel-true port of the design's
 * "Artifigenz Face Variant.html". Black capsule, white face strokes,
 * five states (the design's cycle):
 *
 *   idle      — three slanted brand strokes (the logo). Body breathes.
 *   thinking  — face appears: eyes glance + blink, neutral mouth,
 *               capsule hops.
 *   working   — focused face: eyes still + occasional blink, progress
 *               bar sweeps left↔right under them, capsule hops.
 *   success   — eyes hide, a big checkmark appears, capsule jumps once.
 *   error     — eyes slant -24° + drop, mouth becomes a frown, capsule
 *               sinks once.
 *
 * Sized by `height` in px (capsule is height × 0.64). Cap/ink bind to
 * --text / --bg so the mark inverts in light vs dark mode.
 */

export type ArtifigenzState =
  | 'idle'
  | 'thinking'
  | 'working'
  | 'success'
  | 'error';

interface ArtifigenzMarkProps {
  height?: number;
  state?: ArtifigenzState;
  className?: string;
}

export default function ArtifigenzMark({
  height = 40,
  state = 'idle',
  className,
}: ArtifigenzMarkProps) {
  return (
    <span
      className={`${styles.mark} ${styles[state]}${className ? ` ${className}` : ''}`}
      style={{ ['--h' as string]: `${height}px` }}
      aria-hidden="true"
    >
      <span className={styles.body}>
        <span className={styles.capsule} />
        <span className={styles.markStrokes}>
          <span className={`${styles.ln} ${styles.l1}`} />
          <span className={`${styles.ln} ${styles.l2}`} />
          <span className={`${styles.ln} ${styles.l3}`} />
        </span>
        <svg
          className={styles.face}
          viewBox="0 0 64 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <g className={styles.eyes}>
            <line className={styles.eye} x1="20" y1="41" x2="27" y2="41" />
            <line className={styles.eye} x1="37" y1="41" x2="44" y2="41" />
          </g>
          <path
            className={`${styles.mouth} ${styles.mNeutral}`}
            d="M27 61 H37"
          />
          <path
            className={`${styles.mouth} ${styles.mFrown}`}
            d="M25 65 Q32 56 39 65"
          />
          <path className={styles.tick} d="M20 51 L29 61 L45 40" />
          <line
            className={styles.progTrack}
            x1="22"
            y1="67"
            x2="42"
            y2="67"
          />
          <line
            className={styles.progFill}
            x1="24"
            y1="67"
            x2="40"
            y2="67"
          />
        </svg>
      </span>
    </span>
  );
}
