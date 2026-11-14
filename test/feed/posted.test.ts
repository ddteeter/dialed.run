import { describe, expect, it } from "vitest";

import { plainSpaces, postedLabel } from "../../src/modules/feed/posted";
import { stripConditions } from "../../src/modules/feed/strip";
import { pointConditions } from "./conditions-fixture";

/**
 * E1's author line and run strip, as round 22's "E1v1 Following" writes
 * them: `2H AGO · 6:04 AM`, `YESTERDAY · 5:40 PM`, `MON · 7:15 PM`; and
 * `8.1 MI | 41°F · RAIN` or `INDOOR` or one cell.
 */

// Tue 2 Sep 2025, 12:00 UTC.
const NOON = Date.UTC(2025, 8, 2, 12, 0) / 1000;
const HOUR = 3600;
const DAY = 24 * HOUR;

/**
 * A day and its time, the "·" bound to the time (R55·204).
 */
function dayAt(day: string, time: string): string {
  return `${day}\u{A0}· ${time}`;
}

describe("postedLabel", () => {
  it("counts whole hours earlier today, and drops the clock (R55·204)", () => {
    expect(postedLabel(NOON - 2 * HOUR - 30 * 60, NOON)).toBe("2h ago");
  });

  it("counts minutes inside the first hour, and never says zero", () => {
    expect(postedLabel(NOON - 59 * 60, NOON)).toBe("59m ago");
    expect(postedLabel(NOON - 10, NOON)).toBe("1m ago");
    expect(postedLabel(NOON - HOUR, NOON)).toBe("1h ago");
  });

  it("says Yesterday by the calendar, not by twenty-four hours, with its time", () => {
    // 11pm the night before, seen at 7am: eight hours, and yesterday.
    const sevenAm = NOON - 5 * HOUR;
    expect(postedLabel(sevenAm - 8 * HOUR, sevenAm)).toBe(
      dayAt("Yesterday", "11:00 PM"),
    );
    expect(postedLabel(NOON - DAY, NOON)).toBe(dayAt("Yesterday", "12:00 PM"));
  });

  it("names the weekday inside a week, and the date past it", () => {
    expect(postedLabel(NOON - 2 * DAY, NOON)).toBe(dayAt("Sun", "12:00 PM"));
    expect(postedLabel(NOON - 6 * DAY, NOON)).toBe(dayAt("Wed", "12:00 PM"));
    expect(postedLabel(NOON - 7 * DAY, NOON)).toBe(
      dayAt("Tue Aug 26", "12:00 PM"),
    );
  });

  it("counts days and prints the time in the run's own zone", () => {
    // 23:00 on the 1st in Chicago is the 2nd in UTC: yesterday where the
    // run happened, eleven hours ago in UTC.
    const lateChicago = Date.UTC(2025, 8, 2, 4, 0) / 1000;
    const morningChicago = Date.UTC(2025, 8, 2, 15, 0) / 1000;
    expect(postedLabel(lateChicago, morningChicago, "America/Chicago")).toBe(
      dayAt("Yesterday", "11:00 PM"),
    );
    expect(postedLabel(lateChicago, morningChicago)).toBe("11h ago");
  });

  it("falls back to UTC for a zone Intl will not accept", () => {
    // 22:00 UTC on the 1st is Yesterday in UTC, with UTC's clock.
    const lateUtc = Date.UTC(2025, 8, 1, 22, 0) / 1000;
    expect(postedLabel(lateUtc, NOON, "Not/AZone")).toBe(
      dayAt("Yesterday", "10:00 PM"),
    );
    // A zone Intl accepts moves the clock: 3pm in Los Angeles.
    expect(postedLabel(lateUtc, NOON, "America/Los_Angeles")).toBe(
      dayAt("Yesterday", "3:00 PM"),
    );
  });

  it("binds the separator and uses no other unusual space", () => {
    const label = postedLabel(NOON - DAY, NOON);
    expect(label.replace("\u{A0}·", " ·")).not.toMatch(/[\u{202F}\u{A0}]/u);
    expect(label).toContain("\u{A0}· ");
  });
});

describe("plainSpaces", () => {
  it("makes ICU's narrow no-break space before AM a plain one, and leaves the rest", () => {
    expect(plainSpaces("6:04\u{202F}AM")).toBe("6:04 AM");
    expect(plainSpaces("6:04 AM · 7:15\u{202F}PM")).toBe("6:04 AM · 7:15 PM");
  });
});

describe("stripConditions", () => {
  const miles = { temp: "f", distance: "mi" } as const;

  it("is the temperature and the condition when there are conditions", () => {
    expect(
      stripConditions(
        pointConditions({ tempC: 5, feelsLikeC: 3, condition: "Rain" }),
        false,
        miles,
      ),
    ).toStrictEqual({
      kind: "conditions",
      shown: "41° · Rain",
      said: "41 degrees, Rain",
    });
  });

  it("gives the range the run covered, in the viewer's unit", () => {
    const warming = {
      ...pointConditions({ tempC: 5, feelsLikeC: 3, condition: "Clear" }),
      span: { minTempC: 5, maxTempC: 10, minFeelsLikeC: 3, maxFeelsLikeC: 9 },
    };
    expect(
      stripConditions(warming, false, { temp: "c", distance: "km" }),
    ).toStrictEqual({
      kind: "conditions",
      shown: "5–10° · Clear",
      said: "5 to 10 degrees, Clear",
    });
  });

  it("prefers conditions to the indoor flag", () => {
    expect(
      stripConditions(
        pointConditions({ tempC: 5, feelsLikeC: 3, condition: "Rain" }),
        true,
        miles,
      ),
    ).toMatchObject({ kind: "conditions" });
  });

  it("says INDOOR when the run says so, and nothing otherwise — never a dash", () => {
    expect(stripConditions(undefined, true, miles)).toStrictEqual({
      kind: "indoor",
    });
    expect(stripConditions(undefined, false, miles)).toBeUndefined();
  });
});
