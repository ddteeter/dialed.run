import { describe, expect, it } from "vitest";

import {
  listedSince,
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
  it("names the oldest listed run's month", () => {
    expect(
      listedSince([
        { startedAt: NOV_1_3AM_UTC, clockZone: undefined },
        { startedAt: NOV_1_3AM_UTC, clockZone: "America/Chicago" },
      ]),
    ).toBe("Oct 2026");
  });

  it("says nothing for no runs, or for a list that stopped at its cap", () => {
    expect(listedSince([])).toBeUndefined();
    const run = { startedAt: OCT_20, clockZone: undefined };
    expect(
      listedSince(Array.from({ length: RUNS_LISTED }, () => run)),
    ).toBeUndefined();
    expect(
      listedSince(Array.from({ length: RUNS_LISTED - 1 }, () => run)),
    ).toBe("Oct 2026");
  });
});
