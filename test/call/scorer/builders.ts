/**
 * Builders for the scorer's tests: a request and its parts, each with
 * plain defaults a test overrides only where it is about them.
 */
import type { UiGroup, VerdictValue } from "../../../src/lib/contracts";
import type {
  CallConditions,
  CallRequest,
  ClosetPiece,
  CohortCell,
  ItemFlag,
  PersonalRun,
  WornPiece,
} from "../../../src/modules/call/contract";

export function wore(
  pieceId: string,
  group: UiGroup,
  flag?: ItemFlag,
): WornPiece {
  return { pieceId, group, flag };
}

const minted = { runs: 0 };

/**
A counted run at 7 °C, dry, dialed, in nothing, unless told otherwise.
*/
export function aRun(overrides: Partial<PersonalRun> = {}): PersonalRun {
  minted.runs += 1;
  return {
    runId: `run-${String(minted.runs)}`,
    startedAt: 1_800_000_000 + minted.runs,
    judgedFeelsLikeC: 7,
    precip: "dry",
    source: "visualcrossing",
    verdict: 0,
    worn: [],
    ...overrides,
  };
}

/**
So many runs, all alike but for their ids.
*/
export function runs(
  count: number,
  overrides: Partial<PersonalRun> = {},
): PersonalRun[] {
  return Array.from({ length: count }, () => aRun(overrides));
}

export function aPiece(
  pieceId: string,
  group: UiGroup,
  estimate?: ClosetPiece["estimate"],
): ClosetPiece {
  return { pieceId, group, estimate };
}

/**
Verdict counts, zero wherever a test names none.
*/
export function verdictCounts(
  counts: Partial<Record<VerdictValue, number>> = {},
): Record<VerdictValue, number> {
  return { [-2]: 0, [-1]: 0, 0: 0, 1: 0, 2: 0, ...counts };
}

/**
An `everyone` cell for tops at the 5 °C band, dry, ten runners deep.
*/
export function aCell(overrides: Partial<CohortCell> = {}): CohortCell {
  return {
    rung: "everyone",
    bandFloorC: 5,
    precip: "dry",
    group: "tops",
    bandRunners: 10,
    groupRunners: 10,
    verdicts: verdictCounts(),
    ...overrides,
  };
}

/**
A forecast that feels like this, dry unless given rain.
*/
export function aForecast(feelsLikeC: number, precipMm = 0): CallConditions {
  return {
    kind: "forecast",
    tempC: feelsLikeC,
    feelsLikeC,
    precipMm,
    windKph: 0,
  };
}

/**
A Call for a dry hour that feels like 7 °C (the 5 °C band), with nothing known.
*/
export function aRequest(overrides: Partial<CallRequest> = {}): CallRequest {
  return {
    hourStart: 1_900_000_000,
    conditions: aForecast(7),
    runner: {},
    history: [],
    closet: [],
    cohort: [],
    ...overrides,
  };
}
