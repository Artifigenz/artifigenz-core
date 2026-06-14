import styles from './ArtifigenzMark.module.css';

/**
 * Artifigenz character mark — supports idle, thinking, working, and
 * success states from the design handoff (Artifigenz Character.html).
 *
 *   idle      — flat short / long / short slanted strokes (the logo).
 *   thinking  — strokes straighten and shimmer (pre-token + tool runs).
 *   working   — strokes stream left→right repeatedly (text streaming).
 *   success   — strokes vanish and a green check draws in + capsule pops.
 *
 * Sized by `height` in px. Width follows the design's 0.64 aspect.
 * Capsule + strokes bind to --text / --bg so the mark stays high-
 * contrast in both light and dark mode without per-theme overrides.
 */

export type ArtifigenzState = 'idle' | 'thinking' | 'working' | 'success';

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
      <span className={styles.capsule} />
      <span className={styles.face}>
        <span className={styles.line} />
        <span className={styles.line} />
        <span className={styles.line} />
        <svg
          className={styles.check}
          viewBox="-50 -50 100 100"
          aria-hidden="true"
        >
          <path d="M -26 2 L -8 22 L 28 -22" />
        </svg>
      </span>
    </span>
  );
}
