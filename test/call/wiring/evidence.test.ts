/**
 * The scorer and the evidence lines, wired: the real `score` answers, and
 * `b2View` turns the answer into what a runner would read on B2. One
 * persona per confidence the scorer gives.
 */
import { describe, expect, it } from "vitest";

import type {
  CallRequest,
  CallResult,
} from "../../../src/modules/call/contract";
import {
  b2View,
  whyNot,
  type B2View,
} from "../../../src/modules/call/evidence";
import { score } from "../../../src/modules/call/scorer";
import {
  aCell,
  aForecast,
  aPiece,
  aRequest,
  aRun,
  runs,
  verdictCounts,
  wore,
} from "../scorer/builders";

const CLOSET = [
  aPiece("zip", "tops", { lowC: 3, highC: 12 }),
  aPiece("tee", "tops", { lowC: 13 }),
  aPiece("tights", "bottoms", { lowC: -7, highC: 4 }),
  aPiece("shorts", "bottoms", { lowC: 4 }),
  aPiece("vest", "outer", { lowC: -4, highC: 6 }),
  aPiece("pegasus", "shoes"),
];

const NAMES: ReadonlyMap<string, string> = new Map([
  ["zip", "half-zip"],
  ["tee", "grey tee"],
  ["tights", "tights"],
  ["shorts", "split shorts"],
  ["vest", "vest"],
  ["pegasus", "Pegasus"],
]);

const SUMMER_KIT = [
  wore("tee", "tops"),
  wore("shorts", "bottoms"),
  wore("pegasus", "shoes"),
];

/**
Dialed summer runs, in a band no Call below asks about.
*/
function summerRuns(count: number) {
  return runs(count, { judgedFeelsLikeC: 22, worn: SUMMER_KIT });
}

const WINTER_KIT = [
  wore("zip", "tops"),
  wore("tights", "bottoms"),
  wore("pegasus", "shoes"),
];

/**
The kit of the confident runner's too-warm runs, the vest flagged or not.
*/
function warmKit(flag?: "too_much") {
  return [
    wore("zip", "tops"),
    wore("shorts", "bottoms"),
    wore("vest", "outer", flag),
    wore("pegasus", "shoes"),
  ];
}

function answered(request: CallRequest, unit: "f" | "c") {
  const result: CallResult = score(request);
  const view: B2View = b2View(result, { unit, names: NAMES });
  return { result, view };
}

function line(pieceId: string, name: string, shown: string, said: string) {
  return { pieceId, name, line: { shown, said } };
}

/**
The summer kit, every piece reading the same line.
*/
function summerKitReading(shown: string, said: string) {
  return [
    line("tee", "grey tee", shown, said),
    line("shorts", "split shorts", shown, said),
    line("pegasus", "Pegasus", shown, said),
  ];
}

describe("B2 for a runner the Call is confident about", () => {
  // Seven runs in the 5 °C dry band: five dialed in the summer kit, two too
  // warm in the half-zip and the vest, the vest flagged on one of them.
  const request = aRequest({
    history: [
      ...summerRuns(10),
      ...runs(5, { worn: SUMMER_KIT }),
      aRun({ verdict: 1, worn: warmKit("too_much") }),
      aRun({ verdict: 2, worn: warmKit() }),
    ],
    closet: CLOSET,
  });

  it("is what the scorer answered: confident, with the warm runs' kit", () => {
    const { result } = answered(request, "f");

    expect(result.confidence).toBe("confident");
    expect(result.verdictsSoFar).toBe(17);
    expect(result.personalRunsInBand).toBe(7);
    expect(result.kit.map((piece) => piece.pieceId)).toStrictEqual([
      "tee",
      "shorts",
      "pegasus",
    ]);
    expect(result.warmRuns?.worn.map((piece) => piece.pieceId)).toStrictEqual([
      "pegasus",
      "shorts",
      "vest",
      "zip",
    ]);
  });

  it("reads as a kit to wear, each piece with its own record", () => {
    expect(answered(request, "f").view).toStrictEqual({
      header: {
        kind: "call",
        title: {
          shown: "CONFIDENT · [7 RUNS] IN BAND",
          said: "Confident, 7 runs in band",
        },
        verb: "WEAR THIS",
      },
      pieces: [
        line(
          "tee",
          "grey tee",
          "DIALED [5 OF 5] · [41–50°]",
          "Dialed 5 of 5, 41 to 50 degrees",
        ),
        line(
          "shorts",
          "split shorts",
          "DIALED [5 OF 7] · [41–50°]",
          "Dialed 5 of 7, 41 to 50 degrees",
        ),
        line(
          "pegasus",
          "Pegasus",
          "DIALED [5 OF 7] · [41–50°]",
          "Dialed 5 of 7, 41 to 50 degrees",
        ),
      ],
      paragraph:
        "You've been too warm twice in this band. Skip the vest — too much once in this band.",
      whyNot: ["tights", "zip", "vest"],
    });
  });

  it("says the warm line because the kit dropped the vest worn on those runs", () => {
    const { result } = answered(request, "f");
    const stillInTheVest: CallResult = {
      ...result,
      warmRuns: { bandFloorC: 5, worn: [] },
    };

    expect(b2View(stillInTheVest, { unit: "f", names: NAMES }).paragraph).toBe(
      "Skip the vest — too much once in this band.",
    );
  });

  it("answers why not for each piece it offers one for", () => {
    const { result, view } = answered(request, "f");

    expect(view.whyNot.map((id) => whyNot(result, id, NAMES))).toStrictEqual([
      {
        question: "Why not the tights?",
        answer:
          "The split shorts is dialed 5 of 7 in this band. The tights has no verdicts here yet.",
      },
      {
        question: "Why not the half-zip?",
        answer:
          "The grey tee is dialed 5 of 5 in this band. The half-zip, 0 of 2.",
      },
      {
        question: "Why not the vest?",
        answer: "You told us the vest was too much once in this band.",
      },
    ]);
  });
});

