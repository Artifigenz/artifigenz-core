import styles from './SocialProof.module.css';

interface Testimonial {
  quote: string;
  name: string;
  role: string;
  initial: string;
}

const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      'My Finance consultant found $340/mo in subscriptions I forgot I was paying. I literally don\u2019t look at my statements anymore — I just approve what it flags.',
    name: 'Priya Shah',
    role: 'Product Manager · Stripe',
    initial: 'P',
  },
  {
    quote:
      'The Travel consultant caught a Tokyo fare drop at 6am and booked my dates before I was even awake. I\u2019d been refreshing that route for weeks.',
    name: 'Marcus Chen',
    role: 'Founder · Northwind',
    initial: 'M',
  },
  {
    quote:
      'I\u2019ve tried every AI assistant. This is the first one that does work before I ask. It\u2019s the difference between a tool and a team.',
    name: 'Sofia Alvarez',
    role: 'Head of Design · Linear',
    initial: 'S',
  },
  {
    quote:
      'Health consultant flagged a sleep pattern I\u2019d been ignoring for months. Small thing, huge difference. This product actually pays attention.',
    name: 'James O\u2019Connor',
    role: 'Engineering Lead · Vercel',
    initial: 'J',
  },
];

export default function SocialProof() {
  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>What people say</p>
        <h2 className={styles.title}>Less management. More results.</h2>
      </div>

      <div className={styles.grid}>
        {TESTIMONIALS.map((t) => (
          <figure key={t.name} className={styles.card}>
            <blockquote className={styles.quote}>&ldquo;{t.quote}&rdquo;</blockquote>
            <figcaption className={styles.attribution}>
              <span className={styles.avatar}>{t.initial}</span>
              <div className={styles.author}>
                <span className={styles.name}>{t.name}</span>
                <span className={styles.role}>{t.role}</span>
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
