'use client';

import { useTheme } from '@/components/ThemeProvider';
import styles from '../page.module.css';

const MODES = ['Auto', 'Light', 'Dark'] as const;

const THEMES = [
  {
    id: 'terminal' as const,
    name: 'Terminal',
    description: 'Monospace. Square corners. Black-and-white.',
    swatches: ['#ffffff', '#000000', '#999999'],
    mono: true,
  },
  {
    id: 'aura' as const,
    name: 'Aura',
    description: 'Inter. Soft gradients. Glass surfaces.',
    swatches: ['#fff0eb', '#eef6ff', '#f4eeff'],
    mono: false,
  },
];

export function AppearanceSection() {
  const { theme, setTheme, visualTheme, setVisualTheme } = useTheme();

  const modeValue = theme === 'system' ? 'Auto' : theme === 'light' ? 'Light' : 'Dark';

  function handleModeChange(mode: string) {
    if (mode === 'Auto') setTheme('system');
    else if (mode === 'Light') setTheme('light');
    else setTheme('dark');
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Look & feel</h2>
        <p className={styles.sectionDesc}>
          Pair a mode with a theme. Updates apply across every Artifigenz product.
        </p>
      </div>

      <div className={styles.card}>
        {/* Mode */}
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <div className={styles.rowName}>Mode</div>
            <div className={styles.rowHint}>Auto follows your system.</div>
          </div>
          <div className={styles.rowControl}>
            <div className={styles.segmented}>
              {MODES.map((mode) => (
                <button
                  key={mode}
                  className={`${styles.seg} ${modeValue === mode ? styles.segActive : ''}`}
                  onClick={() => handleModeChange(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Theme */}
        <div className={`${styles.row} ${styles.rowStack}`}>
          <div className={styles.rowLabel}>
            <div className={styles.rowName}>Theme</div>
            <div className={styles.rowHint} style={{ maxWidth: '100%' }}>
              The shape and texture of every surface.
            </div>
          </div>
          <div className={styles.rowControl}>
            <div className={styles.themeGrid}>
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  className={`${styles.themeCard} ${visualTheme === t.id ? styles.themeCardActive : ''}`}
                  onClick={() => setVisualTheme(t.id)}
                >
                  <div className={`${styles.themePreview} ${t.mono ? styles.themePreviewMono : ''}`}>
                    <div className={styles.themeMock}>
                      <div className={styles.themeLine} style={{ width: '50%' }} />
                      <div className={`${styles.themeLine} ${styles.themeLineDim}`} style={{ width: '85%' }} />
                      <div className={`${styles.themeLine} ${styles.themeLineDim}`} style={{ width: '70%' }} />
                      <div className={`${styles.themeLine} ${styles.themeLineDim}`} style={{ width: '40%' }} />
                    </div>
                    <div className={styles.themeSwatches}>
                      {t.swatches.map((color, i) => (
                        <span
                          key={i}
                          className={styles.themeSw}
                          style={{ background: color }}
                        />
                      ))}
                    </div>
                  </div>
                  <div className={styles.themeMeta}>
                    <div className={styles.themeName}>{t.name}</div>
                    <div className={styles.themeDesc}>{t.description}</div>
                  </div>
                  {visualTheme === t.id && (
                    <span className={styles.themeCheck}>✓</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
