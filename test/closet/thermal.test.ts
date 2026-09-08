import { describe, expect, it } from "vitest";

import { estimateTempRange, formatTempRange } from "../../src/lib/thermal";
import type { TempRange, ThermalInput } from "../../src/lib/thermal";

describe("estimateTempRange", () => {
  it("returns undefined when no weight is given", () => {
    expect(estimateTempRange({ category: "top" })).toBeUndefined();
  });

  it("returns undefined for a category with no thermal signal", () => {
    expect(
      estimateTempRange({ category: "shoes", weight: "mid" }),
    ).toBeUndefined();
    expect(
      estimateTempRange({ category: "accessory", weight: "light" }),
    ).toBeUndefined();
  });

  it("estimates a body-layer range for top/bottom", () => {
    const range = estimateTempRange({ category: "top", weight: "mid" });
    expect(range).toBeDefined();
    expect(range?.lowC).toBeLessThan(range?.highC ?? 0);
  });

  it("shifts an outer layer's range colder than a regular layer", () => {
    const regular = estimateTempRange({
      category: "top",
      weight: "mid",
      layer: "base",
    });
    const outer = estimateTempRange({
      category: "top",
      weight: "mid",
      layer: "outer",
    });
    expect(outer?.lowC).toBeLessThan(regular?.lowC ?? 0);
  });

  it("extends the low end downward when wind resistant", () => {
    const base = estimateTempRange({ category: "top", weight: "mid" });
    const windResistant = estimateTempRange({
      category: "top",
      weight: "mid",
      windResistant: true,
    });
    expect(windResistant?.lowC).toBeLessThan(base?.lowC ?? 0);
    expect(windResistant?.highC).toBe(base?.highC);
  });

  it("estimates an accessory range (headwear/neckwear/gloves/socks)", () => {
    const headwear = estimateTempRange({ category: "headwear", weight: "mid" });
    expect(headwear).toBeDefined();
  });
});

/**
 * A bound means "past here, switch to something else". At the ends of the
 * weight scale there is nothing to switch to, so the band is open — and
 * the old closed values made claims that were simply false, like a light
 * top being wrong above 79°F.
 */
describe("open-ended bands", () => {
  it("gives a light top no upper bound — nothing lighter exists", () => {
    const range = estimateTempRange({ category: "top", weight: "light" });
    expect(range?.lowC).toBeDefined();
    expect(range?.highC).toBeUndefined();
  });

  it("does the same for bottoms and socks", () => {
    expect(
      estimateTempRange({ category: "bottom", weight: "light" })?.highC,
    ).toBeUndefined();
    expect(
      estimateTempRange({ category: "socks", weight: "light" })?.highC,
    ).toBeUndefined();
  });

  /**
   * The distinction that makes this a rule rather than a special case: an
   * optional layer has a real ceiling, because "take it off" is an answer
   * a base layer does not have.
   */
  it("keeps the ceiling on a light outer layer — you can remove it", () => {
    const range = estimateTempRange({
      category: "top",
      layer: "outer",
      weight: "light",
    });
    expect(range?.highC).toBeDefined();
  });

  it("keeps the ceiling on light gloves and headwear", () => {
    expect(
      estimateTempRange({ category: "gloves", weight: "light" })?.highC,
    ).toBeDefined();
    expect(
      estimateTempRange({ category: "headwear", weight: "light" })?.highC,
    ).toBeDefined();
  });

  it("gives a heavy outer layer no lower bound — nothing goes over it", () => {
    const range = estimateTempRange({
      category: "top",
      layer: "outer",
      weight: "heavy",
    });
    expect(range?.lowC).toBeUndefined();
    expect(range?.highC).toBeDefined();
  });

  it("keeps the floor on a heavy base layer — you add a shell instead", () => {
    const range = estimateTempRange({ category: "top", weight: "heavy" });
    expect(range?.lowC).toBeDefined();
  });

  it("still widens a bounded floor for wind resistance", () => {
    const plain = estimateTempRange({ category: "top", weight: "mid" });
    const windy = estimateTempRange({
      category: "top",
      weight: "mid",
      windResistant: true,
    });
    expect(windy?.lowC).toBeLessThan(plain?.lowC ?? 0);
  });
});

describe("the tables themselves", () => {
  /**
   * The rest of this file asserts *relative* behaviour — outer is colder
   * than regular, wind widens the floor — which is the interesting part and
   * also why every literal in the tables survived mutation. Nothing pinned
   * a number, so `f(-4, 32)` could become `f(+4, 32)` and every test still
   * passed.
   *
   * These pin one entry per group at its exact Celsius value. That covers
   * three mutant families at once: the sign on every sub-zero Fahrenheit
   * literal, the whole weight-group objects (which could be emptied), and
   * the `f()` conversion itself — a wrong multiplier or a dropped `- 32`
   * moves every one of these numbers.
   *
   * Expected values are the conversion of the Fahrenheit literals a
   * reviewer reads: 39–59°F is 4–15°C, -8–25°F is -22–-4°C.
   */
  const cases: readonly [string, ThermalInput, TempRange][] = [
    ["top regular mid", { category: "top", weight: "mid" }, { lowC: 4, highC: 15 }],
    ["top regular heavy", { category: "top", weight: "heavy" }, { lowC: -7, highC: 8 }],
    ["top outer light", { category: "top", weight: "light", layer: "outer" }, { lowC: 6, highC: 16 }],
    ["bottom regular mid", { category: "bottom", weight: "mid" }, { lowC: -2, highC: 12 }],
    ["bottom regular heavy", { category: "bottom", weight: "heavy" }, { lowC: -15, highC: 4 }],
    ["bottom outer mid", { category: "bottom", weight: "mid", layer: "outer" }, { lowC: -8, highC: 6 }],
    ["headwear mid", { category: "headwear", weight: "mid" }, { lowC: -6, highC: 6 }],
    ["headwear heavy", { category: "headwear", weight: "heavy" }, { lowC: -20, highC: -2 }],
    ["neckwear mid", { category: "neckwear", weight: "mid" }, { lowC: -10, highC: 4 }],
    ["neckwear heavy", { category: "neckwear", weight: "heavy" }, { lowC: -22, highC: -4 }],
    ["gloves mid", { category: "gloves", weight: "mid" }, { lowC: -8, highC: 5 }],
    ["gloves heavy", { category: "gloves", weight: "heavy" }, { lowC: -22, highC: -5 }],
    ["socks mid", { category: "socks", weight: "mid" }, { lowC: -4, highC: 12 }],
    ["socks heavy", { category: "socks", weight: "heavy" }, { lowC: -18, highC: 4 }],
  ];

  it.each(cases)("converts %s to its exact celsius band", (_label, input, expected) => {
    expect(estimateTempRange(input)).toEqual(expected);
  });

  it("keeps the two body tables distinct", () => {
    // `estimateTempRange` picks BODY_RANGES or BOTTOM_RANGES on the
    // category. Swapping that choice is only observable where the two
    // tables disagree, which they do at every weight.
    expect(estimateTempRange({ category: "top", weight: "mid" })).not.toEqual(
      estimateTempRange({ category: "bottom", weight: "mid" }),
    );
  });
});

describe("formatTempRange", () => {
  it("reads as a direction when an end is open", () => {
    expect(formatTempRange({ lowC: 13 })).toBe("13°+");
    expect(formatTempRange({ highC: 2 })).toBe("under 2°");
    expect(formatTempRange({ lowC: 4, highC: 15 })).toBe("4–15°");
  });

  it("has nothing to say about a band with no bounds at all", () => {
    expect(formatTempRange({})).toBeUndefined();
  });
});
