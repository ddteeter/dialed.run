import { describe, expect, it } from "vitest";

import {
  formatDistance,
  formatDuration,
  formatWind,
  formatTempRange,
} from "../../src/lib/measures";
import { formatTemp } from "../../src/lib/temperature";

/**
 * Both were local helpers inside route files, so neither had a test — and
 * a distance formatter that is wrong is wrong on every entry at once.
 */

describe("formatDistance", () => {
  it("converts metres to miles at one decimal", () => {
    expect(formatDistance(1609.34, "mi")).toBe("1.0mi");
    expect(formatDistance(5000, "mi")).toBe("3.1mi");
  });

  it("rounds rather than truncating", () => {
    // 8047 m is 5.0000… mi; 8850 m is 5.499 and must not read as 5.5.
    expect(formatDistance(8850, "mi")).toBe("5.5mi");
    expect(formatDistance(8800, "mi")).toBe("5.5mi");
    expect(formatDistance(8000, "mi")).toBe("5.0mi");
  });

  it("keeps the decimal on a whole number, so the column stays aligned", () => {
    expect(formatDistance(0, "mi")).toBe("0.0mi");
  });
});

describe("formatWind", () => {
  it("speaks miles an hour to a runner who counts miles", () => {
    // Board A1's "SE 9MPH" is 14.5 km/h. The backlog printed 15, in kph,
    // to a runner set to miles.
    expect(formatWind(14.5, "mi")).toBe("9mph");
    expect(formatWind(9, "mi")).toBe("6mph");
  });

  it("speaks kilometres an hour to a runner who counts kilometres", () => {
    expect(formatWind(14.5, "km")).toBe("15km/h");
  });

  it("rounds rather than floors, in both units", () => {
    // 4.4 km/h is 2.73 mph: floored it would read 2.
    expect(formatWind(4.4, "mi")).toBe("3mph");
    expect(formatWind(4.6, "km")).toBe("5km/h");
    expect(formatWind(0, "mi")).toBe("0mph");
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

  it("adds hours from one hour, padding the minutes beneath them", () => {
    // Board D's run: 8.1 miles in 1:03:41. It read "63:41" because no
    // test here had ever held a run longer than an hour.
    expect(formatDuration(3821)).toBe("1:03:41");
    // The boundary itself, and the last second before it.
    expect(formatDuration(3600)).toBe("1:00:00");
    expect(formatDuration(3599)).toBe("59:59");
    // Minutes are padded under an hour only when there is an hour above
    // them; ten and more need no padding either way.
    expect(formatDuration(2 * 3600 + 15 * 60 + 9)).toBe("2:15:09");
  });
});

describe("inFahrenheit", () => {
  it("converts and rounds", () => {
    expect(formatTemp(10, "f")).toBe("50°");
    expect(formatTemp(0, "f")).toBe("32°");
    expect(formatTemp(-10, "f")).toBe("14°");
  });
});

/**
 * `inFahrenheitRange` — the span a run actually covered.
 */
describe("formatDistance in the reader's own unit", () => {
  it("renders miles for a reader who chose miles", () => {
    expect(formatDistance(5000, "mi")).toBe("3.1mi");
  });

  it("renders kilometres for a reader who chose kilometres", () => {
    // The contract stores metres either way (D-6); only the reading moves.
    expect(formatDistance(5000, "km")).toBe("5.0km");
  });

  it("keeps one decimal in both, so the two read as the same measurement", () => {
    expect(formatDistance(1609.34, "mi")).toBe("1.0mi");
    expect(formatDistance(1000, "km")).toBe("1.0km");
  });
});

describe("inFahrenheitRange", () => {
  it("renders the two ends when a run spanned them", () => {
    // 2C -> 36F, 14C -> 57F. En dash, no spaces, matching bandLabel.
    expect(formatTempRange(2, 14, "f")).toBe("36–57°");
  });

  it("collapses to one value when the run fits a single hour", () => {
    // Not cosmetic: most runs are inside one hour, and "36–36°" reads as a
    // measurement error rather than a short run.
    expect(formatTempRange(2, 2, "f")).toBe("36°");
  });

  it("collapses when the two ends round to the same degree", () => {
    // 4.2C and 4.4C both render 40F; a range whose ends print the same is
    // the thing the collapse exists to avoid, and comparing the rounded
    // strings is what catches it.
    expect(formatTempRange(4.2, 4.4, "f")).toBe("40°");
  });

  it("keeps the degree sign on the high end only", () => {
    expect(formatTempRange(0, 10, "f")).toBe("32–50°");
  });
});
