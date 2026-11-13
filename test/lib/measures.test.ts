import { describe, expect, it } from "vitest";

import {
  distanceNumber,
  formatDistance,
  formatPace,
  formatDuration,
  formatWind,
  formatTempRange,
  gainNumber,
  measuredLine,
  paceForms,
  paceNumber,
  paceUnit,
  spokenDuration,
  spokenPace,
  wholeDistanceNumber,
  bandForms,
  worksAtForms,
  spanInUnit,
} from "../../src/lib/contracts/measures";
import { formatTemp } from "../../src/lib/contracts/temperature";

/**
 * Both were local helpers inside route files, so neither had a test — and
 * a distance formatter that is wrong is wrong on every entry at once.
 */

describe("distanceNumber", () => {
  it("is the number alone, at one decimal, in either unit", () => {
    expect(distanceNumber(9978, "mi")).toBe("6.2");
    expect(distanceNumber(9978, "km")).toBe("10.0");
    expect(distanceNumber(0, "km")).toBe("0.0");
  });
});

describe("wholeDistanceNumber", () => {
  it("is a running total to the whole unit, rounded, in either unit", () => {
    // 412.4 miles, 663.7 km.
    expect(wholeDistanceNumber(663_700, "mi")).toBe("412");
    expect(wholeDistanceNumber(663_700, "km")).toBe("664");
    expect(wholeDistanceNumber(0, "mi")).toBe("0");
  });
});

describe("formatPace", () => {
  it("writes time per unit the way the boards do", () => {
    // A1's card: 9,978 m (6.2 mi) in 51:38 is 499.7 s a mile, which
    // rounds to 8:20.
    expect(formatPace(3098, 9978, "mi")).toBe("8:20 /mi");
    // The same run per kilometre: 5:10.
    expect(formatPace(3098, 9978, "km")).toBe("5:10 /km");
  });

  it("rounds to the second and carries into hours", () => {
    expect(formatPace(3601, 1000, "km")).toBe("1:00:01 /km");
    expect(formatPace(299.6, 1000, "km")).toBe("5:00 /km");
  });

  it("is minutes and seconds per mile, padded, with its unit", () => {
    // 5 mi in 43:20 is 8:40 a mile — D's own example.
    expect(formatPace(2600, 5 * 1609.34, "mi")).toBe("8:40 /mi");
    expect(formatPace(3605, 5 * 1609.34, "mi")).toBe("12:01 /mi");
  });

  it("is per kilometre for a runner who counts them", () => {
    expect(formatPace(1615, 5000, "km")).toBe("5:23 /km");
  });

  it("rounds to the nearest second", () => {
    expect(formatPace(1000, 3000, "km")).toBe("5:33 /km");
    expect(formatPace(1001, 3000, "km")).toBe("5:34 /km");
  });

  it("has no pace for a run with no distance, and one for any distance at all", () => {
    expect(formatPace(1800, 0, "mi")).toBeUndefined();
    // 1 metre in 1800s extrapolates to an absurd but real per-km pace —
    // `formatDuration`'s own hour-carrying rule applies here too, since
    // pace reuses it rather than a second copy of "seconds to a clock".
    expect(formatPace(1800, 1, "km")).toBe("500:00:00 /km");
  });
});

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
    // The contract stores metres either way (R-6); only the reading moves.
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

describe("paceNumber", () => {
  it("is formatPace and spokenPace without their unit", () => {
    expect(paceNumber(3098, 9978, "mi")).toStrictEqual({
      shown: "8:20",
      said: "8 minutes 20 seconds",
    });
    expect(paceNumber(3098, 9978, "km")).toStrictEqual({
      shown: "5:10",
      said: "5 minutes 10 seconds",
    });
  });

  it("has no pace with no distance", () => {
    expect(paceNumber(1800, 0, "mi")).toBeUndefined();
    expect(paceNumber(1800, -1, "km")).toBeUndefined();
  });
});

describe("paceUnit", () => {
  it("is the unit as drawn and as said", () => {
    expect(paceUnit("mi")).toStrictEqual({ shown: "/mi", said: "per mile" });
    expect(paceUnit("km")).toStrictEqual({
      shown: "/km",
      said: "per kilometre",
    });
  });
});

describe("gainNumber", () => {
  it("is whole feet for a runner who counts miles", () => {
    // Round 41's 210 FT is 64 m.
    expect(gainNumber(64, "mi")).toStrictEqual({ value: "210", unit: "ft" });
    expect(gainNumber(0.2, "mi")).toStrictEqual({ value: "1", unit: "ft" });
  });

  it("is whole metres for a runner who counts kilometres", () => {
    expect(gainNumber(64.4, "km")).toStrictEqual({ value: "64", unit: "m" });
    expect(gainNumber(64.5, "km")).toStrictEqual({ value: "65", unit: "m" });
  });
});

/**
 * What a screen reader hears in place of "51:38" and "8:15 /mi": the first
 * reads as a time of day, the second as "slash m i" (a11y judgment audit,
 * 2026-11-04).
 */
