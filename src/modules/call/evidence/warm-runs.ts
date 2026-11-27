/**
 * Whether the kit is lighter than what the runner wore on their too-warm
 * runs in a band: what the warm line needs to know and `EvidenceFact` does
 * not carry (`personal-band` counts runs only). The scorer answers it on
 * the result, as the contract's `WarmRunsWorn`.
 */
import type { ScoredPiece, WarmRunsWorn } from "../contract";

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
