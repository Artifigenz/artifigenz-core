import styles from './ArtifigenzMark.module.css';

/**
 * Artifigenz character mark — the new brand logo (static idle state).
 * Ported from the design handoff's `Artifigenz Character.html`: a
 * rounded-pill capsule with three slanted face lines (short / long /
 * short, -25° slant, airy spacing).
 *
 * Sized by `height` in px. Width follows the design's 0.64 ratio.
 * Capsule + face use theme tokens (`--text` / `--bg`) so the mark
 * always contrasts strongly with the page in both light and dark mode.
 */
interface ArtifigenzMarkProps {
  height?: number;
  className?: string;
}

export default function ArtifigenzMark({
  height = 28,
  className,
}: ArtifigenzMarkProps) {
  return (
    <span
      className={`${styles.mark}${className ? ` ${className}` : ''}`}
      style={{ ['--h' as string]: `${height}px` }}
      aria-hidden="true"
    >
      <span className={styles.capsule} />
      <span className={styles.face}>
        <span className={styles.line} />
        <span className={styles.line} />
        <span className={styles.line} />
      </span>
    </span>
  );
}
