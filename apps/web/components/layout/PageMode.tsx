'use client';

import { useEffect } from 'react';

export type PageModeValue = 'ambient' | 'subtle' | 'quiet';

/**
 * Sets the body's ambient-background intensity for the page that renders it.
 *
 *   ambient (default everywhere)  — full Aura gradient + mouse-follow glow.
 *                                    Use on the home, explore, marketing.
 *   subtle                         — gradient at ~30% opacity, glow off.
 *                                    Use on data/accounts/onboarding pages.
 *   quiet                          — no gradient, flat var(--bg).
 *                                    Use on chat, loading, reading-heavy
 *                                    surfaces.
 *
 * Drop one of these at the top of any page that should deviate from
 * ambient. Returns to ambient on unmount, so client-side navigation
 * doesn't leak a quieter mode into a louder page.
 */
export function PageMode({ mode }: { mode: PageModeValue }) {
  useEffect(() => {
    const previous = document.body.dataset.mode;
    document.body.dataset.mode = mode;
    return () => {
      if (previous !== undefined) {
        document.body.dataset.mode = previous;
      } else {
        delete document.body.dataset.mode;
      }
    };
  }, [mode]);

  return null;
}
