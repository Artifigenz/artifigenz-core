import styles from './Footer.module.css';

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <p className={styles.copy}>&copy; {new Date().getFullYear()} Artifigenz</p>
      <nav className={styles.links}>
        <a href="#" className={styles.link}>About</a>
        <a href="#" className={styles.link}>Contact</a>
        <a href="#" className={styles.link}>Help</a>
      </nav>
    </footer>
  );
}
