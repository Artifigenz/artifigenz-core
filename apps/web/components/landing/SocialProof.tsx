import styles from './SocialProof.module.css';

interface Testimonial {
  quote: string;
  name: string;
  role: string;
  company: string;
}

const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      'My Finance consultant found $340/mo in subscriptions I forgot I was paying. I don\u2019t look at statements anymore \u2014 I just approve what it flags.',
    name: 'Priya Shah',
    role: 'Product Manager',
    company: 'Stripe',
  },
  {
    quote:
      'Caught a Tokyo fare drop at 6am and booked my dates before I was even awake. I\u2019d been refreshing that route for weeks.',
    name: 'Marcus Chen',
    role: 'Founder',
    company: 'Northwind',
  },
  {
    quote:
      'The first AI that does work before I ask. This is the difference between a tool and a team.',
    name: 'Sofia Alvarez',
    role: 'Head of Design',
    company: 'Linear',
  },
  {
    quote:
      'Health consultant flagged a sleep pattern I\u2019d been ignoring for months. This product actually pays attention.',
    name: 'James O\u2019Connor',
    role: 'Engineering Lead',
    company: 'Vercel',
  },
  {
    quote:
      'I used to spend Sunday evenings doing admin. My consultants do it overnight. Sunday is for my kids now.',
    name: 'Aisha Patel',
    role: 'Head of Ops',
    company: 'Notion',
  },
  {
    quote:
      'Research consultant delivers a competitive report every Monday. My board calls me prepared. I\u2019m not \u2014 the consultant is.',
    name: 'David Kim',
    role: 'CEO',
    company: 'Formwork',
  },
];

export default function SocialProof() {
  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>What people say</p>
        <h2 className={styles.title}>Less management.<br />More results.</h2>
      </div>

      <div className={styles.scrollWrap}>
        <div className={styles.track}>
          {TESTIMONIALS.map((t) => (
            <figure key={t.name} className={styles.item}>
              <blockquote className={styles.quote}>&ldquo;{t.quote}&rdquo;</blockquote>
              <figcaption className={styles.attribution}>
                <span className={styles.name}>{t.name}</span>
                <span className={styles.role}>
                  {t.role} · {t.company}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>

      <div className={styles.hint}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14" />
          <path d="M12 5l7 7-7 7" />
        </svg>
        <span>Scroll for more</span>
      </div>
    </section>
  );
}
