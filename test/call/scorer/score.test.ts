import { describe, expect, it } from "vitest";

import {
  CALL_VERDICT_THRESHOLD,
  THERMAL_LEVEL_C,
} from "../../../src/lib/contracts";
import type {
  CallRequest,
  CallResult,
} from "../../../src/modules/call/contract";
import { ENGINE_VERSION, score } from "../../../src/modules/call/scorer";
import {
  COHORT_STRENGTH_CAP,
  LEAN_STEP_C,
  PERSONAL_PRIOR_STRENGTH,
  PRIOR_DROP_PER_C,
  PRIOR_IN_RANGE,
  PRIOR_NO_ESTIMATE,
  PRIOR_STRENGTH,
} from "../../../src/modules/call/scorer/shrinkage";
import {
  aCell,
  aForecast,
  aPiece,
  aRequest,
  aRun,
  runs,
  verdictCounts,
  wore,
} from "./builders";

const NO_BAND_RUNS = {
  kind: "personal-band",
  bandFloorC: 5,
  cold: 0,
  dialed: 0,
  warm: 0,
} as const;

function ids(pieces: readonly { pieceId: string }[]): string[] {
  return pieces.map((piece) => piece.pieceId);
}

function rotated<T>(items: readonly T[]): T[] {
  return [...items.slice(2).toReversed(), ...items.slice(0, 2)];
}

/**
The same request with its history, closet and cohort in another order.
*/
function shuffled(request: CallRequest): CallRequest {
  return {
    ...request,
    history: rotated(request.history),
    closet: rotated(request.closet),
    cohort: rotated(request.cohort),
  };
}

/**
The Call for `aRequest` with these changes.
*/
function callFor(overrides: Partial<CallRequest> = {}): CallResult {
  return score(aRequest(overrides));
}

/**
 * A runner well past the threshold, with a record in the 5 °C dry band and
 * outside it, a closet in every group and a cohort on every rung.
 */
function aFullRequest(): CallRequest {
  const shortsAndShoes = [wore("shorts", "bottoms"), wore("pegasus", "shoes")];
  const kit = [wore("zip", "tops"), ...shortsAndShoes];
  return aRequest({
    runner: { thermalLevel: 1, climateZone: "minneapolis" },
    history: [
      ...runs(5, { verdict: 0, worn: [...kit, wore("buff", "hands_head")] }),
      ...runs(2, {
        verdict: -1,
        worn: [wore("tee", "tops"), ...shortsAndShoes],
      }),
      aRun({
        verdict: 0,
        worn: [...kit, wore("gloves", "hands_head", "too_much")],
      }),
      ...runs(4, {
        judgedFeelsLikeC: 21,
        verdict: 0,
        worn: [wore("tee", "tops")],
      }),
      ...runs(3, { precip: "wet", verdict: 1, worn: [wore("shell", "outer")] }),
      ...runs(2, { source: "manual", worn: [wore("tee", "tops")] }),
    ],
    closet: [
      aPiece("zip", "tops", { lowC: 3, highC: 12 }),
      aPiece("tee", "tops", { lowC: 13 }),
      aPiece("shorts", "bottoms", { lowC: 4 }),
      aPiece("tights", "bottoms", { lowC: -7, highC: 4 }),
      aPiece("shell", "outer", { lowC: -4, highC: 10 }),
      aPiece("buff", "hands_head"),
      aPiece("gloves", "hands_head", { lowC: -8, highC: 5 }),
      aPiece("pegasus", "shoes"),
      aPiece("socks", "socks_extras"),
    ],
    cohort: [
      aCell({ group: "tops", verdicts: verdictCounts({ 0: 30, 1: 10 }) }),
      aCell({
        rung: "zone",
        climateZone: "minneapolis",
        group: "tops",
        verdicts: verdictCounts({ [-1]: 4, 0: 5 }),
      }),
      aCell({ group: "outer", groupRunners: 3 }),
      aCell({ group: "socks_extras", groupRunners: 9 }),
      aCell({ group: "bottoms", bandFloorC: 10 }),
    ],
  });
}

