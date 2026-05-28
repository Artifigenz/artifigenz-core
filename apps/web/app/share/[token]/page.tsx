import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './page.module.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface SnapshotMessage {
  role: string;
  content: string;
  createdAt: string | null;
}

interface PublicShareView {
  shareToken: string;
  title: string | null;
  ownerName: string | null;
  messages: SnapshotMessage[];
  createdAt: string;
}

async function fetchShare(token: string): Promise<PublicShareView | null> {
  try {
    const res = await fetch(`${API_URL}/api/shares/${token}`, {
      // No revalidation — shares are snapshots; if the source is updated
      // or revoked, that becomes visible immediately via the next request.
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as PublicShareView;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const share = await fetchShare(token);
  const title = share?.title?.trim() || 'Shared conversation';
  return {
    title: `${title} · Artifigenz`,
    // Never index. Shared conversations are user-published links — not
    // search-engine fodder. Also stops social-share previews from caching
    // content the owner might revoke.
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const share = await fetchShare(token);
  if (!share) notFound();

  const title = share.title?.trim() || 'Shared conversation';
  const date = new Date(share.createdAt);
  const dateLabel = date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          Artifigenz
        </Link>
        <Link href="/sign-up" className={styles.ctaSmall}>
          Try Artifigenz →
        </Link>
      </header>

      <article className={styles.article}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.byline}>
          {share.ownerName ? (
            <>
              Shared by <strong>{share.ownerName}</strong> ·{' '}
            </>
          ) : (
            <>Shared · </>
          )}
          {dateLabel}
        </p>

        <div className={styles.thread}>
          {share.messages.map((m, i) => (
            <Message key={i} message={m} />
          ))}
        </div>

        <footer className={styles.footer}>
          <p className={styles.footerLine}>
            This conversation was created on Artifigenz — a chat that knows
            you and acts across your agents.
          </p>
          <Link href="/sign-up" className={styles.cta}>
            Start your own
          </Link>
        </footer>
      </article>
    </main>
  );
}

function Message({ message }: { message: SnapshotMessage }) {
  const isUser = message.role === 'user';
  return (
    <div
      className={`${styles.message} ${isUser ? styles.messageUser : styles.messageAssistant}`}
    >
      <div className={styles.messageLabel}>
        {isUser ? 'You' : 'Assistant'}
      </div>
      <div className={styles.messageBody}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {message.content || '(empty message)'}
        </ReactMarkdown>
      </div>
    </div>
  );
}
