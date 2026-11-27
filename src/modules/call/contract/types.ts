/**
 * The Call's shared contract (design 194): what the scorer reads and what
 * it answers. Types, and one runtime value: `CONFIDENCES`, the list
 * `Confidence` is derived from.
 *
 * The scorer, the evidence lines and the replay harness are all built
 * against it, so a change here is a change to all three. A part that
 * needs one writes it in QUESTIONS.md and keeps any new type in its own
 * sub-module until the owner approves it.
 */
import type { z } from "zod";

import type {
  ConditionsSource,
  Effort,
  itemFlagSchema,
  UiGroup,
  VerdictValue,
} from "../../../lib/contracts";
import type { PrecipClass } from "../../../lib/contracts/temperature";
import type { TempRange } from "../../../lib/contracts/thermal";

export type ItemFlag = z.infer<typeof itemFlagSchema>;

/**
 * A piece worn on a past run, with the runner's optional flag on it.
 */
export interface WornPiece {
  pieceId: string;
  group: UiGroup;
  flag?: ItemFlag | undefined;
}

/**
 * One of the runner's own runs with a verdict: the personal layer, read
 * live, so a runner's newest verdict changes their next Call.
 */
export interface PersonalRun {
  runId: string;
  /**
   * The run's start, in epoch seconds.
   */
  startedAt: number;
  /**
   * The feel the verdict was given at (`judgedFeelsLikeC`).
   */
  judgedFeelsLikeC: number;
  precip: PrecipClass;
  source: ConditionsSource;
  verdict: VerdictValue;
  effort?: Effort | undefined;
  worn: readonly WornPiece[];
}

/**
 * A piece the Call may choose. Retired pieces are never passed in.
 */
export interface ClosetPiece {
  pieceId: string;
  group: UiGroup;
  /**
   * The stored estimate, else the thermal tables' guess; absent when
   * neither gives one.
   */
  estimate?: TempRange | undefined;
}

/**
 * The cohort's backoff ladder, narrowest first (design 194, "Cohort shape").
 */
export type CohortRung = "zone-and-thermal" | "zone" | "everyone";

/**
 * One cohort cell: a feels-like band, a condition class and a garment
 * group, on one rung of the ladder.
 */
export interface CohortCell {
  rung: CohortRung;
  /**
   * Present on the two zone rungs.
   */
  climateZone?: string | undefined;
  /**
   * Present on the narrowest rung: `thermalLevelSchema`'s -2..2.
   */
  thermalLevel?: number | undefined;
  /**
   * `bandFloorC` of the band.
   */
  bandFloorC: number;
  precip: PrecipClass;
  group: UiGroup;
  /**
   * Distinct runners with a counted verdict in this band and class on this
   * rung, whatever they wore.
   */
  bandRunners: number;
  /**
   * Distinct runners among them who wore a piece from this group.
   */
  groupRunners: number;
  /**
   * Verdicts of the counted runs in which this group was worn.
   */
  verdicts: Readonly<Record<VerdictValue, number>>;
}

/**
 * What the Call is asked about. Without a forecast the scorer answers from
 * the runner's bands alone.
 */
export type CallConditions =
  | {
      kind: "forecast";
      tempC: number;
      feelsLikeC: number;
      precipMm: number;
      windKph: number;
    }
  | { kind: "none" };

export interface CallRequest {
  /**
   * The hour the Call answers for, in epoch seconds. A Call is always for
   * an hour, never a day.
   */
  hourStart: number;
  effort?: Effort | undefined;
  conditions: CallConditions;
  runner: {
    thermalLevel?: number | undefined;
    climateZone?: string | undefined;
  };
  history: readonly PersonalRun[];
  closet: readonly ClosetPiece[];
  cohort: readonly CohortCell[];
}

/**
 * How much the Call knows here, least first: the order the replay harness
 * ranks results in. `below-threshold` means too few verdicts for any
 * Call; `best-guess` means none of its own (O5); `borrowed` means none in
 * this band (C1b).
 */
export const CONFIDENCES = [
  "below-threshold",
  "best-guess",
  "borrowed",
  "probable",
  "confident",
] as const;

export type Confidence = (typeof CONFIDENCES)[number];

/**
 * A counted fact behind a pick. Evidence lines are templates over these,
 * never generated text.
 */
export type EvidenceFact =
  | {
      kind: "personal-band";
      bandFloorC: number;
      cold: number;
      dialed: number;
      warm: number;
    }
  | {
      kind: "personal-piece";
      pieceId: string;
      bandFloorC: number;
      dialed: number;
      of: number;
    }
  | {
      kind: "personal-flag";
      pieceId: string;
      bandFloorC: number;
      flag: ItemFlag;
      times: number;
    }
  | {
      kind: "cohort-share";
      group: UiGroup;
      rung: CohortRung;
      climateZone?: string | undefined;
      bandFloorC: number;
      groupRunners: number;
      bandRunners: number;
    }
  | { kind: "estimate"; pieceId: string; range: TempRange };

export interface ScoredPiece {
  pieceId: string;
  group: UiGroup;
  /**
   * Comparable only within one result.
   */
  score: number;
  evidence: readonly EvidenceFact[];
}

export interface CallResult {
  engineVersion: string;
  hourStart: number;
  /**
   * Absent when there is no forecast.
   */
  bandFloorC?: number | undefined;
  precip?: PrecipClass | undefined;
  confidence: Confidence;
  /**
   * The runner's own counted runs in this band and class.
   */
  personalRunsInBand: number;
  /**
   * At most one piece per group.
   */
  kit: readonly ScoredPiece[];
  /**
   * Every candidate, best first. The call log keeps it.
   */
  ranking: readonly ScoredPiece[];
}

/**
 * A scorer version. Pure: the same request always gets the same result.
 */
export type Scorer = (request: CallRequest) => CallResult;
