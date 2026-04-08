'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'artifigenz_activated_agents';

export function agentSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}

export interface ActivationContext {
  slug: string;
  activatedAt: number;
  accounts: string[];
  goals: string[];
  skills: Record<string, boolean>;
}

function readStorage(): ActivationContext[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): ActivationContext | null => {
        // Legacy format: plain slug strings
        if (typeof item === 'string') {
          return {
            slug: item,
            activatedAt: 0,
            accounts: [],
            goals: [],
            skills: {},
          };
        }
        if (
          item &&
          typeof item.slug === 'string' &&
          typeof item.activatedAt === 'number' &&
          Array.isArray(item.accounts) &&
          Array.isArray(item.goals) &&
          item.skills &&
          typeof item.skills === 'object'
        ) {
          return {
            slug: item.slug,
            activatedAt: item.activatedAt,
            accounts: item.accounts.filter((a: unknown): a is string => typeof a === 'string'),
            goals: item.goals.filter((g: unknown): g is string => typeof g === 'string'),
            skills: item.skills as Record<string, boolean>,
          };
        }
        return null;
      })
      .filter((x): x is ActivationContext => x !== null);
  } catch {
    return [];
  }
}

function writeStorage(activations: ActivationContext[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(activations));
  } catch {}
}

export function useActivatedAgents() {
  const [activations, setActivations] = useState<ActivationContext[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setActivations(readStorage());
    setHydrated(true);
  }, []);

  const activate = useCallback((context: ActivationContext) => {
    setActivations((prev) => {
      const filtered = prev.filter((a) => a.slug !== context.slug);
      const next = [...filtered, context];
      writeStorage(next);
      return next;
    });
  }, []);

  const deactivate = useCallback((slug: string) => {
    setActivations((prev) => {
      const next = prev.filter((a) => a.slug !== slug);
      writeStorage(next);
      return next;
    });
  }, []);

  const isActivated = useCallback(
    (slug: string) => activations.some((a) => a.slug === slug),
    [activations]
  );

  const getActivation = useCallback(
    (slug: string) => activations.find((a) => a.slug === slug) ?? null,
    [activations]
  );

  const slugs = activations.map((a) => a.slug);

  return {
    activations,
    slugs,
    activate,
    deactivate,
    isActivated,
    getActivation,
    hydrated,
  };
}
