'use client';

import Image from 'next/image';
import Link from 'next/link';
import styles from './AuthLayout.module.css';

export default function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <Link href="/" className={styles.brand}>
          <Image
            src="/logo_transparent.png"
            alt="Artifigenz"
            width={28}
            height={28}
            priority
          />
          <span className={styles.brandText}>Artifigenz</span>
        </Link>
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        {children}
        {footer && <p className={styles.footer}>{footer}</p>}
      </div>
    </div>
  );
}

export { styles as authStyles };