describe("spokenDuration", () => {
  it("says minutes and seconds in words", () => {
    expect(spokenDuration(3098)).toBe("51 minutes 38 seconds");
  });

  it("says hours from one hour, as formatDuration shows them", () => {
    expect(spokenDuration(3821)).toBe("1 hour 3 minutes 41 seconds");
    expect(spokenDuration(2 * 3600 + 15 * 60 + 9)).toBe(
      "2 hours 15 minutes 9 seconds",
    );
  });

  it("says one of a thing in the singular", () => {
    expect(spokenDuration(3600 + 60 + 1)).toBe("1 hour 1 minute 1 second");
    expect(spokenDuration(2 * 3600 + 2 * 60 + 2)).toBe(
      "2 hours 2 minutes 2 seconds",
    );
  });

  it("leaves out a part that is zero", () => {
    expect(spokenDuration(480)).toBe("8 minutes");
    expect(spokenDuration(3605)).toBe("1 hour 5 seconds");
    expect(spokenDuration(59)).toBe("59 seconds");
    expect(spokenDuration(3600)).toBe("1 hour");
  });

  it("says nothing at all as no seconds", () => {
    expect(spokenDuration(0)).toBe("0 seconds");
  });
});

describe("spokenPace", () => {
  it("is formatPace in words, per the runner's unit", () => {
    expect(spokenPace(3098, 9978, "mi")).toBe("8 minutes 20 seconds per mile");
    expect(spokenPace(3098, 9978, "km")).toBe(
      "5 minutes 10 seconds per kilometre",
    );
  });

  it("rounds to the second as formatPace does", () => {
    expect(spokenPace(1001, 3000, "km")).toBe(
      "5 minutes 34 seconds per kilometre",
    );
    expect(spokenPace(3601, 1000, "km")).toBe("1 hour 1 second per kilometre");
  });

  it("has no pace with no distance", () => {
    expect(spokenPace(1800, 0, "mi")).toBeUndefined();
    expect(spokenPace(1800, -1, "km")).toBeUndefined();
  });
});

describe("paceForms", () => {
  it("is formatPace and spokenPace together", () => {
    expect(paceForms(3098, 9978, "mi")).toStrictEqual({
      shown: "8:20 /mi",
      said: "8 minutes 20 seconds per mile",
    });
  });

  it("has neither with no distance", () => {
    expect(paceForms(1800, 0, "km")).toBeUndefined();
  });
});

