import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { useSlowRoute } from "./tabs";

/**
 * X3 for an in-screen link: *"For in-screen links (a post → D) the
 * brackets go on the tapped element's label."*
 *
 * The bar knows which of its seats to breathe — the lit one — but a link
 * on the screen is one of many, so it has to remember it was the one
 * pressed. `onClick` marks it; `isWaiting` is true once that navigation
 * has run past `SLOW_ROUTE_MS`, the same threshold the bar's label keeps,
 * and the mark goes when the load settles.
 *
 * Only the label breathes. The one announcement stays Layout's
 * `SlowRouteStatus` ("Loading Closet." once), so a screen reader is not
 * told twice.
 */
export function useTappedSlow(): {
  isWaiting: boolean;
  onClick: () => void;
} {
  const isLoading = useRouterState({ select: (state) => state.isLoading });
  const { isSlow } = useSlowRoute();
  const [isTapped, setIsTapped] = useState(false);

  useEffect(() => {
    // Settled: whatever was pressed has arrived, or been left behind.
    if (!isLoading) setIsTapped(false);
  }, [isLoading]);

  return {
    isWaiting: isTapped && isSlow,
    onClick: () => {
      setIsTapped(true);
    },
  };
}
