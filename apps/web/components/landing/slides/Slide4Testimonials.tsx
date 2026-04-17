'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Slide, { type SlideProps } from './Slide';
import sharedStyles from './Slide.module.css';
import styles from './Slide4Testimonials.module.css';

interface Testimonial {
  quote: string;
  name: string;
  role: string;
  company: string;
}

const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      'My Finance consultant found $340/mo in subscriptions I forgot I was paying. I don\u2019t look at statements anymore — I just approve what it flags.',
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
      'I used to spend Sunday evenings doing admin. My consultants do it overnight. Sunday is for my kids now.',
    name: 'Aisha Patel',
    role: 'Head of Ops',
    company: 'Notion',
  },
  {
    quote:
      'Research consultant delivers a competitive report every Monday. My board calls me prepared. I\u2019m not — the consultant is.',
    name: 'David Kim',
    role: 'CEO',
    company: 'Formwork',
  },
];

const ROTATE_MS = 3500;

export default function Slide4Testimonials(props: SlideProps) {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (!props.isActive) return;
    const interval = setInterval(() => {
      setCurrent((c) => (c + 1) % TESTIMONIALS.length);
    }, ROTATE_MS);
    return () => clearInterval(interval);
  }, [props.isActive]);

  return (
    <Slide {...props} className={styles.slide4}>
      <div className={`${sharedStyles.inner} ${styles.inner}`}>
        <p className={sharedStyles.eyebrow}>
          <span className={sharedStyles.eyebrowDot} />
          What people say
        </p>
        <h2 className={sharedStyles.title}>Less management.<br />More results.</h2>

        <div className={styles.stage}>
          {TESTIMONIALS.map((t, i) => {
            const isActive = i === current;
            const isPrev = i === (current - 1 + TESTIMONIALS.length) % TESTIMONIALS.length;
            const isNext = i === (current + 1) % TESTIMONIALS.length;

            let stateClass = styles.cardHidden;
            if (isActive) stateClass = styles.cardActive;
            else if (isPrev) stateClass = styles.cardPrev;
            else if (isNext) stateClass = styles.cardNext;

            return (
              <figure key={i} className={`${styles.card} ${stateClass}`}>
                <blockquote className={styles.quote}>&ldquo;{t.quote}&rdquo;</blockquote>
                <figcaption className={styles.attribution}>
                  <span className={styles.name}>{t.name}</span>
                  <span className={styles.role}>
                    {t.role} · {t.company}
                  </span>
                </figcaption>
              </figure>
            );
          })}
        </div>

        {/* Progress dots */}
        <div className={styles.dots}>
          {TESTIMONIALS.map((_, i) => (
            <span
              key={i}
              className={`${styles.dot} ${i === current ? styles.dotActive : ''}`}
            />
          ))}
        </div>

        <Link href="/sign-up" className={`${sharedStyles.cta} ${styles.cta}`}>
          Get started
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
            <path d="M12 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
    </Slide>
  );
}
