import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { startOnboardingIfNeeded } from "../../src/modules/onboarding/route-decisions";

/**
 * The decision `/` makes, tested where a route's own `loader` could not be
 * (D-52). A route file cannot be imported by any test, which is why this
 * lives next door rather than inside `routes/index.tsx`.
 */
describe("startOnboardingIfNeeded", () => {
  it("sends an unfinished runner to O1", () => {
    let thrown: unknown;
    try {
      startOnboardingIfNeeded(true);
    } catch (error: unknown) {
      thrown = error;
    }

    // A `Redirect`, not an `Error` — which is the whole reason this uses
    // TanStack's `throw: true` form rather than a bare `throw redirect(…)`.
    expect(isRedirect(thrown)).toBe(true);
    expect(thrown).toMatchObject({
      options: { to: "/onboarding/calibrate" },
    });
  });

  it("lets everyone else through", () => {
    // Both the signed-out visitor and the runner who has finished. `/` is
    // the only page a logged-out reader can see, so redirecting them would
    // be a loop dressed as a feature — and the decision of which they are
    // is made in `needsOnboarding`, not here.
    expect(() => {
      startOnboardingIfNeeded(false);
    }).not.toThrow();
  });
});