describe("the scorer's answer", () => {
  it("is stamped with its version and the hour it was asked about", () => {
    const result = callFor({ hourStart: 1_912_345_600 });

    expect(ENGINE_VERSION).toBe("scorer-1");
    expect(result.engineVersion).toBe("scorer-1");
    expect(result.hourStart).toBe(1_912_345_600);
  });

  it("answers an empty request with an empty Call", () => {
    expect(callFor()).toStrictEqual({
      engineVersion: "scorer-1",
      hourStart: 1_900_000_000,
      bandFloorC: 5,
      precip: "dry",
      confidence: "below-threshold",
      verdictsSoFar: 0,
      personalRunsInBand: 0,
      warmRuns: { bandFloorC: 5, worn: [] },
      kit: [],
      ranking: [],
    });
  });

  it("names the 5 °C band of the forecast's feel (reading 2)", () => {
    expect(callFor({ conditions: aForecast(9.9) }).bandFloorC).toBe(5);
    expect(callFor({ conditions: aForecast(10) }).bandFloorC).toBe(10);
    expect(callFor({ conditions: aForecast(-0.1) }).bandFloorC).toBe(-5);
  });

  it("names the forecast's condition class (reading 1)", () => {
    expect(callFor({ conditions: aForecast(7, 0) }).precip).toBe("dry");
    expect(callFor({ conditions: aForecast(7, 1) }).precip).toBe("damp");
    expect(callFor({ conditions: aForecast(7, 6) }).precip).toBe("wet");
  });
});

describe("determinism", () => {
  it("gives the same request the same result twice", () => {
    const request = aFullRequest();

    expect(score(request)).toStrictEqual(score(request));
  });

  it("gives the same result whatever order the history, closet and cohort arrive in", () => {
    const request = aFullRequest();

    expect(score(shuffled(request))).toStrictEqual(score(request));
  });

  it("does not change the request it was given", () => {
    const request = aFullRequest();
    const before = structuredClone(request);

    score(request);

    expect(request).toStrictEqual(before);
  });
});

describe("the ranking", () => {
  it("lists every candidate, the best first, and not in id order", () => {
    const result = score(aFullRequest());

    expect(ids(result.ranking)).toStrictEqual([
      "zip",
      "buff",
      "shorts",
      "shell",
      "pegasus",
      "tights",
      "gloves",
      "socks",
      "tee",
    ]);
  });

  it("puts a piece the runner got right ahead of an untried one with a better estimate", () => {
    const result = callFor({
      history: runs(4, { verdict: 0, worn: [wore("worn-zip", "tops")] }),
      closet: [
        aPiece("a-new-top", "tops", { lowC: 5, highC: 10 }),
        aPiece("worn-zip", "tops"),
      ],
    });

    expect(ids(result.ranking)).toStrictEqual(["worn-zip", "a-new-top"]);
  });

  it("breaks a tie on score by id, lowest first, whatever the closet's order", () => {
    const result = callFor({
      closet: [
        aPiece("c-tee", "tops"),
        aPiece("a-shorts", "bottoms"),
        aPiece("b-cap", "hands_head"),
      ],
    });

    expect(ids(result.ranking)).toStrictEqual(["a-shorts", "b-cap", "c-tee"]);
    expect(new Set(result.ranking.map((piece) => piece.score)).size).toBe(1);
  });
});

