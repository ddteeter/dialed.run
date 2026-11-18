import { useLocation } from "@tanstack/react-router";
import { useState } from "react";

import { wasHydrated } from "../../ui/use-hydrated";
import { savedPageSchema } from "./route-decisions";

/**
 * The page a refused save left, by name, for the terms prompt's D-102
 * line (SA-L13, design 230): what `ui/terms-refusal`'s navigation put in
 * history state, which a link cannot set. Parsed through
 * `savedPageSchema`, so only a heading's worth of words.
 *
 * **In the first render or never** (R60·60b): read when the prompt is
 * reached by a client navigation, whose first render already has the
 * state. A server-rendered load leaves it out for good, rather than adding
 * it once the page has loaded: the server has no history state, a reload
 * keeps it in the browser, and the line arriving late would move the page.
 */
export function useSavedPage(): string | undefined {
  const fromState = useLocation({
    select: (location) => location.state.savedPage,
  });
  const [isClientNavigation] = useState(wasHydrated);
  return isClientNavigation ? savedPageSchema.parse(fromState) : undefined;
}
