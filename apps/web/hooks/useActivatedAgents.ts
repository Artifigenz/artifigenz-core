'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useApiClient } from '@/hooks/useApiClient';

export function agentSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}

export interface ActivationContext {
  slug: string;
  activatedAt: number;
  agentInstanceId?: string;
  accounts: string[];
  goals: string[];
  skills: Record<string, boolean>;
}

interface BackendAgent {
  id: string;
  agentTypeId: string;
  status: string;
  goal: string | null;
  lastAnalyzedAt: string | null;
}

export function useActivatedAgents() {
  const [activations, setActivations] = useState<ActivationContext[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const { isSignedIn, isLoaded } = useAuth();
  const api = useApiClient();

  // Fetch activated agents from backend on mount
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setActivations([]);
      setHydrated(true);
      return;
    }

    let cancelled = false;
    api
      .getMyAgents()
      .then((agents: BackendAgent[]) => {
        if (cancelled) return;
        setActivations(
          agents
            .filter((a) => a.status === 'active')
            .map((a) => ({
              slug: a.agentTypeId,
              activatedAt: Date.now(),
              agentInstanceId: a.id,
              accounts: [],
              goals: a.goal ? a.goal.split('; ') : [],
              skills: {},
            })),
        );
        setHydrated(true);
      })
      .catch(() => {
        if (!cancelled) setHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, api]);

  const activate = useCallback(
    async (context: ActivationContext & { status?: 'active' | 'onboarding' }) => {
      const goal = context.goals.length > 0 ? context.goals.join('; ') : undefined;
      const status = context.status ?? 'active';
      try {
        const result = await api.activateAgent(context.slug, goal, status);
        // Only add to the displayed list if status is 'active'
        if (status === 'active') {
          setActivations((prev) => {
            const filtered = prev.filter((a) => a.slug !== context.slug);
            return [
              ...filtered,
              { ...context, agentInstanceId: result.agentInstance.id },
            ];
          });
        }
        return result.agentInstance.id;
      } catch (err) {
        // If already activated (409), try to get the existing instance ID
        try {
          const agents = await api.getMyAgents();
          const existing = agents.find((a: { agentTypeId: string }) => a.agentTypeId === context.slug);
          if (existing && status === 'active') {
            setActivations((prev) => {
              if (prev.some((a) => a.slug === context.slug)) return prev;
              return [...prev, { ...context, agentInstanceId: existing.id }];
            });
          }
          return existing?.id ?? null;
        } catch {
          return null;
        }
      }
    },
    [api],
  );

  /** Flip an onboarding instance to active (call at the end of the wizard) */
  const finalizeActivation = useCallback(
    async (slug: string, agentInstanceId: string, context: ActivationContext) => {
      try {
        await api.updateAgentInstance(agentInstanceId, { status: 'active' });
        setActivations((prev) => {
          const filtered = prev.filter((a) => a.slug !== slug);
          return [...filtered, { ...context, agentInstanceId }];
        });
      } catch {
        // Might already be active — add to local state anyway
        setActivations((prev) => {
          if (prev.some((a) => a.slug === slug)) return prev;
          return [...prev, { ...context, agentInstanceId }];
        });
      }
    },
    [api],
  );

  const deactivate = useCallback(
    (slug: string) => {
      setActivations((prev) => prev.filter((a) => a.slug !== slug));
      // Backend deactivation would go here if needed
    },
    [],
  );

  const isActivated = useCallback(
    (slug: string) => activations.some((a) => a.slug === slug),
    [activations],
  );

  const getActivation = useCallback(
    (slug: string) => activations.find((a) => a.slug === slug) ?? null,
    [activations],
  );

  const slugs = activations.map((a) => a.slug);

  return {
    activations,
    slugs,
    activate,
    finalizeActivation,
    deactivate,
    isActivated,
    getActivation,
    hydrated,
  };
}
