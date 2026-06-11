'use client';

import { useEffect, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import styles from './HavenIntro.module.css';

/**
 * Haven intro pieces — split so the parent can place the greeting
 * above the composer and the suggestions below it (matches the
 * design handoff: greeting → sub → composer → suggestions, all in
 * one vertically-centered group).
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

export function HavenGreeting() {
  const { isLoaded, user } = useUser();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !isLoaded) {
    return (
      <div className={styles.greetingBlock}>
        <h1 className={styles.greeting}>&nbsp;</h1>
        <p className={styles.greetingSub}>&nbsp;</p>
      </div>
    );
  }

  const firstName =
    user?.firstName ||
    user?.username ||
    user?.emailAddresses[0]?.emailAddress?.split('@')[0] ||
    'there';

  return (
    <div className={styles.greetingBlock}>
      <h1 className={`${styles.greeting} ${styles.enter}`}>
        Good {greetingPart()}, {firstName}.
      </h1>
      <p className={`${styles.greetingSub} ${styles.enter}`}>
        What should we look at?
      </p>
    </div>
  );
}

export function HavenSuggestions({
  onPick,
}: {
  onPick: (text: string) => void;
}) {
  return (
    <div className={`${styles.suggestions} ${styles.enter3}`} aria-label="Suggestions">
      {SUGGESTIONS.map((s) => (
        <button
          key={s}
          type="button"
          className={styles.suggestion}
          onClick={() => onPick(s)}
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
  );
}

// Back-compat default export — both pieces stacked. Used where the
// composer doesn't sit between them.
export default function HavenIntro({
  onSuggestion,
}: {
  onSuggestion: (text: string) => void;
}) {
  return (
    <>
      <HavenGreeting />
      <HavenSuggestions onPick={onSuggestion} />
    </>
  );
}
