import { describe, expect, it } from "vitest";

import { dayLabel, dayTimeLabel } from "../../src/lib/dates";

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
  it("formats the board's shape — weekday, day, short month", () => {
    // "Mon 2 Sep", not "Mon, Sep 2": en-GB is pinned because it is what
    // the artboards draw, not because of where anyone is.
    expect(dayLabel(LATE_ON_THE_21ST)).toBe("Mon 21 Sep");
  });

  it("reads the epoch in UTC, whatever the runtime's zone is", () => {
    // Half an hour later is the next UTC day. Both assertions together
    // are what pin the zone: one of them moves if `timeZone` is dropped
    // and the test host is not on UTC.
    expect(dayTimeLabel(LATE_ON_THE_21ST)).toBe("Mon 21 Sep, 23:30");
    expect(dayLabel(EARLY_ON_THE_22ND)).toBe("Tue 22 Sep");
  });

  it("takes seconds, not milliseconds", () => {
    // Every `*_at` column stores seconds. Passing milliseconds is the
    // mistake this signature exists to make impossible to forget, and it
    // lands about 55,000 years out rather than failing loudly.
    expect(dayLabel(0)).toBe("Thu 1 Jan");
    expect(dayLabel(86_400)).toBe("Fri 2 Jan");
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
    expect(dayTimeLabel(EARLY_ON_THE_22ND)).toBe("Tue 22 Sep, 00:30");
  });

  it("pads both halves, so the column does not ragged-edge", () => {
    const nineOhFive = Math.floor(Date.UTC(2026, 8, 2, 9, 5) / 1000);
    expect(dayTimeLabel(nineOhFive)).toBe("Wed 2 Sep, 09:05");
  });

  it("renders midnight as 00:00, never 24:00", () => {
    // `hour12: false` permits the h24 cycle, where midnight is "24:00" and
    // belongs to the day before. Current ICU does not do that, so this
    // guards the engine rather than the code — which is why it is pinned
    // rather than left to be noticed.
    const midnight = Math.floor(Date.UTC(2026, 8, 22, 0, 0) / 1000);
    expect(dayTimeLabel(midnight)).toBe("Tue 22 Sep, 00:00");
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
