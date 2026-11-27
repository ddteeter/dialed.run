/**
 * One Call per state of screen B2, each a `CallResult` put through the
 * real `b2View` and `screenFacts`: the screen's tests draw what the view
 * model gives and type no view by hand. The results are built by hand, on
 * the evidence tests' builders, and modelled on Round 62's boards.
 */
import type { TempUnit } from "../../../src/lib/contracts";
import type { CallResult } from "../../../src/modules/call/contract";
import { b2View, type B2View } from "../../../src/modules/call/evidence";
import { screenFacts } from "../../../src/modules/call/screen";
import type { ScreenFacts } from "../../../src/modules/call/screen/facts";
import { names, piece, result } from "../evidence/fixtures";

export const NAMES = names({
  zip: "Merino half-zip",
  tee: "tee",
  tights: "Winter tights",
  shorts: "shorts",
  vest: "vest",
  beanie: "Thermal beanie",
  gloves: "gloves",
  pegasus: "Pegasus",
  racers: "racers",
  socks: "Trail socks",
  singlet: "Singlet",
  split: "Split shorts",
  cap: "Mesh cap",
});

export interface Drawn {
  result: CallResult;
  view: B2View;
  facts: ScreenFacts;
}

export function drawnFrom(call: CallResult, unit: TempUnit = "f"): Drawn {
  const view = b2View(call, { unit, names: NAMES });
  return { result: call, view, facts: screenFacts(call, view, NAMES) };
}

// The 0 °C band, 32–41° to a runner reading °F.
const BAND = 0;

const ZIP = piece("zip", "tops", [
  {
    kind: "personal-piece",
    pieceId: "zip",
    bandFloorC: BAND,
    dialed: 8,
    of: 9,
  },
  { kind: "personal-band", bandFloorC: BAND, cold: 2, dialed: 2, warm: 0 },
]);
const TIGHTS = piece("tights", "bottoms", [
  {
    kind: "personal-flag",
    pieceId: "tights",
    bandFloorC: BAND,
    flag: "too_much",
    times: 1,
  },
]);
const BEANIE = piece("beanie", "hands_head", [
  {
    kind: "cohort-share",
    group: "hands_head",
    rung: "zone",
    climateZone: "Cfb",
    bandFloorC: BAND,
    groupRunners: 39,
    bandRunners: 50,
  },
]);
const SOCKS = piece("socks", "socks_extras");

const KIT = [ZIP, TIGHTS, BEANIE, SOCKS];

/**
 * The pieces the kit left out, one a group, best first in an order that
 * is not the closet's group order: the screen has to put them in it.
 */
const LEFT_OUT = [
  piece("racers", "shoes"),
  piece("gloves", "hands_head", [
    {
      kind: "personal-flag",
      pieceId: "gloves",
      bandFloorC: BAND,
      flag: "too_much",
      times: 2,
    },
  ]),
  piece("vest", "outer"),
  piece("shorts", "bottoms"),
  piece("tee", "tops"),
];

/**
 * Round 62's "B2 probable": four pieces, each with a different line form,
 * both sentences of the paragraph, and five why-nots.
 */
export function probableCall(overrides: Partial<CallResult> = {}): CallResult {
  return result({
    bandFloorC: BAND,
    confidence: "probable",
    personalRunsInBand: 4,
    kit: KIT,
    ranking: [...KIT, ...LEFT_OUT],
    ...overrides,
  });
}

/**
 * The same Call with the runs to be sure of it.
 */
export function confidentCall(): CallResult {
  return probableCall({ confidence: "confident", personalRunsInBand: 11 });
}

// The 25 °C band, 77–86°.
const WARM_BAND = 25;

function cohortShare(group: "tops" | "bottoms", groupRunners: number) {
  return {
    kind: "cohort-share" as const,
    group,
    rung: "zone" as const,
    climateZone: "Cfb",
    bandFloorC: WARM_BAND,
    groupRunners,
    bandRunners: 100,
  };
}

/**
 * Round 62's "C1b borrowed at home": no run of the runner's own in the
 * band, so the kit leans on the cohort and the estimates.
 */
export function borrowedCall(): CallResult {
  const kit = [
    piece("singlet", "tops", [cohortShare("tops", 81)]),
    piece("split", "bottoms", [cohortShare("bottoms", 74)]),
    piece("cap", "hands_head", [
      { kind: "estimate", pieceId: "cap", range: { lowC: 20, highC: 32 } },
    ]),
  ];
  return result({
    bandFloorC: WARM_BAND,
    confidence: "borrowed",
    personalRunsInBand: 0,
    kit,
    ranking: [...kit, piece("vest", "outer")],
  });
}

/**
 * Round 62's "C0a no forecast": no band, so the Call is answered from all
 * the runner's runs, 23 of them, and each fact names the band it is from.
 */
export function noForecastCall(): CallResult {
  const kit = [
    piece("zip", "tops", [
      {
        kind: "personal-piece",
        pieceId: "zip",
        bandFloorC: 5,
        dialed: 14,
        of: 17,
      },
      { kind: "personal-band", bandFloorC: 5, cold: 3, dialed: 14, warm: 0 },
    ]),
    piece("tights", "bottoms", [
      { kind: "personal-band", bandFloorC: 5, cold: 3, dialed: 14, warm: 0 },
    ]),
    SOCKS,
  ];
  return result({
    bandFloorC: undefined,
    precip: undefined,
    confidence: "probable",
    verdictsSoFar: 23,
    personalRunsInBand: 0,
    kit,
    ranking: [...kit, piece("vest", "outer"), piece("tee", "tops")],
  });
}

/**
 * C0b: eight verdicts, seven short of a Call. Only its count header is
 * read: whether the view lists a kit below the threshold is the engine's
 * (QUESTIONS.md, A4 Q2), and the screen draws none either way.
 */
export function belowThresholdCall(verdictsSoFar = 8): CallResult {
  return probableCall({ confidence: "below-threshold", verdictsSoFar });
}
