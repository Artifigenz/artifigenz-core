import styles from './page.module.css';

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <img src="/logo_transparent.png" alt="Artifigenz" width={36} height={36} className={styles.logo} />
        <h1 className={styles.title}>Something new is coming.</h1>
        <p className={styles.sub}>AI consultants that work for you. Assign a task, they deliver.</p>
        <a href="https://x.com/FigenzAI" target="_blank" rel="noopener noreferrer" className={styles.cta}>
          Follow for updates →
        </a>
      </main>
    </div>
  );
}
