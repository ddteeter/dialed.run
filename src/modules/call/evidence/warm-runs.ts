/**
 * What the runner wore on their too-warm runs in a band: the fact the warm
 * line needs and `EvidenceFact` does not carry (`personal-band` counts
 * runs only). Proposed as a contract addition, to land with
 * `verdictsSoFar` in the scorer's PR (QUESTIONS.md Q10); until then
 * nothing passes it in and the warm line never shows.
 */
import type { UiGroup } from "../../../lib/contracts";
import type { TempRange } from "../../../lib/contracts/thermal";
import type { ScoredPiece } from "../contract";

export interface WarmRunsWorn {
  /**
   * `bandFloorC` of the band the runs were in.
   */
  bandFloorC: number;
  /**
   * Each piece worn on those runs, once.
   */
  worn: readonly {
    pieceId: string;
    group: UiGroup;
    estimate?: TempRange | undefined;
  }[];
}

function estimateLow(piece: ScoredPiece): number | undefined {
  for (const fact of piece.evidence) {
    if (fact.kind === "estimate" && fact.pieceId === piece.pieceId) {
      return fact.range.lowC;
    }
  }
  return undefined;
}

/**
 * Whether a swap is lighter: the kit's piece starts working at a warmer
 * temperature than the one worn then (owner, 2026-11-26). Unknown when
 * either has no low end, and unknown is not lighter.
 */
function isLighterSwap(
  now: number | undefined,
  then: number | undefined,
): boolean {
  return (now ?? -Infinity) > (then ?? Infinity);
}

/**
 * Whether the kit is lighter than what the runner wore on their too-warm
 * runs in this band: a group they wore then is absent now, or a piece then
 * is replaced in its group by a lighter one. Never, without the fact or
 * when the fact is for another band.
 */
export function isLighterThanWarmRuns(
  kit: readonly ScoredPiece[],
  warmRuns: WarmRunsWorn | undefined,
  band: number | undefined,
): boolean {
  if (warmRuns === undefined || warmRuns.bandFloorC !== band) return false;
  return warmRuns.worn.some((then) => {
    const now = kit.find((piece) => piece.group === then.group);
    return (
      now === undefined ||
      (now.pieceId !== then.pieceId &&
        isLighterSwap(estimateLow(now), then.estimate?.lowC))
    );
  });
}