describe("a piece's score (reading 10)", () => {
  it("is the no-estimate prior for a piece nothing is known about", () => {
    const [piece] = callFor({ closet: [aPiece("tee", "tops")] }).ranking;

    expect(piece?.score).toBeCloseTo(PRIOR_NO_ESTIMATE, 10);
    expect(piece?.evidence).toStrictEqual([NO_BAND_RUNS]);
  });

  it("starts from the estimate against the feel, and says so", () => {
    const [piece] = callFor({
      conditions: aForecast(7),
      closet: [aPiece("tee", "tops", { lowC: 10 })],
    }).ranking;

    expect(piece?.score).toBeCloseTo(PRIOR_IN_RANGE - 3 * PRIOR_DROP_PER_C, 10);
    expect(piece?.evidence).toStrictEqual([
      NO_BAND_RUNS,
      { kind: "estimate", pieceId: "tee", range: { lowC: 10 } },
    ]);
  });

  it("shifts the feel by the runner's thermal offset against estimates, and nothing else (reading 4)", () => {
    const request = aRequest({
      conditions: aForecast(10),
      runner: { thermalLevel: 2 },
      history: [aRun({ judgedFeelsLikeC: 10, worn: [wore("worn", "tops")] })],
      closet: [aPiece("tee", "tops", { lowC: 10 }), aPiece("worn", "tops")],
    });
    const result = score(request);
    const tee = result.ranking.find((piece) => piece.pieceId === "tee");

    expect(tee?.score).toBeCloseTo(
      PRIOR_IN_RANGE - 2 * THERMAL_LEVEL_C * PRIOR_DROP_PER_C,
      10,
    );
    expect(result.bandFloorC).toBe(10);
    expect(result.personalRunsInBand).toBe(1);
  });

  it("is pulled toward the cohort's dialed share for the piece's group", () => {
    const cell = aCell({
      group: "tops",
      bandRunners: 12,
      groupRunners: 11,
      verdicts: verdictCounts({ [-1]: 1, 0: 3 }),
    });
    const [piece] = callFor({
      closet: [aPiece("tee", "tops")],
      cohort: [cell],
    }).ranking;

    expect(piece?.score).toBeCloseTo(
      (3 + PRIOR_NO_ESTIMATE * PRIOR_STRENGTH) / (4 + PRIOR_STRENGTH),
      10,
    );
    expect(piece?.evidence).toStrictEqual([
      NO_BAND_RUNS,
      {
        kind: "cohort-share",
        group: "tops",
        rung: "everyone",
        climateZone: undefined,
        bandFloorC: 5,
        groupRunners: 11,
        bandRunners: 12,
      },
    ]);
  });

  it("gives two pieces of one group the same cohort fact (reading 8)", () => {
    const cell = aCell({ group: "tops", verdicts: verdictCounts({ 0: 9 }) });
    const result = callFor({
      closet: [aPiece("tee", "tops"), aPiece("zip", "tops")],
      cohort: [cell],
    });
    const cohortFacts = result.ranking.map((piece) =>
      piece.evidence.filter((fact) => fact.kind === "cohort-share"),
    );

    expect(cohortFacts[0]).toHaveLength(1);
    expect(cohortFacts[0]).toStrictEqual(cohortFacts[1]);
  });

  it("is pulled toward the runner's own record in the piece, in this band and class", () => {
    const history = [
      ...runs(2, { verdict: 0, worn: [wore("zip", "tops")] }),
      aRun({ verdict: 0, worn: [wore("zip", "tops", "not_enough")] }),
      aRun({ verdict: -1, worn: [wore("zip", "tops")] }),
      aRun({ verdict: 2, worn: [wore("zip", "tops", "too_much")] }),
      aRun({ judgedFeelsLikeC: 12, verdict: 0, worn: [wore("zip", "tops")] }),
      aRun({ precip: "damp", verdict: 0, worn: [wore("zip", "tops")] }),
    ];
    const result = callFor({ history, closet: [aPiece("zip", "tops")] });

    expect(result.ranking[0]?.score).toBeCloseTo(
      (3 + PRIOR_NO_ESTIMATE * PERSONAL_PRIOR_STRENGTH) /
        (5 + 2 + PERSONAL_PRIOR_STRENGTH),
      10,
    );
    expect(result.ranking[0]?.evidence).toStrictEqual([
      { kind: "personal-band", bandFloorC: 5, cold: 1, dialed: 3, warm: 1 },
      {
        kind: "personal-piece",
        pieceId: "zip",
        bandFloorC: 5,
        dialed: 3,
        of: 5,
      },
      {
        kind: "personal-flag",
        pieceId: "zip",
        bandFloorC: 5,
        flag: "too_much",
        times: 1,
      },
      {
        kind: "personal-flag",
        pieceId: "zip",
        bandFloorC: 5,
        flag: "not_enough",
        times: 1,
      },
    ]);
    expect(result.personalRunsInBand).toBe(5);
  });

  it("layers all three: estimate, then cohort, then the runner's runs", () => {
    const cell = aCell({
      group: "tops",
      verdicts: verdictCounts({ 0: 15, 2: 5 }),
    });
    const [piece] = callFor({
      history: runs(2, { verdict: 0, worn: [wore("zip", "tops")] }),
      closet: [aPiece("zip", "tops", { lowC: 3, highC: 12 })],
      cohort: [cell],
    }).ranking;
    const base =
      (0.75 * COHORT_STRENGTH_CAP + PRIOR_IN_RANGE * PRIOR_STRENGTH) /
      (COHORT_STRENGTH_CAP + PRIOR_STRENGTH);

    expect(piece?.score).toBeCloseTo(
      (2 + base * PERSONAL_PRIOR_STRENGTH) / (2 + PERSONAL_PRIOR_STRENGTH),
      10,
    );
  });

  it("counts a run whose weather a human typed as the runner's own (owner, 2026-11-26)", () => {
    const history = [
      ...runs(2, { verdict: 0, worn: [wore("zip", "tops")] }),
      ...runs(3, {
        source: "manual",
        verdict: -2,
        worn: [wore("zip", "tops", "not_enough")],
      }),
    ];
    const result = callFor({ history, closet: [aPiece("zip", "tops")] });

    expect(result.personalRunsInBand).toBe(5);
    expect(result.ranking[0]?.score).toBeCloseTo(
      (2 + PRIOR_NO_ESTIMATE * PERSONAL_PRIOR_STRENGTH) /
        (5 + 3 + PERSONAL_PRIOR_STRENGTH),
      10,
    );
    expect(result.ranking[0]?.evidence).toStrictEqual([
      { kind: "personal-band", bandFloorC: 5, cold: 3, dialed: 2, warm: 0 },
      {
        kind: "personal-piece",
        pieceId: "zip",
        bandFloorC: 5,
        dialed: 2,
        of: 5,
      },
      {
        kind: "personal-flag",
        pieceId: "zip",
        bandFloorC: 5,
        flag: "not_enough",
        times: 3,
      },
    ]);
  });

  it("reads nothing of the runner's history into a cohort figure, typed weather or not", () => {
    const cell = aCell({
      group: "tops",
      bandRunners: 12,
      groupRunners: 7,
      verdicts: verdictCounts({ 0: 3, 1: 1 }),
    });
    const closet = [aPiece("tee", "tops")];
    const typed = runs(4, { source: "manual", worn: [wore("zip", "tops")] });
    const cohortFact = {
      kind: "cohort-share",
      group: "tops",
      rung: "everyone",
      climateZone: undefined,
      bandFloorC: 5,
      groupRunners: 7,
      bandRunners: 12,
    };
    const withTyped = callFor({ history: typed, closet, cohort: [cell] });
    const withNone = callFor({ closet, cohort: [cell] });

    expect(withTyped.ranking[0]?.evidence).toContainEqual(cohortFact);
    expect(withNone.ranking[0]?.evidence).toContainEqual(cohortFact);
    expect(withTyped.ranking[0]?.score).toBe(withNone.ranking[0]?.score);
  });

  it("does not read a cohort cell below the privacy floor, by band or by group", () => {
    const thinBand = aCell({
      group: "tops",
      bandRunners: 4,
      groupRunners: 4,
      verdicts: verdictCounts({ 0: 40 }),
    });
    const thinGroup = aCell({
      group: "tops",
      bandRunners: 30,
      groupRunners: 4,
      verdicts: verdictCounts({ 0: 40 }),
    });
    const closet = [aPiece("tee", "tops")];
    const withoutCohort = callFor({ closet });

    expect(callFor({ closet, cohort: [thinBand] })).toStrictEqual(
      withoutCohort,
    );
    expect(callFor({ closet, cohort: [thinGroup] })).toStrictEqual(
      withoutCohort,
    );
  });

  it("takes no layer on the say of a cell whose group too few runners wore", () => {
    const closet = [aPiece("tee", "tops"), aPiece("shell", "outer")];
    const fourOfSix = aCell({
      group: "outer",
      bandRunners: 6,
      groupRunners: 4,
    });
    const fiveOfSix = aCell({
      group: "outer",
      bandRunners: 6,
      groupRunners: 5,
    });

    expect(ids(callFor({ closet, cohort: [fourOfSix] }).kit)).toStrictEqual([
      "tee",
    ]);
    expect(ids(callFor({ closet, cohort: [fiveOfSix] }).kit)).toStrictEqual([
      "tee",
      "shell",
    ]);
  });
});

