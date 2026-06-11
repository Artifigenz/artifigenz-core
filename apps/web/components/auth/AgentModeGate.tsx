'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useDevtools } from '@/lib/devtools-context';

/**
 * Client-side gate around any route that should only be reachable in
 * agent mode. While the DevTools state is still hydrating we render
 * nothing (no flash of agent UI for chat-only users); once hydrated, if
 * agent mode is off we redirect to /app, otherwise we render children.
 *
 * Why client-side and not Next middleware: the toggle lives in
 * localStorage. The server has no way to know the user's state at
 * request time without a roundtrip. Doing this client-side is the
 * simplest reliable approach until we move the flag server-side.
 */
export function AgentModeGate({ children }: { children: ReactNode }) {
  const { agentMode, hydrated } = useDevtools();
  const router = useRouter();

  useEffect(() => {
    if (hydrated && !agentMode) {
      router.replace('/app');
    }
  }, [hydrated, agentMode, router]);

  if (!hydrated || !agentMode) return null;
  return <>{children}</>;
}
