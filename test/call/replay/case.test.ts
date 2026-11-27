import { describe, expect, it } from "vitest";

import {
  PRECIP_LEVELS,
  precipClassOf,
} from "../../../src/lib/contracts/temperature";
import type { CohortCell } from "../../../src/modules/call/contract";
import {
  casesFrom,
  isCaseRun,
  type ReplayHistory,
} from "../../../src/modules/call/replay";
import { PRECIP_MM } from "../../../src/modules/call/replay/case";
import { CLOSET, personalRun, worn } from "./fixtures";

const HOUR = 3600;
const T0 = 1_767_600_000;

const cohort: CohortCell[] = [
  {
    rung: "everyone",
    bandFloorC: 5,
    precip: "dry",
    group: "tops",
    bandRunners: 9,
    groupRunners: 7,
    verdicts: { [-2]: 0, [-1]: 1, 0: 5, 1: 1, 2: 0 },
  },
];

function historyOf(runs: ReplayHistory["runs"]): ReplayHistory {
  return {
    runnerId: "runner-1",
    runner: { thermalLevel: 1, climateZone: "Cfb" },
    closet: CLOSET,
    runs,
  };
}

// Ids sort the other way from time, so a dropped sort shows.
const late = personalRun({ runId: "a-late", startedAt: T0 + 3 * HOUR + 59 });
const early = personalRun({
  runId: "c-early",
  startedAt: T0 + HOUR + 1,
  judgedFeelsLikeC: 3.4,
  precip: "wet",
  verdict: -1,
  effort: "race",
  worn: worn("z-base", "tights"),
});
const middle = personalRun({ runId: "b-middle", startedAt: T0 + 2 * HOUR });

describe("casesFrom", () => {
  const cases = casesFrom(historyOf([late, early, middle]), cohort);

  it("gives one case per run, oldest first", () => {
    expect(cases.map((c) => c.caseId)).toEqual([
      "c-early",
      "b-middle",
      "a-late",
    ]);
  });

  it("never lets a case see its own run or a later one", () => {
    expect(cases.map((c) => c.request.history.map((r) => r.runId))).toEqual([
      [],
      ["c-early"],
      ["c-early", "b-middle"],
    ]);
    const startOf = new Map(
      [late, early, middle].map((r) => [r.runId, r.startedAt]),
    );
    for (const replayCase of cases) {
      for (const earlier of replayCase.request.history) {
        expect(earlier.startedAt).toBeLessThan(
          startOf.get(replayCase.caseId) ?? 0,
        );
      }
    }
  });

  it("leaves a run that started at the same moment out of the history", () => {
    const twin = personalRun({ runId: "twin", startedAt: early.startedAt });
    const [first, second] = casesFrom(historyOf([early, twin]), cohort);
    expect(first?.request.history).toEqual([]);
    expect(second?.request.history).toEqual([]);
  });

  it("asks for the run's own hour and judged conditions", () => {
    expect(cases[0]).toEqual({
      caseId: "c-early",
      runnerId: "runner-1",
      origin: "rebuilt",
      request: {
        hourStart: T0 + HOUR,
        effort: "race",
        conditions: {
          kind: "forecast",
          tempC: 3.4,
          feelsLikeC: 3.4,
          precipMm: 5,
          windKph: 0,
        },
        runner: { thermalLevel: 1, climateZone: "Cfb" },
        history: [],
        closet: CLOSET,
        cohort,
      },
      worn: worn("z-base", "tights"),
      verdict: -1,
    });
    expect(cases[2]?.request.hourStart).toBe(T0 + 3 * HOUR);
  });

  it("keeps manual-weather runs in the history but never makes them cases", () => {
    const manual = personalRun({
      runId: "manual",
      startedAt: T0,
      source: "manual",
    });
    const replayed = casesFrom(historyOf([middle, manual]), cohort);
    expect(replayed.map((c) => c.caseId)).toEqual(["b-middle"]);
    expect(replayed[0]?.request.history).toEqual([manual]);
  });

  it("orders the history oldest first, whatever order it was given in", () => {
    const manual = personalRun({
      runId: "z-manual",
      startedAt: T0,
      source: "manual",
    });
    const last = casesFrom(historyOf([late, middle, manual, early]), cohort)[2];
    expect(last?.request.history.map((r) => r.runId)).toEqual([
      "z-manual",
      "c-early",
      "b-middle",
    ]);
  });

  it("does not reorder the history it was given", () => {
    const runs = [late, early, middle];
    casesFrom(historyOf(runs), cohort);
    expect(runs.map((r) => r.runId)).toEqual(["a-late", "c-early", "b-middle"]);
  });
});

describe("isCaseRun", () => {
  it("is false only for manual weather", () => {
    expect(isCaseRun(personalRun({ source: "manual" }))).toBe(false);
    expect(isCaseRun(personalRun({ source: "visualcrossing" }))).toBe(true);
  });
});

describe("PRECIP_MM", () => {
  it("reads back as its own class", () => {
    for (const precip of PRECIP_LEVELS) {
      expect(precipClassOf(PRECIP_MM[precip])).toBe(precip);
    }
    expect(PRECIP_MM).toEqual({ dry: 0, damp: 1, wet: 5 });
  });
});
