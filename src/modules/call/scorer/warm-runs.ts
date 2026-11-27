import type {
  ClosetPiece,
  PersonalRun,
  WarmRunsWorn,
  WornPiece,
} from "../contract";
import { DIALED } from "./personal";

/**
 * What the runner wore on the too-warm runs among the ones a Call is
 * answered from (owner, 2026-11-26, #1104): each piece once, in `pieceId`
 * order, so the answer does not move with the order the history arrives in.
 *
 * The runs are the Call's own counted runs (`scopedRuns`), so this and the
 * band's `warm` count are about the same runs. A piece's group is the one
 * it was worn as; its estimate is the closet's, and absent for a piece the
 * closet no longer holds (a retired one) or has no estimate for.
 */
export function warmRunsWorn(
  runs: readonly PersonalRun[],
  closet: readonly ClosetPiece[],
  bandFloorC: number,
): WarmRunsWorn {
  const estimates = new Map(
    closet.map((piece) => [piece.pieceId, piece.estimate]),
  );
  const worn = new Map<string, WornPiece>();
  for (const run of runs) {
    if (run.verdict > DIALED) {
      for (const piece of run.worn) worn.set(piece.pieceId, piece);
    }
  }
  return {
    bandFloorC,
    worn: [...worn]
      .toSorted(([a], [b]) => a.localeCompare(b, "en"))
      .map(([pieceId, { group }]) => ({
        pieceId,
        group,
        estimate: estimates.get(pieceId),
      })),
  };
}
