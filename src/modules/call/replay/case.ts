/**
 * The replay input (design 194, "Replay and tuning"): a Call request and
 * what followed it. Shaped so a row of the call log's pseudonymised export
 * maps onto it field for field once that export exists.
 */
import type { VerdictValue } from "../../../lib/contracts";
import type { PrecipClass } from "../../../lib/contracts/temperature";
import type {
  CallConditions,
  CallRequest,
  ClosetPiece,
  CohortCell,
  PersonalRun,
  WornPiece,
} from "../contract";

/**
 * One runner's runs with verdicts, in any order, and what they could wear.
 */
export interface ReplayHistory {
  /**
   * A pseudonym: replay never needs to know who the runner is.
   */
  runnerId: string;
  runner: CallRequest["runner"];
  closet: readonly ClosetPiece[];
  runs: readonly PersonalRun[];
}

/**
 * Where a case's request came from: `logged`, the Call as served; or
 * `rebuilt` by `casesFrom` from a run with a verdict, whose forecast is
 * only the judged feel and precipitation class (owner, 2026-11-26).
 */
export type CaseOrigin = "rebuilt" | "logged";

/**
 * The forecast fields a scorer may read. A rebuilt case carries no real
 * temperature or wind, so a scorer that reads either cannot be released on
 * rebuilt cases alone (`noWorse`).
 */
export type ConditionRead = Exclude<
  keyof Extract<CallConditions, { kind: "forecast" }>,
  "kind"
>;

/**
 * A request and what the runner did after it: the pieces worn and the
 * verdict given. For a logged Call the request is the one served; for a
 * run from before the Call existed it is rebuilt by `casesFrom`.
 */
export interface ReplayCase {
  caseId: string;
  runnerId: string;
  origin: CaseOrigin;
  request: CallRequest;
  worn: readonly WornPiece[];
  verdict: VerdictValue;
}

const HOUR_S = 3600;

/**
 * A stored run keeps only its precipitation class, so the rebuilt forecast
 * carries a millimetre figure inside that class (`precipClassOf` reads each
 * back as its own class; a test pins it).
 */
export const PRECIP_MM: Readonly<Record<PrecipClass, number>> = {
  dry: 0,
  damp: 1,
  wet: 5,
};

/**
 * Which runs become cases. A manual-weather run's feel was typed by its
 * runner, so it is not a forecast to test a Call against. It still counts
 * as history: every earlier run, manual weather included, goes into the
 * request, as the scorer's personal layer reads it (owner, 2026-11-26).
 */
export function isCaseRun(run: PersonalRun): boolean {
  return run.source !== "manual";
}

function forecastFor(run: PersonalRun): CallConditions {
  return {
    kind: "forecast",
    tempC: run.judgedFeelsLikeC,
    feelsLikeC: run.judgedFeelsLikeC,
    precipMm: PRECIP_MM[run.precip],
    windKph: 0,
  };
}

/**
 * One case per case run, oldest first, with no leakage: the request for a
 * run carries as history only the runs that started strictly before it,
 * and that run's own judged conditions as the forecast.
 *
 * The cohort is passed as one snapshot for every case. The export should
 * carry the cells each logged Call actually read.
 */
export function casesFrom(
  history: ReplayHistory,
  cohort: readonly CohortCell[],
): ReplayCase[] {
  const runs = history.runs.toSorted((a, b) => a.startedAt - b.startedAt);
  return runs
    .filter((run) => isCaseRun(run))
    .map((run) => ({
      caseId: run.runId,
      runnerId: history.runnerId,
      origin: "rebuilt",
      request: {
        hourStart: Math.floor(run.startedAt / HOUR_S) * HOUR_S,
        effort: run.effort,
        conditions: forecastFor(run),
        runner: history.runner,
        history: runs.filter((earlier) => earlier.startedAt < run.startedAt),
        closet: history.closet,
        cohort,
      },
      worn: run.worn,
      verdict: run.verdict,
    }));
}
