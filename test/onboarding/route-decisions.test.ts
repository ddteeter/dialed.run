import { isNotFound, isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import {
  settingsSectionOrNotFound,
  skipNamingIfNothingToName,
  startOnboardingIfNeeded,
} from "../../src/modules/onboarding/route-decisions";

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

describe("skipNamingIfNothingToName (round 22, item 25)", () => {
  it("goes straight on to P3 when there is nothing to name", () => {
    let thrown: unknown;
    try {
      skipNamingIfNothingToName({ items: [], totalCount: 4 });
    } catch (error: unknown) {
      thrown = error;
    }

    // "The section is absent, not a line saying so" — and replaced, so
    // Back from P3 does not land on a screen that only bounces forward.
    expect(isRedirect(thrown)).toBe(true);
    expect(thrown).toMatchObject({
      options: { to: "/onboarding/done", replace: true },
    });
  });

  it("hands the offer back when there is something to name", () => {
    const offer = { items: [{ itemId: "i-1" }], totalCount: 1 };
    expect(skipNamingIfNothingToName(offer)).toBe(offer);
  });
});

describe("settingsSectionOrNotFound (round 22, item 20)", () => {
  it("names the two sub-pages there are", () => {
    expect(settingsSectionOrNotFound("units")).toBe("units");
    expect(settingsSectionOrNotFound("sharing")).toBe("sharing");
  });

  it("is the router's not-found for any other path", () => {
    let thrown: unknown;
    try {
      settingsSectionOrNotFound("delete-everything");
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isNotFound(thrown)).toBe(true);
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toHaveProperty(
      "message",
      'No settings page called "delete-everything".',
    );
  });
});
