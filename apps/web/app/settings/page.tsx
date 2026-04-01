'use client';

import Header from '@/components/layout/Header';
import { useTheme } from '@/components/ThemeProvider';
import styles from './page.module.css';

const THEMES = [
  { id: 'terminal' as const, name: 'Terminal', description: 'Monospace. Black and white. Raw.' },
  { id: 'aura' as const, name: 'Aura', description: 'Gradients. Glass. Warm and luminous.' },
];

export default function SettingsPage() {
  const { theme, setTheme, visualTheme, setVisualTheme } = useTheme();

  return (
    <div className={styles.page}>
      <Header />
      <main className={styles.main}>
        <h1 className={styles.title}>Settings</h1>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Profile</h2>
          <div className={styles.field}>
            <label className={styles.label}>Name</label>
            <input className={styles.input} defaultValue="Cooper" readOnly />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Email</label>
            <input className={styles.input} defaultValue="suba@artifigenz.com" readOnly />
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Appearance</h2>
          <div className={styles.field}>
            <label className={styles.label}>Mode</label>
            <div className={styles.modeRow}>
              {(['system', 'light', 'dark'] as const).map((m) => (
                <button
                  key={m}
                  className={`${styles.modeBtn} ${theme === m ? styles.modeBtnActive : ''}`}
                  onClick={() => setTheme(m)}
                >
                  {m === 'system' ? 'Auto' : m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Theme</label>
            <div className={styles.themeGrid}>
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  className={`${styles.themeCard} ${visualTheme === t.id ? styles.themeCardActive : ''}`}
                  onClick={() => setVisualTheme(t.id)}
                >
                  <span className={styles.themeName}>{t.name}</span>
                  <span className={styles.themeDesc}>{t.description}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Notifications</h2>
          <div className={styles.field}>
            <label className={styles.label}>Agent insights</label>
            <span className={styles.fieldHint}>Coming soon</span>
          </div>
        </section>
      </main>
    </div>
  );
}
