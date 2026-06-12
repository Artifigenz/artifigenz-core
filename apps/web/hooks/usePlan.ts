'use client';

import { useEffect, useState } from 'react';
import type { Plan } from '@artifigenz/shared';

const DEV_PLAN_KEY = 'artifigenz.devPlanOverride';

/**
 * Returns the user's current plan. Until billing exists, every real user is
 * on Basic. In development, a dev-tools toggle can override this so we can
 * exercise the Pro UX without paying. The override is stored in
 * localStorage and reset by clearing site data.
 *
 * The hook is intentionally SSR-safe: returns 'basic' before hydration so
 * the first paint matches the server.
 */
export function usePlan(): Plan {
  const [plan, setPlan] = useState<Plan>('basic');

  useEffect(() => {
    const read = () => {
      try {
        const stored = localStorage.getItem(DEV_PLAN_KEY);
        if (stored === 'pro' || stored === 'basic') {
          setPlan(stored);
        }
      } catch {
        // localStorage can throw in private browsing — fall through to basic.
      }
    };
    read();
    const handler = () => read();
    window.addEventListener('storage', handler);
    window.addEventListener('artifigenz:plan-changed', handler);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener('artifigenz:plan-changed', handler);
    };
  }, []);

  return plan;
}

/** Writes the dev plan override + fires the local change event so other
 *  components on the same page pick it up without waiting for the next
 *  cross-tab storage event. */
export function setDevPlanOverride(plan: Plan | null) {
  try {
    if (plan === null) {
      localStorage.removeItem(DEV_PLAN_KEY);
    } else {
      localStorage.setItem(DEV_PLAN_KEY, plan);
    }
    window.dispatchEvent(new Event('artifigenz:plan-changed'));
  } catch {
    // ignore
  }
}

export function readDevPlanOverride(): Plan | null {
  try {
    const stored = localStorage.getItem(DEV_PLAN_KEY);
    if (stored === 'basic' || stored === 'pro') return stored;
    return null;
  } catch {
    return null;
  }
}
