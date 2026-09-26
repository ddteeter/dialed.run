import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clockLabel,
  dayLabel,
  dayTimeLabel,
  isTimeZone,
  proseDayLabel,
  deviceTimeZone,
  startAtTimeOfDay,
  timeOfDay,
} from "../../src/lib/dates";

/**
 * The bug these two exist to prevent is a hydration mismatch, which no
 * unit test can stage — it needs two runtimes. What a unit test *can* pin
 * is the property that makes the mismatch impossible: the output depends
 * on the epoch and on nothing else. So every case below asserts an exact
 * string, because "exact" is the whole claim. A formatter that consulted
 * the ambient zone would pass a `toContain` and fail here.
 */

// 2026-09-21T23:30:00Z — half an hour before UTC midnight, which is the
// shape that broke: a viewer at a negative offset is still on the 21st,
// a viewer at a positive one is already on the 22nd, and the runtime's
// answer is the one thing these functions must not ask for.
const LATE_ON_THE_21ST = Math.floor(Date.UTC(2026, 8, 21, 23, 30) / 1000);
const EARLY_ON_THE_22ND = Math.floor(Date.UTC(2026, 8, 22, 0, 30) / 1000);

describe("dayLabel", () => {
  it("formats a mono label's shape — weekday, short month, day", () => {
    // US order, month before day (round 26, item 9), and no comma: the
    // mono step sets it as "MON SEP 21".
    expect(dayLabel(LATE_ON_THE_21ST)).toBe("Mon Sep 21");
  });

  it("keeps the month to three letters, September included", () => {
    // en-GB's short September is "Sept"; the boards draw "SEP".
    expect(dayLabel(LATE_ON_THE_21ST)).not.toContain("Sept");
  });
});

describe("proseDayLabel", () => {
  it("writes the day as a sentence says it — with the comma", () => {
    expect(proseDayLabel(LATE_ON_THE_21ST)).toBe("Mon, Sep 21");
    expect(proseDayLabel(0)).toBe("Thu, Jan 1");
  });

  it("dates the day in the run's own zone, like dayLabel", () => {
    const afterUtcMidnight = Math.floor(Date.UTC(2026, 8, 22, 3, 30) / 1000);
    expect(proseDayLabel(afterUtcMidnight, "America/Chicago")).toBe(
      "Mon, Sep 21",
    );
    expect(proseDayLabel(afterUtcMidnight)).toBe("Tue, Sep 22");
  });

  it("reads the epoch in UTC, whatever the runtime's zone is", () => {
    // Half an hour later is the next UTC day. Both assertions together
    // are what pin the zone: one of them moves if `timeZone` is dropped
    // and the test host is not on UTC.
    expect(dayTimeLabel(LATE_ON_THE_21ST)).toBe("Mon Sep 21, 23:30");
    expect(dayLabel(EARLY_ON_THE_22ND)).toBe("Tue Sep 22");
  });

  it("takes seconds, not milliseconds", () => {
    // Every `*_at` column stores seconds. Passing milliseconds is the
    // mistake this signature exists to make impossible to forget, and it
    // lands about 55,000 years out rather than failing loudly.
    expect(dayLabel(0)).toBe("Thu Jan 1");
    expect(dayLabel(86_400)).toBe("Fri Jan 2");
  });

  it("is stable across calls, so a shared formatter is safe to reuse", () => {
    // The `Intl.DateTimeFormat` instances are module scope — constructed
    // once and used per row. That is only sound if they carry no state.
    expect(dayLabel(LATE_ON_THE_21ST)).toBe(dayLabel(LATE_ON_THE_21ST));
  });
});

describe("dayTimeLabel", () => {
  it("adds a zero-padded 24-hour time to the day", () => {
    // Two notifications on the same day are indistinguishable without
    // it, and a list sorted by time would look unsorted.
    expect(dayTimeLabel(EARLY_ON_THE_22ND)).toBe("Tue Sep 22, 00:30");
  });

  it("pads both halves, so the column does not ragged-edge", () => {
    const nineOhFive = Math.floor(Date.UTC(2026, 8, 2, 9, 5) / 1000);
    expect(dayTimeLabel(nineOhFive)).toBe("Wed Sep 2, 09:05");
  });

  it("renders midnight as 00:00, never 24:00", () => {
    // `hour12: false` permits the h24 cycle, where midnight is "24:00" and
    // belongs to the day before. Current ICU does not do that, so this
    // guards the engine rather than the code — which is why it is pinned
    // rather than left to be noticed.
    const midnight = Math.floor(Date.UTC(2026, 8, 22, 0, 0) / 1000);
    expect(dayTimeLabel(midnight)).toBe("Tue Sep 22, 00:00");
  });

  it("carries the same day as dayLabel for the same epoch", () => {
    // The two formatters are separate `Intl` instances with separate
    // option bags, so nothing but a test stops them drifting apart — and
    // a notification dated differently from the entry it points at is
    // exactly the kind of quiet wrongness this file is about.
    expect(dayTimeLabel(LATE_ON_THE_21ST)).toContain(
      dayLabel(LATE_ON_THE_21ST),
    );
  });
});

