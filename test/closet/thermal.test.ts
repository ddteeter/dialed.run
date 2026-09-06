import { describe, expect, it } from "vitest";

import { estimateTempRange } from "../../src/lib/thermal";

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
