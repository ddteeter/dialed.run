import { describe, expect, it } from "vitest";

import type {
  CallConditions,
  CallRequest,
} from "../../../src/modules/call/contract";
import { SCORER_READS, score } from "../../../src/modules/call/scorer";
import { aCell, aPiece, aRequest, runs, verdictCounts, wore } from "./builders";

type Forecast = Extract<CallConditions, { kind: "forecast" }>;
type ForecastField = Exclude<keyof Forecast, "kind">;

/**
 * A forecast the scorer has something to say about, each field a different
 * number, so no move below can land on the value it started from.
 */
const FORECAST: Forecast = {
  kind: "forecast",
  tempC: 9,
  feelsLikeC: 7,
  precipMm: 0,
  windKph: 12,
};

/**
 * Every forecast field moved somewhere a scorer reading it would answer
 * differently: another band, another condition class, a gale.
 */
const MOVED: Readonly<Record<ForecastField, number>> = {
  tempC: -25,
  feelsLikeC: 22,
  precipMm: 8,
  windKph: 90,
};

/**
 * A runner the scorer knows in this hour's band and class and outside
 * them, with a cohort on both sides, so a change of band or class shows.
 */
function aKnownRunner(conditions: CallConditions): CallRequest {
  const worn = [wore("zip", "tops"), wore("shorts", "bottoms")];
  return aRequest({
    conditions,
    history: [
      ...runs(8, { worn }),
      ...runs(6, {
        judgedFeelsLikeC: 22,
        verdict: 1,
        worn: [wore("tee", "tops")],
      }),
      ...runs(4, { precip: "wet", verdict: -1, worn }),
    ],
    closet: [
      aPiece("zip", "tops", { lowC: 3, highC: 12 }),
      aPiece("tee", "tops", { lowC: 13 }),
      aPiece("shorts", "bottoms", { lowC: 4 }),
    ],
    cohort: [
      aCell({ verdicts: verdictCounts({ 0: 9, 1: 3 }) }),
      aCell({ bandFloorC: 20, verdicts: verdictCounts({ [-1]: 6, 0: 2 }) }),
      aCell({ precip: "wet", verdicts: verdictCounts({ 0: 1, 2: 7 }) }),
    ],
  });
}

function withMoved(field: ForecastField): CallConditions {
  return { ...FORECAST, [field]: MOVED[field] };
}

const FIELDS = [
  "tempC",
  "feelsLikeC",
  "precipMm",
  "windKph",
] as const satisfies readonly ForecastField[];

const DECLARED = new Set<ForecastField>(SCORER_READS);
const UNDECLARED = FIELDS.filter((field) => !DECLARED.has(field));

describe("the forecast fields the scorer reads (owner, 2026-11-26, #1105)", () => {
  it("declares the feel and the rain, and nothing else", () => {
    expect(SCORER_READS).toStrictEqual(["feelsLikeC", "precipMm"]);
  });

  it("leaves two fields undeclared: the air temperature and the wind", () => {
    expect(UNDECLARED).toStrictEqual(["tempC", "windKph"]);
  });

  it("holds every field a forecast has to the declaration, a new one included", () => {
    expect(new Set(Object.keys(FORECAST))).toStrictEqual(
      new Set(["kind", ...FIELDS]),
    );
  });

  it.each(SCORER_READS)("answers differently when %s moves", (field) => {
    const moved = score(aKnownRunner(withMoved(field)));

    expect(moved).not.toStrictEqual(score(aKnownRunner(FORECAST)));
  });

  it.each(UNDECLARED)(
    "answers the same when %s moves: it is not declared, and not read",
    (field) => {
      const moved = score(aKnownRunner(withMoved(field)));

      expect(moved).toStrictEqual(score(aKnownRunner(FORECAST)));
    },
  );
});
