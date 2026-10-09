import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  retiredLabel,
  retiredMonthLabel,
} from "../../src/modules/closet/retired-label";

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

/**
2025-12-31 23:30 UTC — already January 2026 east of about UTC+1.
*/
const LAST_OF_2025 = 1_767_223_800;

describe("retiredMonthLabel (round 28 #13's RETIRED MAR 2026, the rail's)", () => {
  it("puts the month, in three letters, then the year, and no day", () => {
    expect(retiredMonthLabel(LATE_ON_THE_12TH, "UTC")).toBe("Retired Sep 2026");
  });

  it("reads month and year in the runner's zone", () => {
    expect(retiredMonthLabel(LAST_OF_2025, "UTC")).toBe("Retired Dec 2025");
    expect(retiredMonthLabel(LAST_OF_2025, "Pacific/Auckland")).toBe(
      "Retired Jan 2026",
    );
  });

  it("falls back to UTC with no zone, or one Intl would refuse", () => {
    expect(retiredMonthLabel(LAST_OF_2025, undefined)).toBe("Retired Dec 2025");
    expect(retiredMonthLabel(LAST_OF_2025, "Not/AZone")).toBe(
      "Retired Dec 2025",
    );
  });

  it("is undated when nothing recorded the date", () => {
    expect(retiredMonthLabel(UNDATED, "UTC")).toBe("Retired");
  });
});
