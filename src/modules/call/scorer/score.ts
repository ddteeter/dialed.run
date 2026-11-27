import { uiGroups } from "../../../lib/contracts";
import { bandFloorC, precipClassOf } from "../../../lib/contracts/temperature";
import type {
  CallRequest,
  ClosetPiece,
  PersonalRun,
  ScoredPiece,
  Scorer,
} from "../contract";
import { confidenceOf } from "./confidence";
import { feelAtEffortC } from "./effort";
import { evidenceFor } from "./facts";
import { shouldWearGroup } from "./kit";
import { cohortCellFor } from "./ladder";
import {
  bandCount,
  groupRecord,
  pieceCounts,
  pieceRecord,
  scopedRuns,
  type BandCount,
  type CallScope,
  type PieceCount,
} from "./personal";
import {
  bandLeanC,
  cohortBase,
  effectiveFeelC,
  heuristicPrior,
  shrunkScore,
  type EstimateAtFeel,
} from "./shrinkage";
import { ENGINE_VERSION } from "./version";

/**
 * What a forecast makes of the hour: the band and class it falls in, and
 * its feel at the Call's effort.
 *
 * The band is of the feel at effort and nothing else: it is the key the
 * cohort's cells and the runner's past verdicts are counted under. The
 * runner's thermal offset and their lean in the band shift the feel only
 * where it is held against an estimate (`estimateFeelC`).
 */
interface Reading {
  scope: CallScope;
  hourFeelC: number;
}

function readingOf(request: CallRequest): Reading | undefined {
  const { conditions, effort } = request;
  if (conditions.kind !== "forecast") return undefined;
  const hourFeelC = feelAtEffortC(conditions.feelsLikeC, effort);
  return {
    scope: {
      bandFloorC: bandFloorC(hourFeelC),
      precip: precipClassOf(conditions.precipMm),
    },
    hourFeelC,
  };
}

/**
What every piece of one Call is scored against.
*/
interface Counted {
  request: CallRequest;
  reading: Reading | undefined;
  /**
  The runs the Call is answered from (`scopedRuns`).
  */
  runs: readonly PersonalRun[];
  band: BandCount;
  worn: ReadonlyMap<string, readonly PieceCount[]>;
}

/**
 * The feel a piece's estimate is held against: the hour at the Call's
 * effort, as this runner reads it (their thermal offset), shifted by how
 * their verdicts in this band lean. Absent with no forecast.
 */
function estimateFeelC(counted: Counted): number | undefined {
  const { reading, request, band } = counted;
  return reading === undefined
    ? undefined
    : effectiveFeelC(reading.hourFeelC, request.runner.thermalLevel) +
        bandLeanC(band);
}

function estimateAt(
  piece: ClosetPiece,
  feelC: number | undefined,
): EstimateAtFeel | undefined {
  return feelC === undefined || piece.estimate === undefined
    ? undefined
    : { range: piece.estimate, feelC };
}

function scorePiece(piece: ClosetPiece, counted: Counted): ScoredPiece {
  const { request, reading } = counted;
  const { pieceId, group } = piece;
  const counts = counted.worn.get(pieceId) ?? [];
  const cell = cohortCellFor(
    request.cohort,
    request.runner,
    reading?.scope,
    group,
  );
  const estimate = estimateAt(piece, estimateFeelC(counted));
  const base = cohortBase(heuristicPrior(estimate), cell?.verdicts);
  return {
    pieceId,
    group,
    score: shrunkScore(base, pieceRecord(counts)),
    evidence: evidenceFor({
      pieceId,
      scope: reading?.scope,
      band: counted.band,
      counts,
      cell,
      estimate,
    }),
  };
}

/**
 * The ranking's order, and it is total: the higher score first, and
 * between equal scores the lower `pieceId`. Ids are compared in English
 * collation, pinned so the order does not move with the machine's locale;
 * for the ids this app mints (ULIDs) that is their code-unit order.
 */
function bestFirst(a: ScoredPiece, b: ScoredPiece): number {
  return b.score - a.score || a.pieceId.localeCompare(b.pieceId, "en");
}

/**
 * The kit: the best piece of each group the kit takes one from, in the
 * order the closet draws its groups. Never more than one piece a group,
 * and no kit-wide range: the pieces' estimates do not compose (#377).
 */
function kitFrom(
  ranking: readonly ScoredPiece[],
  counted: Counted,
): ScoredPiece[] {
  const { request, reading, runs } = counted;
  return uiGroups.flatMap((group) => {
    const best = ranking.find((piece) => piece.group === group);
    if (best === undefined) return [];
    const cell = cohortCellFor(
      request.cohort,
      request.runner,
      reading?.scope,
      group,
    );
    return shouldWearGroup(group, groupRecord(runs, group), cell) ? [best] : [];
  });
}

/**
 * The Call's scorer (design 194): the runner's verdict history, the
 * cohort's cells and an hour's conditions in; every piece of the closet
 * ranked, with the counted facts behind each, out.
 *
 * Pure. It reads no clock, database, binding or random number, so the
 * same request always gets the same result, in whatever order its
 * history and closet arrive: the replay harness runs this exact function.
 *
 * A runner below the verdict threshold is still ranked, so the teaser can
 * show a line.
 */
export const score: Scorer = (request) => {
  const reading = readingOf(request);
  const runs = scopedRuns(request.history, reading?.scope);
  const counted: Counted = {
    request,
    reading,
    runs,
    band: bandCount(runs),
    worn: pieceCounts(runs),
  };
  const ranking = request.closet
    .map((piece) => scorePiece(piece, counted))
    .toSorted(bestFirst);
  const runsInBand = reading === undefined ? undefined : runs.length;
  return {
    engineVersion: ENGINE_VERSION,
    hourStart: request.hourStart,
    bandFloorC: reading?.scope.bandFloorC,
    precip: reading?.scope.precip,
    confidence: confidenceOf({
      verdicts: request.history.length,
      runsInBand,
    }),
    personalRunsInBand: runsInBand ?? 0,
    kit: kitFrom(ranking, counted),
    ranking,
  };
};
