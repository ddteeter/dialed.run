import { useEffect, useState } from "react";

/**
 * Whether this render is the browser's, after hydration: `false` on the
 * server and on the first client render, so the two agree, and `true`
 * from the effect on. Closet C draws its script-only controls (WORKS AT's
 * bar, the phone's one-open chip row) behind it, and the controls that
 * work without script until then (round 46 #109h).
 *
 * No dependency array, as `ui/use-hydrated.ts` explains: setting the same
 * `true` again is free, and there is then no array for a mutant to swap.
 */
export function useIsHydrated(): boolean {
  const [isHydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  });
  return isHydrated;
}
