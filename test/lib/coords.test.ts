import { describe, expect, it } from "vitest";

import { roundCoordinate } from "../../src/lib/coords";

describe("roundCoordinate (STR-14: two places, about a kilometre)", () => {
  it("keeps two decimal places and no more", () => {
    expect(String(roundCoordinate(45.523456))).toBe("45.52");
    expect(String(roundCoordinate(-122.676543))).toBe("-122.68");
  });

  it("rounds half up to the nearest hundredth", () => {
    expect(String(roundCoordinate(44.975))).toBe("44.98");
    expect(String(roundCoordinate(44.9749))).toBe("44.97");
  });

  it("changes nothing already at that precision, so a cache key still hits", () => {
    expect(String(roundCoordinate(44.98))).toBe("44.98");
    const once = roundCoordinate(45.523456);
    expect(String(roundCoordinate(once))).toBe("45.52");
  });
});
