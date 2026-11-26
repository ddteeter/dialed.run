import type {
  ConditionsSource,
  UiGroup,
  VerdictValue,
} from "../../../lib/contracts";
import {
  bandFloorC,
  type PrecipClass,
} from "../../../lib/contracts/temperature";
import type { ItemFlag, PersonalRun } from "../contract";

/**
 * The band and condition class a Call is for: the key the cohort's cells
 * carry, and the one the runner's own runs are counted under.
 *
 * The band is the 5 °C `bandFloorC` band and the class is `PrecipClass`.
 * Both are readings of design 194's "feels-like band × condition class"
 * (design sprint-a1, open questions 1 and 2).
 */
export interface CallScope {
  bandFloorC: number;
  precip: PrecipClass;
}

const MANUAL: ConditionsSource = "manual";
/**
The verdict that says the kit was right (`verdictScale`).
*/
export const DIALED: VerdictValue = 0;
const TOO_MUCH: ItemFlag = "too_much";

/**
 * The runs the scorer counts: every run but the ones whose conditions a
 * human typed.
 *
 * CLAUDE.md keeps manual weather out of consensus aggregates, published
 * totals and "(later) training". The scorer's counting is read as that
 * training (design sprint-a1, open question 3), and this function is the
 * one place the reading lives.
 */
export function countedRuns(history: readonly PersonalRun[]): PersonalRun[] {
  return history.filter((run) => run.source !== MANUAL);
}

/**
 * The counted runs a Call is answered from: the ones in its band and
 * class, or, with no forecast and so no band, all of them.
 */
export function scopedRuns(
  history: readonly PersonalRun[],
  scope: CallScope | undefined,
): PersonalRun[] {
  const counted = countedRuns(history);
  return scope === undefined
    ? counted
    : counted.filter(
        (run) =>
          bandFloorC(run.judgedFeelsLikeC) === scope.bandFloorC &&
          run.precip === scope.precip,
      );
}

/**
 * How a set of runs felt: the verdicts on the cold side, at dialed, and on
 * the warm side.
 */
export interface BandCount {
  cold: number;
  dialed: number;
  warm: number;
}

function feltAs(verdict: VerdictValue): keyof BandCount {
  if (verdict < DIALED) return "cold";
  return verdict > DIALED ? "warm" : "dialed";
}

export function bandCount(runs: readonly PersonalRun[]): BandCount {
  const count: BandCount = { cold: 0, dialed: 0, warm: 0 };
  for (const run of runs) count[feltAs(run.verdict)] += 1;
  return count;
}

/**
 * One piece's record in one band: the runs it was worn on, how many of
 * them were dialed, and how often the runner flagged it.
 */
export interface PieceCount {
  bandFloorC: number;
  worn: number;
  dialed: number;
  flags: Record<ItemFlag, number>;
}

function emptyCount(floor: number): PieceCount {
  return {
    bandFloorC: floor,
    worn: 0,
    dialed: 0,
    flags: { too_much: 0, not_enough: 0 },
  };
}

/**
 * Every worn piece's record, by piece and then by band, coldest band
 * first. A band a piece was never worn in has no entry.
 *
 * The verdict is the run's, so a piece is "dialed" on a run when the whole
 * kit was: there is no per-piece verdict (#400). The flag is the only
 * thing a runner says about one piece.
 */
export function pieceCounts(
  runs: readonly PersonalRun[],
): ReadonlyMap<string, readonly PieceCount[]> {
  const byPiece = new Map<string, PieceCount[]>();
  for (const run of runs) {
    const floor = bandFloorC(run.judgedFeelsLikeC);
    for (const piece of run.worn) {
      const counts = byPiece.get(piece.pieceId) ?? [];
      let count = counts.find((held) => held.bandFloorC === floor);
      if (count === undefined) {
        count = emptyCount(floor);
        counts.push(count);
      }
      count.worn += 1;
      if (run.verdict === DIALED) count.dialed += 1;
      if (piece.flag !== undefined) count.flags[piece.flag] += 1;
      byPiece.set(piece.pieceId, counts);
    }
  }
  return new Map(
    [...byPiece].map(([pieceId, counts]) => [
      pieceId,
      counts.toSorted((a, b) => a.bandFloorC - b.bandFloorC),
    ]),
  );
}

/**
 * A piece's record over every band it has an entry in: what the score
 * reads.
 */
export interface PieceRecord {
  worn: number;
  dialed: number;
  flagged: number;
}

export function pieceRecord(counts: readonly PieceCount[]): PieceRecord {
  const record: PieceRecord = { worn: 0, dialed: 0, flagged: 0 };
  for (const count of counts) {
    record.worn += count.worn;
    record.dialed += count.dialed;
    for (const times of Object.values(count.flags)) record.flagged += times;
  }
  return record;
}

/**
 * A garment group's record over a set of runs: the runs a piece from it
 * was worn on and the runs none was, and how many of each were dialed.
 */
export interface GroupRecord {
  withRuns: number;
  withDialed: number;
  withoutRuns: number;
  withoutDialed: number;
}

/**
 * Count a group's runs, with and without.
 *
 * A run on which the runner flagged the group's piece as too much is not
 * a dialed run for wearing one, whatever the run's verdict: the runner
 * said, of that piece, that going without would have been better.
 */
export function groupRecord(
  runs: readonly PersonalRun[],
  group: UiGroup,
): GroupRecord {
  const record: GroupRecord = {
    withRuns: 0,
    withDialed: 0,
    withoutRuns: 0,
    withoutDialed: 0,
  };
  for (const run of runs) {
    const worn = run.worn.filter((piece) => piece.group === group);
    const isDialed = run.verdict === DIALED;
    if (worn.length === 0) {
      record.withoutRuns += 1;
      if (isDialed) record.withoutDialed += 1;
    } else {
      record.withRuns += 1;
      if (isDialed && worn.every((piece) => piece.flag !== TOO_MUCH)) {
        record.withDialed += 1;
      }
    }
  }
  return record;
}
