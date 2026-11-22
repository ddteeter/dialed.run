import { describe, expect, it, vi } from "vitest";

import {
  cityLookupInput,
  cityNotFound,
} from "../../src/lib/contracts/city-lookup";
import type { ResolvedPlace } from "../../src/lib/contracts";
import { lookUpCity } from "../../src/modules/onboarding/place";
import { WeatherBudgetSpentError } from "../../src/modules/weather/budget";
import type { PlaceResolver } from "../../src/modules/onboarding/place";

/**
 * Find (round 26 #12): a typed city resolved once, when the runner asks.
 * Three answers, because the field does three different things with them
 * — and a provider failure is reported, never swallowed (laws 6 and 7).
 */
function lookUp(resolver: PlaceResolver) {
  const report = vi.fn();
  const stamp = vi.fn<(place: ResolvedPlace) => Promise<string>>(() =>
    Promise.resolve("the-stamp"),
  );
  return {
    report,
    stamp,
    answer: lookUpCity({
      label: "Minneapolis",
      resolver,
      stamp,
      report,
      userId: "u-1",
    }),
  };
}

/**
A lookup refused because the runner's day's weather budget is spent.
*/
const spentBudget: PlaceResolver = () =>
  Promise.reject(new WeatherBudgetSpentError());

describe("lookUpCity", () => {
  it("answers found, with the provider's name for the place and where it is", async () => {
    const resolver = vi.fn<PlaceResolver>(() =>
      Promise.resolve({
        lat: 44.98,
        lng: -93.27,
        address: "Minneapolis, MN, United States",
      }),
    );
    const { answer, report, stamp } = lookUp(resolver);

    expect(await answer).toStrictEqual({
      kind: "found",
      address: "Minneapolis, MN, United States",
      lat: 44.98,
      lng: -93.27,
      stamp: "the-stamp",
    });
    expect(resolver).toHaveBeenCalledWith("Minneapolis");
    expect(stamp).toHaveBeenCalledWith({
      address: "Minneapolis, MN, United States",
      lat: 44.98,
      lng: -93.27,
    });
    expect(report).not.toHaveBeenCalled();
  });

  it("rounds the provider's coordinates as a profile's are, and stamps the rounded place", async () => {
    const { answer, stamp } = lookUp(() =>
      Promise.resolve({
        lat: 44.9775,
        lng: -93.2651,
        address: "Minneapolis, MN, United States",
      }),
    );

    expect(await answer).toStrictEqual({
      kind: "found",
      address: "Minneapolis, MN, United States",
      lat: 44.98,
      lng: -93.27,
      stamp: "the-stamp",
    });
    expect(stamp).toHaveBeenCalledWith({
      address: "Minneapolis, MN, United States",
      lat: 44.98,
      lng: -93.27,
    });
  });

  it("answers not-found when the provider has no such place, and stamps nothing", async () => {
    const { answer, report, stamp } = lookUp(() => Promise.resolve(undefined));
    expect(await answer).toStrictEqual({ kind: "not-found" });
    expect(report).not.toHaveBeenCalled();
    expect(stamp).not.toHaveBeenCalled();
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

  it("answers unavailable for a spent weather budget, and reports nothing (SA-M13)", async () => {
    const report = vi.fn();
    expect(
      await lookUpCity({
        label: "Portland",
        resolver: spentBudget,
        stamp: () => Promise.resolve("unused"),
        report,
        userId: "r",
      }),
    ).toStrictEqual({ kind: "unavailable" });
    expect(report).not.toHaveBeenCalled();
  });
});

describe("cityLookupInput", () => {
  it("takes a trimmed, bounded label and refuses a blank one in the field's words", () => {
    expect(cityLookupInput.parse({ label: "  Austin  " })).toStrictEqual({
      label: "Austin",
    });
    const blank = cityLookupInput.safeParse({ label: " ".repeat(3) });
    expect(blank.error?.issues.map((issue) => issue.message)).toStrictEqual([
      "Type the city you run in.",
    ]);
    expect(cityLookupInput.safeParse({ label: "a".repeat(121) }).success).toBe(
      false,
    );
    expect(cityLookupInput.safeParse({ label: "a".repeat(120) }).success).toBe(
      true,
    );
  });
});

describe("cityNotFound", () => {
  it("quotes what was typed, as round 26 #12 draws it", () => {
    expect(cityNotFound("Portlnd, OR")).toBe(
      `We couldn't find "Portlnd, OR". Check the spelling, or try a nearby city.`,
    );
  });
});
