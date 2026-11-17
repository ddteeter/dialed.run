import { useLocation } from "@tanstack/react-router";

import { useIsHydrated } from "../../ui/use-is-hydrated";
import { savedPageSchema } from "./route-decisions";

/**
 * The page a refused save left, by name, for the terms prompt's D-102
 * line (SA-L13, design 230): what `ui/terms-refusal`'s navigation put in
 * history state, which a link cannot set. Parsed through
 * `savedPageSchema`, so only a heading's worth of words.
 *
 * Nothing until hydration: the server render has no history state, and a
 * reload of the prompt keeps it in the browser, so the first client
 * render must draw what the server drew.
 */
export function useSavedPage(): string | undefined {
  const fromState = useLocation({
    select: (location) => location.state.savedPage,
  });
  const isHydrated = useIsHydrated();
  return isHydrated ? savedPageSchema.parse(fromState) : undefined;
}
