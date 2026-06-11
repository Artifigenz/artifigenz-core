'use client';

import { useEffect, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import styles from './HavenIntro.module.css';

/**
 * Haven intro — the centered greeting + suggestions that fill the home
 * page until the user starts a conversation. Adapted from the
 * "Haven Home.html" design handed off by Claude Design: vertically
 * centered stage, time-aware greeting, three suggestion rows, all
 * wrapped in an ambient Aura field.
 *
 * The composer + send logic stays in the existing ChatInput component
 * directly below; HavenIntro is purely the above-the-composer surface.
 */

const SUGGESTIONS = [
  'Help me brainstorm a name for my new project',
  'Summarize the long article I paste here',
  'Draft a thoughtful reply to this email',
];

function greetingPart(): 'morning' | 'afternoon' | 'evening' {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

export interface HavenIntroProps {
  /**
   * Called when the user clicks a suggestion row. Receives the prompt
   * text; parent decides how to dispatch (typically the same path as
   * a typed-and-sent message).
   */
  onSuggestion: (text: string) => void;
}

export default function HavenIntro({ onSuggestion }: HavenIntroProps) {
  const { isLoaded, user } = useUser();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Render nothing until we know the user's name — avoids a flash of
  // "Good morning, there." followed by the real name a tick later.
  if (!mounted || !isLoaded) return null;

  const firstName =
    user?.firstName ||
    user?.username ||
    user?.emailAddresses[0]?.emailAddress?.split('@')[0] ||
    'there';

  return (
    <section className={styles.stage}>
      <h1 className={`${styles.greeting} ${styles.enter}`}>
        Good {greetingPart()}, {firstName}.
      </h1>
      <p className={`${styles.greetingSub} ${styles.enter}`}>
        What should we look at?
      </p>
      <div
        className={`${styles.suggestions} ${styles.enter2}`}
        aria-label="Suggestions"
      >
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className={styles.suggestion}
            onClick={() => onSuggestion(s)}
          >
            <span>{s}</span>
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12,5 19,12 12,19" />
            </svg>
          </button>
        ))}
      </div>
    </section>
  );
}
