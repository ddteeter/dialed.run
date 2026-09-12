import { describe, expect, it } from "vitest";

import {
  formatDistance,
  formatDuration,
  inFahrenheit,
  inFahrenheitRange,
} from "../../src/lib/measures";

/**
 * Both were local helpers inside route files, so neither had a test — and
 * a distance formatter that is wrong is wrong on every entry at once.
 */

describe("formatDistance", () => {
  it("converts metres to miles at one decimal", () => {
    expect(formatDistance(1609.34)).toBe("1.0mi");
    expect(formatDistance(5000)).toBe("3.1mi");
  });

  it("rounds rather than truncating", () => {
    // 8047 m is 5.0000… mi; 8850 m is 5.499 and must not read as 5.5.
    expect(formatDistance(8850)).toBe("5.5mi");
    expect(formatDistance(8800)).toBe("5.5mi");
    expect(formatDistance(8000)).toBe("5.0mi");
  });

  it("keeps the decimal on a whole number, so the column stays aligned", () => {
    expect(formatDistance(0)).toBe("0.0mi");
  });
});

describe("formatDuration", () => {
  it("reads as minutes and seconds", () => {
    expect(formatDuration(1830)).toBe("30:30");
  });

  it("pads the seconds and not the minutes", () => {
    // "7:05", not "07:05" — the second reads like a clock time rather than
    // a duration.
    expect(formatDuration(425)).toBe("7:05");
  });

  it("floors the minutes rather than rounding them", () => {
    // 119 s is one minute and 59 seconds, never two minutes.
    expect(formatDuration(119)).toBe("1:59");
    expect(formatDuration(59)).toBe("0:59");
    expect(formatDuration(0)).toBe("0:00");
  });
});

describe("inFahrenheit", () => {
  it("converts and rounds", () => {
    expect(inFahrenheit(10)).toBe("50°");
    expect(inFahrenheit(0)).toBe("32°");
    expect(inFahrenheit(-10)).toBe("14°");
  });
});

/**
 * `inFahrenheitRange` — the span a run actually covered.
 */
describe("inFahrenheitRange", () => {
  it("renders the two ends when a run spanned them", () => {
    // 2C -> 36F, 14C -> 57F. En dash, no spaces, matching bandLabel.
    expect(inFahrenheitRange(2, 14)).toBe("36–57°");
  });

  it("collapses to one value when the run fits a single hour", () => {
    // Not cosmetic: most runs are inside one hour, and "36–36°" reads as a
    // measurement error rather than a short run.
    expect(inFahrenheitRange(2, 2)).toBe("36°");
  });

  it("collapses when the two ends round to the same degree", () => {
    // 4.2C and 4.4C both render 40F; a range whose ends print the same is
    // the thing the collapse exists to avoid, and comparing the rounded
    // strings is what catches it.
    expect(inFahrenheitRange(4.2, 4.4)).toBe("40°");
  });

  it("keeps the degree sign on the high end only", () => {
    expect(inFahrenheitRange(0, 10)).toBe("32–50°");
  });
});
