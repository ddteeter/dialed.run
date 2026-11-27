/**
 * What B2's boards need that `B2View` does not hold yet, derived from the
 * result and the view. Each belongs in `call/evidence` once the contract
 * settles (QUESTIONS.md, A6); until then the screen derives it here and
 * `call/evidence` is not edited.
 */
import { CALL_VERDICT_THRESHOLD, uiGroups } from "../../../lib/contracts";
import type { CallResult } from "../contract";
import { whyNot } from "../evidence";
import type { B2Header, B2View, Line, WhyNot } from "../evidence";
import { allRunsWords, countedWords } from "./words";

/**
 * The mark between a line's parts, as the evidence table types it.
 */
export const PART_MARK = " · ";

/**
 * A shown line as B2 draws it (Round 62, 364.1): the brackets are the
 * engine's slots and are not drawn, and the line wraps only at its marks,
 * so it comes back as the parts between them.
 */
export function drawn(shown: string): readonly string[] {
  return shown.replaceAll(/[[\]]/g, "").split(PART_MARK);
}

/**
 * A why-not with the piece it asks about, which the screen keys its
 * disclosure rows by.
 */
export interface WhyNotRow extends WhyNot {
  pieceId: string;
}

export interface ScreenFacts {
  /**
   * C0a's header when the Call has no forecast (366.3): the confidence
   * over all the runner's runs, with no "IN BAND". Absent with a forecast.
   * A Call is answered only above the verdict threshold, so the count is
   * never one and the plural stands.
   */
  noForecast?: Line | undefined;
  /**
   * The view's why-nots as question and answer, in the order the closet
   * draws its groups (365). The view lists ids, best first.
   */
  whyNots: readonly WhyNotRow[];
}

function whyNotRows(
  result: CallResult,
  view: B2View,
  names: ReadonlyMap<string, string>,
): WhyNotRow[] {
  const groupOf = new Map(
    result.ranking.map((piece) => [piece.pieceId, piece.group]),
  );
  return uiGroups.flatMap((group) =>
    view.whyNot
      .filter((pieceId) => groupOf.get(pieceId) === group)
      .flatMap((pieceId) => {
        const answered = whyNot(result, pieceId, names);
        return answered === undefined ? [] : { pieceId, ...answered };
      }),
  );
}

/**
 * The screen's facts for a result and the view made from it. `names` is
 * the lookup the view was made with.
 */
export function screenFacts(
  result: CallResult,
  view: B2View,
  names: ReadonlyMap<string, string>,
): ScreenFacts {
  return {
    noForecast:
      result.bandFloorC === undefined
        ? allRunsWords(result.verdictsSoFar)
        : undefined,
    whyNots: whyNotRows(result, view, names),
  };
}

/**
 * The verdicts counted toward the first Call, from C0b's header: the
 * threshold less what remains.
 */
export function verdictsCounted(
  header: Extract<B2Header, { kind: "count" }>,
): number {
  return CALL_VERDICT_THRESHOLD - header.remaining;
}

/**
 * 362's reading of the count: "0 of 15 verdicts counted".
 */
export function countedLine(counted: number): string {
  return countedWords(counted, CALL_VERDICT_THRESHOLD);
}