describe("effort (owner, 2026-11-26)", () => {
  const closet = [aPiece("tee", "tops", { highC: 10 })];

  it("reads the Call's hour at its effort, for its band and for estimates", () => {
    const easy = callFor({ conditions: aForecast(7), effort: "easy", closet });
    const workout = callFor({
      conditions: aForecast(7),
      effort: "workout",
      closet,
    });

    expect(easy.bandFloorC).toBe(5);
    expect(easy.ranking[0]?.score).toBeCloseTo(PRIOR_IN_RANGE, 10);
    expect(workout.bandFloorC).toBe(10);
    expect(workout.ranking[0]?.score).toBeCloseTo(
      PRIOR_IN_RANGE - 2 * PRIOR_DROP_PER_C,
      10,
    );
  });

  it("reads a Call with no effort as an easy one", () => {
    expect(callFor({ conditions: aForecast(7), closet })).toStrictEqual(
      callFor({ conditions: aForecast(7), effort: "easy", closet }),
    );
  });

  it("counts each past run in the band of its own effort", () => {
    const history = [
      aRun({ judgedFeelsLikeC: 7 }),
      aRun({ judgedFeelsLikeC: 2, effort: "workout" }),
      aRun({ judgedFeelsLikeC: 3, effort: "steady" }),
      aRun({ judgedFeelsLikeC: 2.9, effort: "steady" }),
      aRun({ judgedFeelsLikeC: 7, effort: "race" }),
    ];

    expect(callFor({ history }).personalRunsInBand).toBe(3);
  });

  it("puts a hard Call and an easy run on the same footing", () => {
    const history = [
      aRun({ judgedFeelsLikeC: 7, effort: "easy" }),
      aRun({ judgedFeelsLikeC: 0, effort: "race" }),
      aRun({ judgedFeelsLikeC: 0, effort: "easy" }),
    ];
    const result = callFor({
      conditions: aForecast(0),
      effort: "race",
      history,
    });

    expect(result.bandFloorC).toBe(5);
    expect(result.personalRunsInBand).toBe(2);
  });

  it("looks the cohort up in the band of the hour at its effort", () => {
    const cell = aCell({ group: "tops", bandFloorC: 10 });
    const result = callFor({
      conditions: aForecast(7),
      effort: "workout",
      closet,
      cohort: [cell],
    });

    expect(result.ranking[0]?.evidence).toContainEqual({
      kind: "cohort-share",
      group: "tops",
      rung: "everyone",
      climateZone: undefined,
      bandFloorC: 10,
      groupRunners: 10,
      bandRunners: 10,
    });
  });
});

