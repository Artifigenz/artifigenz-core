'use client';

import { useEffect, useState } from 'react';
import styles from './InsightStack.module.css';

interface Insight {
  agent: string;
  title: string;
  detail: string;
}

const INSIGHTS: Insight[] = [
  { agent: 'Finance', title: 'Spotify charges tomorrow', detail: '$10.99 · auto-renew' },
  { agent: 'Finance', title: 'Netflix increased by 48%', detail: '$15.49 → $22.99/mo' },
  { agent: 'Travel', title: 'Tokyo fares dropped 34%', detail: '$287 round-trip · 90-day low' },
  { agent: 'Health', title: 'Sleep averaging 5.2 hours', detail: '3 nights below your baseline' },
  { agent: 'Research', title: 'Competitive report ready', detail: '5 players analyzed · 2 gaps found' },
  { agent: 'Job Search', title: 'Senior PM role at Anthropic', detail: '95% match to your profile' },
  { agent: 'Shopping', title: 'Headphones dropped 22%', detail: '$298 · below your target price' },
  { agent: 'Pulse', title: 'This week in AI agents', detail: '3 launches · 1 worth your time' },
  { agent: 'Events', title: 'Venue availability update', detail: '2 of your shortlist opened up' },
  { agent: 'Learning', title: 'Course match found', detail: 'React Server Components · 2 hrs' },
];

export default function InsightStack() {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrent((prev) => (prev + 1) % INSIGHTS.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className={styles.stack}>
      {INSIGHTS.map((insight, i) => {
        const isActive = i === current;
        const isNext = i === (current + 1) % INSIGHTS.length;
        const isPrev = i === (current - 1 + INSIGHTS.length) % INSIGHTS.length;

        let stateClass = styles.hidden;
        if (isActive) stateClass = styles.active;
        else if (isNext) stateClass = styles.next;
        else if (isPrev) stateClass = styles.prev;

        return (
          <div key={i} className={`${styles.card} ${stateClass}`}>
            <div className={styles.meta}>{insight.agent} · now</div>
            <div className={styles.title}>{insight.title}</div>
            <div className={styles.detail}>{insight.detail}</div>
          </div>
        );
      })}
    </div>
  );
}