describe("measuredLine", () => {
  const miles = { temp: "f", distance: "mi" } as const;
  const metric = { temp: "c", distance: "km" } as const;

  it("draws A1's line and says it as the contract's example does", () => {
    // Round 52 #158, the Accessibility Contract's "Measured lines" row.
    expect(
      measuredLine(
        [
          [{ kind: "temp", tempC: 0.5, feels: "Feels" }],
          [{ kind: "humidity", percent: 80.4 }],
          [{ kind: "wind", windKph: 9 }],
          [{ kind: "word", word: "overcast" }],
        ],
        miles,
      ),
    ).toStrictEqual({
      shown: "Feels 33° · 80% hum · 6mph · overcast",
      said: "Feels like 33 degrees, 80 percent humidity, wind 6 miles per hour, overcast",
    });
  });

  it("joins a group with a space and says every part apart", () => {
    // The receipt's "41°F dry · feels 36°": two groups, three parts.
    expect(
      measuredLine(
        [
          [
            { kind: "temp", tempC: 5, withLetter: true },
            { kind: "word", word: "dry" },
          ],
          [{ kind: "temp", tempC: 2.2, feels: "feels" }],
        ],
        miles,
      ),
    ).toStrictEqual({
      shown: "41°F dry · feels 36°",
      said: "41 degrees Fahrenheit, dry, feels like 36 degrees",
    });
  });

  it("speaks the viewer's units, Celsius and kilometres included", () => {
    expect(
      measuredLine(
        [
          [
            { kind: "distance", distanceM: 10_000, spaced: true },
            { kind: "temp", tempC: 5, withLetter: true },
          ],
          [{ kind: "wind", windKph: 14.6 }],
          [{ kind: "distance", distanceM: 8200 }],
        ],
        metric,
      ),
    ).toStrictEqual({
      shown: "10.0 km 5°C · 15km/h · 8.2km",
      said: "10.0 kilometres, 5 degrees Celsius, wind 15 kilometres per hour, 8.2 kilometres",
    });
  });

  it("draws a duration on the clock and says it in words", () => {
    // The receipt's "6.2 mi · 51:38".
    expect(
      measuredLine(
        [
          [{ kind: "distance", distanceM: 9978, spaced: true }],
          [{ kind: "duration", durationS: 3098 }],
        ],
        miles,
      ),
    ).toStrictEqual({
      shown: "6.2 mi · 51:38",
      said: "6.2 miles, 51 minutes 38 seconds",
    });
  });

  it("draws a distance glued or spaced, and says it in miles", () => {
    expect(
      measuredLine(
        [
          [{ kind: "distance", distanceM: 9978, spaced: true }],
          [{ kind: "distance", distanceM: 13_197 }],
        ],
        miles,
      ),
    ).toStrictEqual({
      shown: "6.2 mi · 8.2mi",
      said: "6.2 miles, 8.2 miles",
    });
  });

  it("says a range as one, collapsed when its ends draw the same", () => {
    expect(
      measuredLine(
        [
          [{ kind: "range", minC: 3.4, maxC: 7.8 }],
          [{ kind: "range", minC: 4.3, maxC: 4.4 }],
          [{ kind: "range", minC: -20.6, maxC: -18 }],
        ],
        miles,
      ),
    ).toStrictEqual({
      shown: "38–46° · 40° · -5–0°",
      said: "38 to 46 degrees, 40 degrees, minus 5 to 0 degrees",
    });
  });

  it("says a range felt as one, as Your conditions draws it (round 53 #162.3)", () => {
    expect(
      measuredLine(
        [
          [{ kind: "word", word: "Same conditions" }],
          [{ kind: "range", minC: 5, maxC: 8, feels: "Feels" }],
          [{ kind: "word", word: "damp" }],
          [{ kind: "range", minC: 5, maxC: 5.2, feels: "feels" }],
        ],
        miles,
      ),
    ).toStrictEqual({
      shown: "Same conditions · Feels 41–46° · damp · feels 41°",
      said: "Same conditions, feels like 41 to 46 degrees, damp, feels like 41 degrees",
    });
  });

  it("says a band from its floor as a range (round 53 #162.3)", () => {
    expect(
      measuredLine(
        [[{ kind: "word", word: "Set" }], [{ kind: "band", floorC: 5 }]],
        miles,
      ),
    ).toStrictEqual({ shown: "Set · 41–50°", said: "Set, 41 to 50 degrees" });
    expect(
      measuredLine([[{ kind: "band", floorC: -5 }]], metric),
    ).toStrictEqual({ shown: "-5–0°", said: "Minus 5 to 0 degrees" });
  });

  it("says one degree and one mile an hour in the singular, and minus for a hyphen", () => {
    expect(
      measuredLine(
        [
          [{ kind: "temp", tempC: 1 }],
          [{ kind: "temp", tempC: -1 }],
          [{ kind: "temp", tempC: -4 }],
          [{ kind: "wind", windKph: 1.6 }],
          [{ kind: "wind", windKph: 0 }],
        ],
        metric,
      ),
    ).toStrictEqual({
      shown: "1° · -1° · -4° · 2km/h · 0km/h",
      said: "1 degree, minus 1 degree, minus 4 degrees, wind 2 kilometres per hour, wind 0 kilometres per hour",
    });
    expect(measuredLine([[{ kind: "wind", windKph: 1.6 }]], miles).said).toBe(
      "Wind 1 mile per hour",
    );
  });

  it("capitalises the first letter it says, and nothing else", () => {
    // The Desk's run line opens on a day, and A1's on "feels".
    expect(
      measuredLine(
        [
          [{ kind: "word", word: "nov 4" }],
          [{ kind: "word", word: "7:12 AM" }],
          [{ kind: "temp", tempC: 5 }],
          [{ kind: "word", word: "damp" }],
        ],
        miles,
      ),
    ).toStrictEqual({
      shown: "nov 4 · 7:12 AM · 41° · damp",
      said: "Nov 4, 7:12 AM, 41 degrees, damp",
    });
  });
});

describe("bandForms", () => {
  it("draws the band and says it as a range, uncapitalised for a sentence", () => {
    expect(bandForms(5, "f")).toStrictEqual({
      shown: "41–50°",
      said: "41 to 50 degrees",
    });
    expect(bandForms(-5, "c")).toStrictEqual({
      shown: "-5–0°",
      said: "minus 5 to 0 degrees",
    });
  });
});

describe("worksAtForms", () => {
  it("says a closed range from end to end", () => {
    expect(worksAtForms({ lowC: 4.4, highC: 14.4 }, "f")).toStrictEqual({
      shown: "40–58°",
      said: "40 to 58 degrees",
    });
  });

  it("says an open high end as and up, and an open low end as under", () => {
    expect(worksAtForms({ lowC: -2 }, "c")).toStrictEqual({
      shown: "-2°+",
      said: "minus 2 degrees and up",
    });
    expect(worksAtForms({ highC: 1 }, "c")).toStrictEqual({
      shown: "under 1°",
      said: "under 1 degree",
    });
  });

  it("has nothing for a range with no ends", () => {
    expect(worksAtForms({}, "f")).toBeUndefined();
  });
});

describe("spanInUnit", () => {
  it("draws the readout with its letter and says the unit in full", () => {
    expect(spanInUnit(18, 72, "f")).toStrictEqual({
      shown: "18–72°F",
      said: "18 to 72 degrees Fahrenheit",
    });
    expect(spanInUnit(-8, 1, "c")).toStrictEqual({
      shown: "-8–1°C",
      said: "minus 8 to 1 degree Celsius",
    });
  });
});
