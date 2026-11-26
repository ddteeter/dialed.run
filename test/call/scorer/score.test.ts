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
      personalRunsInBand: 0,
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

  it("does not count a run whose weather a human typed (reading 3)", () => {
    const measured = runs(2, { verdict: 0, worn: [wore("zip", "tops")] });
    const typed = runs(3, {
      source: "manual",
      verdict: -2,
      worn: [wore("zip", "tops", "not_enough")],
    });
    const closet = [aPiece("zip", "tops")];

    expect(
      callFor({ history: [...typed, ...measured], closet }).ranking,
    ).toStrictEqual(callFor({ history: measured, closet }).ranking);
  });

  it("does not read effort (reading 5)", () => {
    const request = aFullRequest();
    const hard: CallRequest = {
      ...request,
      effort: "race",
      history: request.history.map((run) => ({ ...run, effort: "workout" })),
    };

    expect(score(hard)).toStrictEqual(score(request));
  });

  it("does not read a cohort cell below the privacy floor", () => {
    const thin = aCell({
      group: "tops",
      bandRunners: 4,
      verdicts: verdictCounts({ 0: 40 }),
    });
    const closet = [aPiece("tee", "tops")];

    expect(callFor({ closet, cohort: [thin] })).toStrictEqual(
      callFor({ closet }),
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

  it("counts typed-weather verdicts toward the threshold, as the teaser's ladder does", () => {
    const history = [
      ...runs(9, { worn }),
      ...runs(CALL_VERDICT_THRESHOLD - 9, { source: "manual", worn }),
    ];
    const result = callFor({ history, closet });

    expect(result.confidence).toBe("confident");
    expect(result.personalRunsInBand).toBe(9);
  });

  it("is a best guess when every verdict was on typed weather", () => {
    const history = runs(CALL_VERDICT_THRESHOLD, { source: "manual", worn });

    expect(callFor({ history, closet }).confidence).toBe("best-guess");
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

  it("answers from every counted run, band by band, with no cohort and no estimate", () => {
    const result = score(request);
    const scoreOf = (dialed: number, of: number, flagged: number): number =>
      (dialed + PRIOR_NO_ESTIMATE * PERSONAL_PRIOR_STRENGTH) /
      (of + flagged + PERSONAL_PRIOR_STRENGTH);

    expect(result.ranking).toStrictEqual([
      {
        pieceId: "zip",
        group: "tops",
        score: scoreOf(8, 8, 0),
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
        score: scoreOf(8, 10, 0),
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
        score: scoreOf(6, 8, 2),
        evidence: [
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

  it("fills the kit from every counted run, and never from the cohort", () => {
    expect(ids(score(request).kit)).toStrictEqual(["zip"]);
  });
});
