import { describe, expect, it } from "vitest";

import { garmentSchema } from "../../src/lib/contracts";

describe("garmentSchema (per-category attribute acceptance)", () => {
  it("accepts top/bottom attributes: layer, weight, fabric, wind/water resistant", () => {
    const result = garmentSchema.safeParse({
      category: "top",
      name: "Rover Half-Zip",
      layer: "mid",
      weight: "mid",
      fabric: "merino",
      windResistant: true,
      waterResistant: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a layer on a category that doesn't admit it (shoes)", () => {
    const result = garmentSchema.safeParse({
      category: "shoes",
      name: "Speedland",
      layer: "outer",
    });
    expect(result.success).toBe(false);
  });

  it("rejects windResistant on socks", () => {
    const result = garmentSchema.safeParse({
      category: "socks",
      name: "Wool socks",
      windResistant: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects fabric on gloves (gloves admit weight/wind/water, not fabric)", () => {
    const result = garmentSchema.safeParse({
      category: "gloves",
      name: "Liner gloves",
      fabric: "synthetic",
    });
    expect(result.success).toBe(false);
  });

  it("accepts waterResistant on shoes", () => {
    const result = garmentSchema.safeParse({
      category: "shoes",
      name: "Trail shoe",
      waterResistant: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a generic accessory entry with only a name", () => {
    const result = garmentSchema.safeParse({
      category: "accessory",
      name: "Sunglasses",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a garment missing the required name", () => {
    const result = garmentSchema.safeParse({ category: "top" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-https product URL", () => {
    const result = garmentSchema.safeParse({
      category: "top",
      name: "Tee",
      // No valid TLD (unicorn/prefer-https ignores it) — the schema itself
      // only cares that the scheme isn't https.
      productUrl: "http://localhost/tee",
    });
    expect(result.success).toBe(false);
  });
});
