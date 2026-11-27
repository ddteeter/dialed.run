import type { TempRange } from "../../../lib/contracts/thermal";
import type { PersonalRun } from "../contract";
import { DIALED } from "./personal";

/**
 * The range a piece has worked at, from the runner's own verdicts (#386):
 * the coldest and the warmest feel of the runs it was worn on that were
 * dialed, leaving out any the runner flagged the piece on. Nothing until
 * there is such a run. The feel is the run's own judged feel, not shifted
 * for effort: this is a range to show beside the weather.
 *
 * A record of where the piece has worked, not a limit on where it could:
 * one dialed run gives a range one point wide. Not wired into the closet
 * here; that is the closet's change to make.
 */
export function workedRange(
  pieceId: string,
  history: readonly PersonalRun[],
): TempRange | undefined {
  const feels = history
    .filter(
      (run) =>
        run.verdict === DIALED &&
        run.worn.some(
          (piece) => piece.pieceId === pieceId && piece.flag === undefined,
        ),
    )
    .map((run) => run.judgedFeelsLikeC);
  return feels.length === 0
    ? undefined
    : { lowC: Math.min(...feels), highC: Math.max(...feels) };
}