describe("B2 for a runner with a few runs in the band", () => {
  // Three runs in the -5 °C band: two too cold, one dialed, all in one kit.
  const request = aRequest({
    conditions: aForecast(-3),
    history: [
      ...summerRuns(12),
      ...runs(2, { judgedFeelsLikeC: -2, verdict: -1, worn: WINTER_KIT }),
      aRun({ judgedFeelsLikeC: -4, verdict: 0, worn: WINTER_KIT }),
    ],
    closet: CLOSET,
  });

  it("reads as probable, in the reader's unit, and says how often they were cold", () => {
    const { result, view } = answered(request, "c");

    expect(result.confidence).toBe("probable");
    expect(view).toStrictEqual({
      header: {
        kind: "call",
        title: {
          shown: "PROBABLE · [3 RUNS] IN BAND",
          said: "Probable, 3 runs in band",
        },
        verb: "PROBABLY WEAR",
      },
      pieces: [
        line(
          "zip",
          "half-zip",
          "DIALED [1 OF 3] · [-5–0°]",
          "Dialed 1 of 3, minus 5 to 0 degrees",
        ),
        line(
          "tights",
          "tights",
          "DIALED [1 OF 3] · [-5–0°]",
          "Dialed 1 of 3, minus 5 to 0 degrees",
        ),
        line(
          "pegasus",
          "Pegasus",
          "DIALED [1 OF 3] · [-5–0°]",
          "Dialed 1 of 3, minus 5 to 0 degrees",
        ),
      ],
      paragraph: "You've been too cold twice in this band.",
      whyNot: ["vest", "shorts", "tee"],
    });
  });
});

describe("B2 for a runner with no run in the band", () => {
  // Fifteen summer runs, and a Call for a 27 °C hour: the 25 °C band, where
  // only the cohort has anything, the tops from the runner's own climate.
  const request = aRequest({
    conditions: aForecast(27),
    runner: { climateZone: "Cfb" },
    history: summerRuns(15),
    closet: CLOSET,
    cohort: [
      aCell({
        rung: "zone",
        climateZone: "Cfb",
        bandFloorC: 25,
        group: "tops",
        bandRunners: 10,
        groupRunners: 9,
        verdicts: verdictCounts({ 0: 12, 1: 3 }),
      }),
      aCell({
        bandFloorC: 25,
        group: "bottoms",
        bandRunners: 40,
        groupRunners: 31,
        verdicts: verdictCounts({ 0: 30 }),
      }),
    ],
  });

  it("reads as borrowed, and says whose runs it leans on", () => {
    const { result, view } = answered(request, "f");

    expect(result.confidence).toBe("borrowed");
    expect(view.header).toStrictEqual({
      kind: "call",
      title: { shown: "BORROWED CALL", said: "BORROWED CALL" },
      body: {
        shown:
          "You've logged 0 runs in 77–86°. This comes from runners in your climate, not from you.",
        said: "You've logged 0 runs in 77 to 86 degrees. This comes from runners in your climate, not from you.",
      },
      verb: "PROBABLY WEAR",
    });
    expect(view.paragraph).toBeUndefined();
    expect(view.whyNot).toStrictEqual(["tights", "zip", "vest"]);
  });

  it("carries the cohort's share on the tee, though the line shown is the band's empty record (QUESTIONS.md, A4 Q1)", () => {
    const { result, view } = answered(request, "f");
    const tee = result.kit.find((piece) => piece.pieceId === "tee");

    expect(tee?.evidence).toContainEqual({
      kind: "cohort-share",
      group: "tops",
      rung: "zone",
      climateZone: "Cfb",
      bandFloorC: 25,
      groupRunners: 9,
      bandRunners: 10,
    });
    expect(view.pieces).toStrictEqual(
      summerKitReading("[0 RUNS] IN [77–86°]", "0 runs in 77 to 86 degrees"),
    );
  });
});

describe("B2 for a runner below the verdict threshold", () => {
  const request = aRequest({
    history: runs(8, { worn: SUMMER_KIT }),
    closet: CLOSET,
  });

  it("counts down to the first Call from the result's own verdict count", () => {
    const { result, view } = answered(request, "f");

    expect(result.confidence).toBe("below-threshold");
    expect(result.verdictsSoFar).toBe(8);
    expect(view.header).toStrictEqual({
      kind: "count",
      title: "UNTIL YOUR FIRST CALL",
      remaining: 7,
      noun: "more verdicts",
    });
  });

  it("still lists the scorer's kit under the count (QUESTIONS.md, A4 Q2)", () => {
    const { view } = answered(request, "f");

    expect(view.pieces).toStrictEqual(
      summerKitReading(
        "DIALED [8 OF 8] · [41–50°]",
        "Dialed 8 of 8, 41 to 50 degrees",
      ),
    );
    expect(view.paragraph).toBeUndefined();
    expect(view.whyNot).toStrictEqual(["zip", "vest", "tights"]);
  });
});