describe("the band's lean (owner, 2026-11-26)", () => {
  const other = [wore("other", "tops")];

  it("reads the hour as warmer for a runner who ran warm here, so lighter wins", () => {
    const history = [
      ...runs(4, { verdict: 1, worn: other }),
      ...runs(2, { verdict: 0, worn: other }),
      aRun({ verdict: -1, worn: other }),
    ];
    const result = callFor({
      history,
      closet: [
        aPiece("warm-top", "tops", { lowC: 3, highC: 7 }),
        aPiece("light-top", "tops", { lowC: 7 }),
      ],
    });
    const leanC = (3 / 10) * LEAN_STEP_C;

    expect(ids(result.ranking)).toStrictEqual(["light-top", "warm-top"]);
    expect(result.ranking[0]?.score).toBeCloseTo(PRIOR_IN_RANGE, 10);
    expect(result.ranking[1]?.score).toBeCloseTo(
      PRIOR_IN_RANGE - leanC * PRIOR_DROP_PER_C,
      10,
    );
  });

  it("reads the hour as colder for a runner who ran cold here, so warmer wins", () => {
    const history = [
      ...runs(4, { verdict: -2, worn: other }),
      ...runs(2, { verdict: 0, worn: other }),
      aRun({ verdict: 2, worn: other }),
    ];
    const result = callFor({
      history,
      closet: [
        aPiece("a-light-top", "tops", { lowC: 7 }),
        aPiece("warm-top", "tops", { lowC: 3, highC: 7 }),
      ],
    });
    const leanC = (3 / 10) * LEAN_STEP_C;

    expect(ids(result.ranking)).toStrictEqual(["warm-top", "a-light-top"]);
    expect(result.ranking[1]?.score).toBeCloseTo(
      PRIOR_IN_RANGE - leanC * PRIOR_DROP_PER_C,
      10,
    );
  });

  it("leans on runs in this band and class only", () => {
    const history = [
      ...runs(6, { judgedFeelsLikeC: 21, verdict: 2, worn: other }),
      ...runs(6, { precip: "wet", verdict: 2, worn: other }),
    ];
    const [piece] = callFor({
      history,
      closet: [aPiece("warm-top", "tops", { lowC: 3, highC: 7 })],
    }).ranking;

    expect(piece?.score).toBeCloseTo(PRIOR_IN_RANGE, 10);
  });

  it("adds to the runner's thermal offset, each in its own direction", () => {
    const history = runs(7, { verdict: 1, worn: other });
    const [piece] = callFor({
      runner: { thermalLevel: 1 },
      history,
      closet: [aPiece("top", "tops", { lowC: 7 })],
    }).ranking;
    const feelC = 7 - THERMAL_LEVEL_C + (7 / 10) * LEAN_STEP_C;

    expect(piece?.score).toBeCloseTo(
      PRIOR_IN_RANGE - (7 - feelC) * PRIOR_DROP_PER_C,
      10,
    );
  });
});

