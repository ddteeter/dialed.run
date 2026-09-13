import { useEffect } from "react";

/**
 * Stamps `html[data-hydrated="true"]` once React has attached.
 *
 * **Controlled inputs are only safe to drive once hydration has run** — by
 * a person or by Playwright — because hydration resets component state and
 * a fill that lands before it is silently discarded. Every e2e spec waits
 * on this attribute instead of racing that.
 *
 * **It lives here rather than in `Layout` because not every screen wears
 * one.** Onboarding is a flow rather than a tab: O1, O3 and P3 render
 * `Page` with no `Layout`, since a tab bar there offers four ways out of a
 * two-minute path. That left the app's only hydration signal missing from
 * the three screens that are *entirely* controlled forms — found by the
 * onboarding demo timing out on it, which is the gap working as intended.
 *
 * **No dependency array, deliberately.** With `[]` this is an effect that
 * runs once, and stryker's replacement — a constant one-element array — is
 * exactly as stable, so the mutant is unkillable and needed a suppression.
 * Without the array the effect re-runs on every render and writes the same
 * string to the same property, which costs nothing and cannot be wrong. A
 * mutant that cannot exist beats a mutant that has to be explained.
 */
export function useHydrated(): void {
  useEffect(() => {
    document.documentElement.dataset.hydrated = "true";
  });
}
