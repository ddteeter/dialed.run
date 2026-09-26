import { describe, expect, it, vi } from "vitest";

import {
  cityLookupInput,
  lookUpCity,
} from "../../src/modules/onboarding/place";
import type { PlaceResolver } from "../../src/modules/onboarding/place";

/**
 * O1's typed city, resolved once on confirm (owner, 2026-09-24). Three
 * answers, because the form does three different things with them — and a
 * provider failure is reported, never swallowed (laws 6 and 7).
 */
function lookUp(resolver: PlaceResolver | undefined) {
  const report = vi.fn();
  return {
    report,
    answer: lookUpCity({
      label: "Minneapolis",
      resolver,
      report,
      userId: "u-1",
    }),
  };
}

describe("lookUpCity", () => {
  it("answers found, with the coordinates, for a place the provider knows", async () => {
    const resolver = vi.fn<PlaceResolver>(() =>
      Promise.resolve({ lat: 44.98, lng: -93.27 }),
    );
    const { answer, report } = lookUp(resolver);

    expect(await answer).toStrictEqual({
      kind: "found",
      lat: 44.98,
      lng: -93.27,
    });
    expect(resolver).toHaveBeenCalledWith("Minneapolis");
    expect(report).not.toHaveBeenCalled();
  });

  it("answers not-found when the provider has no such place", async () => {
    const { answer, report } = lookUp(() => Promise.resolve(undefined));
    expect(await answer).toStrictEqual({ kind: "not-found" });
    expect(report).not.toHaveBeenCalled();
  });

  it("reports a provider failure with context to act on, and answers unavailable", async () => {
    const down = new Error("visual crossing 503");
    const { answer, report } = lookUp(() => Promise.reject(down));

    expect(await answer).toStrictEqual({ kind: "unavailable" });
    expect(report).toHaveBeenCalledTimes(1);
    // Never the label: it is the runner's own words about where they live.
    expect(report).toHaveBeenCalledWith(down, {
      surface: "onboarding.lookUpCity",
      userId: "u-1",
    });
  });

  it("answers unavailable, and reports nothing, before a resolver is wired", async () => {
    const { answer, report } = lookUp(undefined);
    expect(await answer).toStrictEqual({ kind: "unavailable" });
    expect(report).not.toHaveBeenCalled();
  });
});

describe("cityLookupInput", () => {
  it("takes a trimmed, bounded label and refuses a blank one", () => {
    expect(cityLookupInput.parse({ label: "  Austin  " })).toStrictEqual({
      label: "Austin",
    });
    expect(cityLookupInput.safeParse({ label: " ".repeat(3) }).success).toBe(
      false,
    );
    expect(cityLookupInput.safeParse({ label: "a".repeat(121) }).success).toBe(
      false,
    );
    expect(cityLookupInput.safeParse({ label: "a".repeat(120) }).success).toBe(
      true,
    );
  });
});
