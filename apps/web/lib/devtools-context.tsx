'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * DevTools — the toggle that gates agent surfaces in the chat-only-public
 * launch. When `agentMode` is off, /agents, /finance, /agent/*, and the
 * agent grid on the home page are all hidden so the public chat product
 * looks chat-only. When on, everything reappears.
 *
 * State is persisted to localStorage so flipping it stays sticky across
 * page reloads on the same device. Future: swap the persistence layer for
 * a server-side `users.isInternal` flag without touching the component
 * APIs that consume `useDevtools()`.
 */

interface DevtoolsState {
  agentMode: boolean;
  setAgentMode: (value: boolean) => void;
  // True until the localStorage read has run on the client. Lets callers
  // avoid a "flash of agent UI" on the first SSR → client paint by
  // rendering nothing (or the off-state) while we don't know yet.
  hydrated: boolean;
}

const STORAGE_KEY = 'artifigenz.devtools.agentMode';

const DevtoolsContext = createContext<DevtoolsState | null>(null);

export function DevtoolsProvider({ children }: { children: ReactNode }) {
  const [agentMode, setAgentModeState] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      // Reading localStorage in a useEffect and reflecting it into state
      // is the canonical hydration-safe pattern for client-only
      // persistence — server renders with the default, then we sync to
      // the real value once mounted. The cascading-render lint warning
      // doesn't apply here because it fires once on mount, not on every
      // render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored === '1') setAgentModeState(true);
    } catch {
      // localStorage may be unavailable (privacy mode, etc.) — that's fine,
      // we just default to off.
    }
    setHydrated(true);
  }, []);

  const setAgentMode = useCallback((value: boolean) => {
    setAgentModeState(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
    } catch {
      // swallow — UI state still updates in-memory
    }
  }, []);

  const value = useMemo<DevtoolsState>(
    () => ({ agentMode, setAgentMode, hydrated }),
    [agentMode, setAgentMode, hydrated],
  );

  return (
    <DevtoolsContext.Provider value={value}>
      {children}
    </DevtoolsContext.Provider>
  );
}

export function useDevtools(): DevtoolsState {
  const ctx = useContext(DevtoolsContext);
  if (!ctx) {
    // Falling back instead of throwing keeps the chat product safe if a
    // component is ever rendered outside the provider — agents stay
    // hidden by default, which is the conservative behavior.
    return { agentMode: false, setAgentMode: () => {}, hydrated: true };
  }
  return ctx;
}
