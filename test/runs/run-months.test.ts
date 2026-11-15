import { describe, expect, it } from "vitest";

import {
  listedSince,
  monthCount,
  moreToShow,
  runMonths,
  RUNS_LISTED,
} from "../../src/modules/runs/run-months";

/**
 * The runs list's month breaks and its end line (Round 55 · 235).
 */
const NOV_1_3AM_UTC = Math.floor(Date.UTC(2026, 10, 1, 3) / 1000);
const OCT_20 = Math.floor(Date.UTC(2026, 9, 20, 12) / 1000);

describe("runMonths", () => {
  it("cuts where the month changes, keeping the order runs came in", () => {
    const runs = [
      { id: "a", startedAt: NOV_1_3AM_UTC, clockZone: "UTC" },
      { id: "b", startedAt: OCT_20, clockZone: "UTC" },
      { id: "c", startedAt: OCT_20 - 60, clockZone: "UTC" },
    ];

    expect(
      runMonths(runs).map(({ month, runs: inMonth }) => [
        month,
        inMonth.map((run) => run.id),
      ]),
    ).toEqual([
      ["November 2026", ["a"]],
      ["October 2026", ["b", "c"]],
    ]);
  });

  it("reads the month on the run's own clock, and UTC without one", () => {
    expect(
      runMonths([
        { startedAt: NOV_1_3AM_UTC, clockZone: "America/Chicago" },
        { startedAt: NOV_1_3AM_UTC, clockZone: undefined },
        { startedAt: NOV_1_3AM_UTC, clockZone: "Not/A_Zone" },
      ]).map(({ month, runs }) => [month, runs.length]),
    ).toEqual([
      ["October 2026", 1],
      ["November 2026", 2],
    ]);
  });

  it("has no months for no runs", () => {
    expect(runMonths([])).toEqual([]);
  });
});

describe("listedSince", () => {
  it("names the oldest listed run's month once every run is listed", () => {
    expect(
      listedSince(
        [
          { startedAt: NOV_1_3AM_UTC, clockZone: undefined },
          { startedAt: NOV_1_3AM_UTC, clockZone: "America/Chicago" },
        ],
        2,
      ),
    ).toBe("Oct 2026");
  });

  it("says nothing for no runs, or while there are more than it listed (R58·299)", () => {
    expect(listedSince([], 0)).toBeUndefined();
    const run = { startedAt: OCT_20, clockZone: undefined };
    const fifty = Array.from({ length: RUNS_LISTED }, () => run);
    expect(listedSince(fifty, RUNS_LISTED + 1)).toBeUndefined();
    // Fifty listed out of fifty is every run: the cap is not the end.
    expect(listedSince(fifty, RUNS_LISTED)).toBe("Oct 2026");
    expect(listedSince([run], 1)).toBe("Oct 2026");
  });
});

describe("moreToShow", () => {
  it("offers the next fifty, or what is left when that is fewer (R58·299)", () => {
    expect(moreToShow(RUNS_LISTED, 120)).toBe(RUNS_LISTED);
    expect(moreToShow(100, 120)).toBe(20);
    expect(moreToShow(100, 101)).toBe(1);
    expect(moreToShow(100, 100)).toBe(0);
    expect(moreToShow(3, 3)).toBe(0);
  });
});

describe("monthCount", () => {
  it("counts the cut month whole, and every other month by its listed runs (R58·299)", () => {
    const cut = { month: "October 2026", count: 17 };
    expect(monthCount("October 2026", 4, cut)).toBe(17);
    expect(monthCount("November 2026", 9, cut)).toBe(9);
    expect(monthCount("October 2026", 4, undefined)).toBe(4);
  });
});