describe("the kit (reading 7)", () => {
  it("takes the best piece of each staple group and of each group the evidence is for", () => {
    const result = score(aFullRequest());

    expect(ids(result.kit)).toStrictEqual(["zip", "shorts", "buff", "pegasus"]);
  });

  it("holds the ranking's own pieces, score and evidence with them", () => {
    const result = score(aFullRequest());

    for (const piece of result.kit) {
      expect(result.ranking).toContain(piece);
    }
  });

  it("leaves a staple group out when the closet has no piece for it", () => {
    const result = callFor({
      closet: [aPiece("shorts", "bottoms"), aPiece("shell", "outer")],
    });

    expect(ids(result.kit)).toStrictEqual(["shorts"]);
  });

  it("adds an outer layer the cohort mostly wears when the runner has no runs here", () => {
    const closet = [aPiece("tee", "tops"), aPiece("shell", "outer")];
    const mostWear = aCell({ group: "outer", bandRunners: 9, groupRunners: 5 });

    expect(ids(callFor({ closet, cohort: [mostWear] }).kit)).toStrictEqual([
      "tee",
      "shell",
    ]);
  });

  it("adds a layer on the runner's own runs: worn here and dialed more often than not", () => {
    const history = [
      ...runs(3, { verdict: 0, worn: [wore("gloves", "hands_head")] }),
      ...runs(3, { verdict: -1 }),
    ];
    const result = callFor({
      history,
      closet: [aPiece("gloves", "hands_head")],
    });

    expect(ids(result.kit)).toStrictEqual(["gloves"]);
  });

  it("reads the kit rule from runs in this band and class only", () => {
    const history = [
      ...runs(3, {
        judgedFeelsLikeC: -3,
        verdict: 0,
        worn: [wore("gloves", "hands_head")],
      }),
      ...runs(3, {
        precip: "wet",
        verdict: 0,
        worn: [wore("gloves", "hands_head")],
      }),
    ];
    const result = callFor({
      history,
      closet: [aPiece("gloves", "hands_head")],
    });

    expect(result.kit).toStrictEqual([]);
  });
});

describe("confidence (reading 6)", () => {
  const worn = [wore("zip", "tops")];
  const closet = [aPiece("zip", "tops")];

  it("is below the threshold one verdict short of it, and still ranks", () => {
    const result = callFor({
      history: runs(CALL_VERDICT_THRESHOLD - 1, { worn }),
      closet,
    });

    expect(result.confidence).toBe("below-threshold");
    expect(result.personalRunsInBand).toBe(CALL_VERDICT_THRESHOLD - 1);
    expect(ids(result.ranking)).toStrictEqual(["zip"]);
    expect(ids(result.kit)).toStrictEqual(["zip"]);
  });

  it("counts typed-weather runs toward the threshold and in the band alike", () => {
    const history = [
      ...runs(9, { worn }),
      ...runs(CALL_VERDICT_THRESHOLD - 9, { source: "manual", worn }),
    ];
    const result = callFor({ history, closet });

    expect(result.confidence).toBe("confident");
    expect(result.personalRunsInBand).toBe(CALL_VERDICT_THRESHOLD);
  });

  it("knows a runner whose every verdict was on typed weather", () => {
    const history = runs(CALL_VERDICT_THRESHOLD, { source: "manual", worn });

    expect(callFor({ history, closet }).confidence).toBe("confident");
  });

  it("is borrowed when none of the runner's runs are in this band and class", () => {
    const history = [
      ...runs(10, { judgedFeelsLikeC: 21, worn }),
      ...runs(5, { precip: "wet", worn }),
    ];
    const result = callFor({ history, closet });

    expect(result.confidence).toBe("borrowed");
    expect(result.personalRunsInBand).toBe(0);
  });

  it("is probable at five runs in band and confident at six", () => {
    const elsewhere = runs(10, { judgedFeelsLikeC: 21, worn });

    expect(
      callFor({ history: [...elsewhere, ...runs(5, { worn })], closet })
        .confidence,
    ).toBe("probable");
    expect(
      callFor({ history: [...elsewhere, ...runs(6, { worn })], closet })
        .confidence,
    ).toBe("confident");
  });
});

