/**
 * B2's view model: everything the answer screen shows, as plain data a
 * later screen renders (#457). Measured lines come in both forms, drawn
 * and said; the screen renders them and formats nothing.
 */
import type { TempUnit, UiGroup } from "../../../lib/contracts";
import type { CallResult } from "../contract";
import type { B2Header } from "./header";
import { callHeader } from "./header";
import type { Line } from "./lines";
import { pieceEvidenceLine } from "./lines";
import { kitParagraph } from "./paragraph";
import type { WarmRunsWorn } from "./warm-runs";
import { whyNot } from "./why-not";

export interface B2Piece {
  pieceId: string;
  /**
   * The runner's own name for the piece; absent when the lookup lacks it.
   */
  name?: string | undefined;
  line: Line;
}

export interface B2View {
  header: B2Header;
  pieces: readonly B2Piece[];
  paragraph?: string | undefined;
  /**
   * The pieces B2 offers "Why not the X?" for, best first.
   */
  whyNot: readonly string[];
}

export interface B2Options {
  unit: TempUnit;
  /**
   * Piece id to the runner's own name for it (user-generated: passed in,
   * never kept here).
   */
  names: ReadonlyMap<string, string>;
  /**
   * The runner's verdicts so far, for the below-threshold count.
   */
  verdictsSoFar: number;
  /**
   * What was worn on the band's too-warm runs; until the contract carries
   * it (QUESTIONS.md Q10), absent, and the warm line never shows.
   */
  warmRuns?: WarmRunsWorn | undefined;
}

/**
 * The pieces offered a "why not": in each group, the best-ranked piece the
 * kit did not choose. That is the runner-up in a group the kit chose, and
 * the best piece of a group it left out (B2's vest). A piece with no
 * answer is not offered.
 */
function whyNotIds(
  result: CallResult,
  names: ReadonlyMap<string, string>,
): string[] {
  const chosen = new Set(result.kit.map((piece) => piece.pieceId));
  const offered = new Set<UiGroup>();
  const ids: string[] = [];
  for (const piece of result.ranking) {
    if (chosen.has(piece.pieceId) || offered.has(piece.group)) continue;
    offered.add(piece.group);
    if (whyNot(result, piece.pieceId, names) !== undefined) {
      ids.push(piece.pieceId);
    }
  }
  return ids;
}

export function b2View(result: CallResult, options: B2Options): B2View {
  const { unit, names, verdictsSoFar, warmRuns } = options;
  return {
    header: callHeader(result, unit, verdictsSoFar),
    pieces: result.kit.map((piece) => ({
      pieceId: piece.pieceId,
      name: names.get(piece.pieceId),
      line: pieceEvidenceLine(piece, unit),
    })),
    paragraph: kitParagraph(result, names, warmRuns),
    whyNot: whyNotIds(result, names),
  };
}
