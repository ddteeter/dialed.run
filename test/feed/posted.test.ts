import { describe, expect, it } from "vitest";

import { postedLabel } from "../../src/modules/feed/posted";
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

describe("postedLabel", () => {
  it("counts whole hours earlier today, and gives the time on a 12-hour clock", () => {
    expect(postedLabel(NOON - 2 * HOUR - 30 * 60, NOON)).toBe(
      "2h ago · 9:30 AM",
    );
  });

  it("counts minutes inside the first hour, and never says zero", () => {
    expect(postedLabel(NOON - 59 * 60, NOON)).toBe("59m ago · 11:01 AM");
    expect(postedLabel(NOON - 10, NOON)).toBe("1m ago · 11:59 AM");
    expect(postedLabel(NOON - HOUR, NOON)).toBe("1h ago · 11:00 AM");
  });

  it("says Yesterday by the calendar, not by twenty-four hours", () => {
    // 11pm the night before, seen at 7am: eight hours, and yesterday.
    const sevenAm = NOON - 5 * HOUR;
    expect(postedLabel(sevenAm - 8 * HOUR, sevenAm)).toBe(
      "Yesterday · 11:00 PM",
    );
    expect(postedLabel(NOON - DAY, NOON)).toBe("Yesterday · 12:00 PM");
  });

  it("names the weekday inside a week, and the date past it", () => {
    expect(postedLabel(NOON - 2 * DAY, NOON)).toBe("Sun · 12:00 PM");
    expect(postedLabel(NOON - 6 * DAY, NOON)).toBe("Wed · 12:00 PM");
    expect(postedLabel(NOON - 7 * DAY, NOON)).toBe("Tue 26 Aug · 12:00 PM");
  });

  it("counts days and prints the time in the run's own zone", () => {
    // 01:00 in Chicago on the 2nd is 06:00 UTC — the same calendar day in
    // Chicago as a 10:00 Chicago "now", where UTC would agree too; but
    // 23:00 on the 1st in Chicago is the 2nd in UTC, and is yesterday
    // where the run happened.
    const lateChicago = Date.UTC(2025, 8, 2, 4, 0) / 1000;
    const morningChicago = Date.UTC(2025, 8, 2, 15, 0) / 1000;
    expect(postedLabel(lateChicago, morningChicago, "America/Chicago")).toBe(
      "Yesterday · 11:00 PM",
    );
    expect(postedLabel(lateChicago, morningChicago)).toBe("11h ago · 4:00 AM");
  });

  it("falls back to UTC for a zone Intl will not accept", () => {
    expect(postedLabel(NOON - 2 * HOUR, NOON, "Not/AZone")).toBe(
      "2h ago · 10:00 AM",
    );
  });

  it("uses one kind of space throughout", () => {
    expect(postedLabel(NOON, NOON)).not.toMatch(/[\u{202F}\u{A0}]/u);
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
    ).toStrictEqual({ kind: "conditions", text: "41° · Rain" });
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
      text: "5–10° · Clear",
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