// 2026-09-22T03:30:00Z — the Tuesday in UTC, and still Monday evening in
// Chicago (UTC−5 in September). The shape of the bug D-96 is about: a
// late-evening run at a negative offset read as the next day.
const AFTER_UTC_MIDNIGHT = Math.floor(Date.UTC(2026, 8, 22, 3, 30) / 1000);

describe("the run's own zone (D-96)", () => {
  it("dates a run where it happened, not where UTC is", () => {
    expect(dayLabel(AFTER_UTC_MIDNIGHT)).toBe("Tue Sep 22");
    expect(dayLabel(AFTER_UTC_MIDNIGHT, "America/Chicago")).toBe("Mon Sep 21");
    // East of UTC too, so the zone is not merely "subtract five hours".
    expect(dayLabel(AFTER_UTC_MIDNIGHT, "Asia/Tokyo")).toBe("Tue Sep 22");
  });

  it("carries the zone into the time of day as well", () => {
    expect(dayTimeLabel(AFTER_UTC_MIDNIGHT, "America/Chicago")).toBe(
      "Mon Sep 21, 22:30",
    );
    expect(dayTimeLabel(AFTER_UTC_MIDNIGHT, "Asia/Tokyo")).toBe(
      "Tue Sep 22, 12:30",
    );
  });

  it("falls back to UTC for a zone Intl would throw on, rather than failing the render", () => {
    // The zone is stored from a third party. An invalid one must not
    // become a RangeError on every screen that shows the run.
    expect(dayLabel(AFTER_UTC_MIDNIGHT, "Mars/Olympus_Mons")).toBe(
      "Tue Sep 22",
    );
    expect(dayTimeLabel(AFTER_UTC_MIDNIGHT, "")).toBe("Tue Sep 22, 03:30");
  });
});

describe("isTimeZone", () => {
  it("accepts IANA zones and UTC", () => {
    expect(isTimeZone("America/Chicago")).toBe(true);
    expect(isTimeZone("Europe/London")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
  });

  it("rejects what Intl would throw on, and anything not a string", () => {
    expect(isTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isTimeZone("")).toBe(false);
    expect(isTimeZone(undefined)).toBe(false);
    expect(isTimeZone(-5)).toBe(false);
  });
});

describe("clockLabel", () => {
  it("draws the board's twelve-hour clock, in capitals", () => {
    // The minutes keep their leading zero where the hour does not, and
    // half past midnight is twelve, not zero.
    expect(clockLabel(LATE_ON_THE_21ST)).toBe("11:30 PM");
    expect(clockLabel(EARLY_ON_THE_22ND)).toBe("12:30 AM");
    const sixOhFour = Math.floor(Date.UTC(2026, 7, 29, 6, 4) / 1000);
    expect(clockLabel(sixOhFour)).toBe("6:04 AM");
  });

  it("reads the time where the run happened", () => {
    // Chicago is five hours behind UTC in September.
    expect(clockLabel(LATE_ON_THE_21ST, "America/Chicago")).toBe("6:30 PM");
  });

  it("falls back to UTC for a zone Intl will not take", () => {
    expect(clockLabel(LATE_ON_THE_21ST, "Not/AZone")).toBe("11:30 PM");
  });
});

describe("timeOfDay", () => {
  it("writes the clock as a time input does, padded and 24-hour", () => {
    expect(timeOfDay(LATE_ON_THE_21ST)).toBe("23:30");
    expect(timeOfDay(EARLY_ON_THE_22ND)).toBe("00:30");
    expect(timeOfDay(LATE_ON_THE_21ST, "America/Chicago")).toBe("18:30");
  });
});

describe("startAtTimeOfDay", () => {
  it("is the start that reads the picked time on the run's own clock", () => {
    // 18:30 in Chicago, moved to 06:04 the same day: back 12h 26m.
    expect(startAtTimeOfDay(LATE_ON_THE_21ST, "America/Chicago", "06:04")).toBe(
      LATE_ON_THE_21ST - (12 * 60 + 26) * 60,
    );
    // And forward, read in UTC when the run has no zone.
    expect(startAtTimeOfDay(EARLY_ON_THE_22ND, undefined, "01:45")).toBe(
      EARLY_ON_THE_22ND + 75 * 60,
    );
  });

  it("leaves a run at the time it already has", () => {
    expect(startAtTimeOfDay(LATE_ON_THE_21ST, undefined, "23:30")).toBe(
      LATE_ON_THE_21ST,
    );
  });

  it("gives the same start however often it is asked — a retry is not a second move", () => {
    const once = startAtTimeOfDay(LATE_ON_THE_21ST, "America/Chicago", "07:00");
    expect(startAtTimeOfDay(once, "America/Chicago", "07:00")).toBe(once);
  });
});

/**
The zone this device's clock is made to read in, for one test.
*/
function deviceReads(timeZone: string): void {
  const resolved = new Intl.DateTimeFormat().resolvedOptions();
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    ...resolved,
    timeZone,
  });
}

describe("deviceTimeZone", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is the zone this device's clock reads in", () => {
    deviceReads("America/Chicago");
    expect(deviceTimeZone()).toBe("America/Chicago");
  });

  it("is none when the device names a zone Intl would not take back", () => {
    deviceReads("Nowhere/Special");
    expect(deviceTimeZone()).toBeUndefined();
  });
});
