/**
 * Questions the prose asks of a result's facts. Prose says "in this band",
 * so it reads only facts counted in the result's own band: with no
 * forecast (`bandFloorC` absent) no fact matches and the prose falls back.
 */
import type { EvidenceFact, ScoredPiece } from "../contract";

type Fact<K extends EvidenceFact["kind"]> = Extract<EvidenceFact, { kind: K }>;

function isPieceRecord(
  fact: EvidenceFact,
  pieceId: string,
  band: number | undefined,
): fact is Fact<"personal-piece"> {
  return (
    fact.kind === "personal-piece" &&
    fact.pieceId === pieceId &&
    fact.bandFloorC === band
  );
}

/**
The runner's own record in a piece, in this band.
*/
export function pieceRecord(
  piece: ScoredPiece,
  band: number | undefined,
): Fact<"personal-piece"> | undefined {
  return piece.evidence.find((fact) =>
    isPieceRecord(fact, piece.pieceId, band),
  );
}

function isTooMuch(
  fact: EvidenceFact,
  band: number | undefined,
): fact is Fact<"personal-flag"> {
  // A flag is one of two, so "not `not_enough`" is "too much"; written
  // this way, a fact of another kind let through would be read as a flag.
  return (
    fact.kind === "personal-flag" &&
    fact.flag !== "not_enough" &&
    fact.bandFloorC === band
  );
}

/**
 * The runner's loudest "too much" in this band on a piece `isCounted` admits:
 * the most times, the first on a tie.
 */
export function loudestTooMuch(
  facts: readonly EvidenceFact[],
  band: number | undefined,
  isCounted: (pieceId: string) => boolean,
): Fact<"personal-flag"> | undefined {
  let loudest: Fact<"personal-flag"> | undefined;
  for (const fact of facts) {
    if (!isTooMuch(fact, band) || !isCounted(fact.pieceId)) continue;
    if (loudest === undefined || fact.times > loudest.times) loudest = fact;
  }
  return loudest;
}

/**
The runner's runs in this band, as one of the kit's facts counts them.
*/
export function bandRecord(
  facts: readonly EvidenceFact[],
  band: number | undefined,
): Fact<"personal-band"> | undefined {
  return facts.find(
    (fact): fact is Fact<"personal-band"> =>
      fact.kind === "personal-band" && fact.bandFloorC === band,
  );
}
