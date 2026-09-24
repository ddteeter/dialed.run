import { redirect } from "@tanstack/react-router";

/**
 * The one decision `/` makes about onboarding, where a test can reach it.
 *
 * A route file imports a module's `functions.ts` and so cannot be imported
 * by any test — which makes a `beforeLoad` the one place in this codebase
 * a decision cannot be checked. Same shape as `feed/redirect.ts` and
 * `auth/require-session.ts`, and the same reason: `@tanstack/react-router`
 * resolves inside the vitest workers pool while `@tanstack/react-start`
 * does not, so keeping the branch out of the file that calls
 * `createServerFn` is what makes it testable at all.
 */
/**
 * P2.5 with nothing to name is absent (round 22, item 25): *"the section
 * is absent, not a line saying so."* A closet with no generic piece — or
 * none at all — goes straight on to P3, rather than showing a counter at
 * "0 of 0 named" over an empty list.
 *
 * Takes the offer and hands it back, so the loader reads as one line and
 * a test can reach both outcomes.
 */
export function skipNamingIfNothingToName<Offer extends { items: readonly unknown[] }>(
  offer: Offer,
): Offer {
  if (offer.items.length === 0) {
    redirect({ to: "/onboarding/done", replace: true, throw: true });
  }
  return offer;
}

export function startOnboardingIfNeeded(isUnfinished: boolean): void {
  if (isUnfinished) {
    // `throw: true` is TanStack's own throwing form; a bare `throw
    // redirect(...)` trips `only-throw-error`, because what it returns is a
    // Redirect rather than an Error.
    redirect({ to: "/onboarding/calibrate", throw: true });
  }
}