describe("the runner's verdicts so far (owner, 2026-11-26, #1104)", () => {
  const worn = [wore("zip", "tops")];

  it("counts every verdict, in this band or not, typed weather included", () => {
    const history = [
      ...runs(3, { worn }),
      ...runs(4, { judgedFeelsLikeC: 21, worn }),
      ...runs(2, { precip: "wet", verdict: -1, worn }),
      ...runs(2, { source: "manual", verdict: 2, worn }),
    ];
    const result = callFor({ history });

    expect(result.verdictsSoFar).toBe(11);
    expect(result.personalRunsInBand).toBe(5);
  });

  it("is the count the threshold reads: one short of it, then at it", () => {
    const short = callFor({ history: runs(CALL_VERDICT_THRESHOLD - 1) });
    const at = callFor({ history: runs(CALL_VERDICT_THRESHOLD) });

    expect(short.verdictsSoFar).toBe(CALL_VERDICT_THRESHOLD - 1);
    expect(short.confidence).toBe("below-threshold");
    expect(at.verdictsSoFar).toBe(CALL_VERDICT_THRESHOLD);
    expect(at.confidence).toBe("confident");
  });

  it("is counted with no forecast too", () => {
    const result = callFor({
      conditions: { kind: "none" },
      history: runs(7, { worn }),
    });

    expect(result.verdictsSoFar).toBe(7);
  });
});

describe("what was worn on the band's too-warm runs (owner, 2026-11-26, #1104)", () => {
  const closet = [
    aPiece("zip", "tops", { lowC: 3, highC: 12 }),
    aPiece("tee", "tops", { lowC: 13 }),
    aPiece("vest", "outer", { lowC: -4, highC: 6 }),
  ];

  it("names the pieces of the warm runs in the Call's band and class, by id", () => {
    const result = callFor({
      history: [
        aRun({
          verdict: 1,
          worn: [wore("zip", "tops"), wore("vest", "outer")],
        }),
        aRun({ verdict: 2, worn: [wore("zip", "tops")] }),
        aRun({ verdict: 0, worn: [wore("tee", "tops")] }),
      ],
      closet,
    });

    expect(result.warmRuns).toStrictEqual({
      bandFloorC: 5,
      worn: [
        { pieceId: "vest", group: "outer", estimate: { lowC: -4, highC: 6 } },
        { pieceId: "zip", group: "tops", estimate: { lowC: 3, highC: 12 } },
      ],
    });
  });

  it("reads the same runs the band's warm count does: none from another band or class", () => {
    const result = callFor({
      history: [
        aRun({ verdict: 1, worn: [wore("zip", "tops")] }),
        aRun({
          judgedFeelsLikeC: 21,
          verdict: 2,
          worn: [wore("tee", "tops")],
        }),
        aRun({ precip: "wet", verdict: 1, worn: [wore("vest", "outer")] }),
      ],
      closet,
    });

    expect(result.personalRunsInBand).toBe(1);
    expect(result.warmRuns?.worn.map((piece) => piece.pieceId)).toStrictEqual([
      "zip",
    ]);
  });

  it("is in the band of the hour at its effort, with the runs counted there", () => {
    const result = callFor({
      effort: "workout",
      history: [
        aRun({ verdict: 1, worn: [wore("zip", "tops")] }),
        aRun({
          effort: "workout",
          verdict: 1,
          worn: [wore("tee", "tops")],
        }),
      ],
      closet,
    });

    expect(result.bandFloorC).toBe(10);
    expect(result.warmRuns).toStrictEqual({
      bandFloorC: 10,
      worn: [{ pieceId: "tee", group: "tops", estimate: { lowC: 13 } }],
    });
  });

  it("is absent with no forecast, where there is no band", () => {
    const result = callFor({
      conditions: { kind: "none" },
      history: [aRun({ verdict: 1, worn: [wore("zip", "tops")] })],
      closet,
    });

    expect(result.bandFloorC).toBeUndefined();
    expect(result.warmRuns).toBeUndefined();
  });
});

