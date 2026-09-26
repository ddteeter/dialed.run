import { describe, expect, it } from "vitest";
import { z } from "zod";

import { retiredLabel } from "../../src/modules/closet/retired-label";

/**
`retired_at` is nullable and the lint rules reject the literal.
*/
const UNDATED = z.null().parse(JSON.parse("null"));

/**
2026-09-12 23:50 UTC — already the 13th east of about UTC+1.
*/
const LATE_ON_THE_12TH = 1_789_257_000;

describe("retiredLabel (round 22's [RETIRED SEP 12])", () => {
  it("puts the month first, in three letters, then the day", () => {
    expect(retiredLabel(LATE_ON_THE_12TH, "UTC")).toBe("Retired Sep 12");
  });

  it("reads the date in the runner's zone", () => {
    expect(retiredLabel(LATE_ON_THE_12TH, "Pacific/Auckland")).toBe(
      "Retired Sep 13",
    );
  });

  it("falls back to UTC with no zone, or one Intl would refuse", () => {
    expect(retiredLabel(LATE_ON_THE_12TH, undefined)).toBe("Retired Sep 12");
    expect(retiredLabel(LATE_ON_THE_12TH, "Not/AZone")).toBe("Retired Sep 12");
  });

  it("is undated when nothing recorded the date", () => {
    expect(retiredLabel(UNDATED, "UTC")).toBe("Retired");
  });
});
