'use client';

import { useEffect, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { useActivatedAgents } from '@/hooks/useActivatedAgents';
import { buildHeroGreeting } from '@/lib/greeting';
import styles from './Hero.module.css';

export default function Hero() {
  const { isLoaded, user } = useUser();
  const { activations, hydrated } = useActivatedAgents();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !hydrated || !isLoaded) return null;

  const userName =
    user?.firstName ||
    user?.username ||
    user?.emailAddresses[0]?.emailAddress?.split('@')[0] ||
    'there';
  const line = buildHeroGreeting(activations, userName);

  return (
    <section className={styles.hero}>
      <h1 className={styles.title}>{line}</h1>
    </section>
  );
}