describe("a Call with no forecast", () => {
  const history = [
    ...runs(6, {
      judgedFeelsLikeC: 21,
      verdict: 0,
      worn: [wore("tee", "tops")],
    }),
    ...runs(2, {
      judgedFeelsLikeC: 12,
      precip: "wet",
      verdict: -1,
      worn: [wore("tee", "tops", "not_enough"), wore("shell", "outer")],
    }),
    ...runs(8, {
      judgedFeelsLikeC: 2,
      verdict: 0,
      worn: [wore("zip", "tops"), wore("shell", "outer")],
    }),
    ...runs(2, { source: "manual", verdict: 0, worn: [wore("tee", "tops")] }),
  ];
  const request = aRequest({
    conditions: { kind: "none" },
    runner: { thermalLevel: 1, climateZone: "minneapolis" },
    history,
    closet: [
      aPiece("tee", "tops", { lowC: 13 }),
      aPiece("zip", "tops", { lowC: 3, highC: 12 }),
      aPiece("shell", "outer"),
      aPiece("cap", "hands_head"),
    ],
    cohort: [
      aCell({ group: "tops", verdicts: verdictCounts({ 0: 40 }) }),
      aCell({ group: "hands_head", groupRunners: 10 }),
    ],
  });

  it("has no band and no class, and counts no runs as in band", () => {
    const result = score(request);

    expect(result.bandFloorC).toBeUndefined();
    expect(result.precip).toBeUndefined();
    expect(result.personalRunsInBand).toBe(0);
  });

  it("is probable for a runner it knows, and no better", () => {
    expect(score(request).confidence).toBe("probable");
  });

  it("answers from every run, band by band, with no cohort and no estimate", () => {
    const result = score(request);
    // Each of the three worn pieces was dialed eight times here.
    const eightDialedOver = (wearsAndFlags: number): number =>
      (8 + PRIOR_NO_ESTIMATE * PERSONAL_PRIOR_STRENGTH) /
      (wearsAndFlags + PERSONAL_PRIOR_STRENGTH);

    expect(result.ranking).toStrictEqual([
      {
        pieceId: "zip",
        group: "tops",
        score: eightDialedOver(8),
        evidence: [
          {
            kind: "personal-piece",
            pieceId: "zip",
            bandFloorC: 0,
            dialed: 8,
            of: 8,
          },
        ],
      },
      {
        pieceId: "shell",
        group: "outer",
        score: eightDialedOver(10),
        evidence: [
          {
            kind: "personal-piece",
            pieceId: "shell",
            bandFloorC: 0,
            dialed: 8,
            of: 8,
          },
          {
            kind: "personal-piece",
            pieceId: "shell",
            bandFloorC: 10,
            dialed: 0,
            of: 2,
          },
        ],
      },
      {
        pieceId: "tee",
        group: "tops",
        score: eightDialedOver(12),
        evidence: [
          {
            kind: "personal-piece",
            pieceId: "tee",
            bandFloorC: 5,
            dialed: 2,
            of: 2,
          },
          {
            kind: "personal-piece",
            pieceId: "tee",
            bandFloorC: 10,
            dialed: 0,
            of: 2,
          },
          {
            kind: "personal-piece",
            pieceId: "tee",
            bandFloorC: 20,
            dialed: 6,
            of: 6,
          },
          {
            kind: "personal-flag",
            pieceId: "tee",
            bandFloorC: 10,
            flag: "not_enough",
            times: 2,
          },
        ],
      },
      {
        pieceId: "cap",
        group: "hands_head",
        score: PRIOR_NO_ESTIMATE,
        evidence: [],
      },
    ]);
  });

  it("fills the kit from every run, and never from the cohort", () => {
    expect(ids(score(request).kit)).toStrictEqual(["zip"]);
  });
});
