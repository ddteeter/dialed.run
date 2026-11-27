/**
 * B2's hi-viz paragraph: the app telling the runner something, from the
 * kit's facts. At most two sentences: how often they were too cold or too
 * warm in this band, and the piece they said was too much that the kit
 * left out. The paragraph holds no measure, so it is said as it is shown.
 */
import type { CallResult } from "../contract";
import { bandRecord, loudestTooMuch } from "./facts";
import { timesWord } from "./lines";
import { fill } from "./words";

/**
 * How often the runner was off in this band: the side with more runs, and
 * cold on a tie (the board's own sentence). Nothing when neither was.
 */
function bandSentence(result: CallResult): string | undefined {
  const record = bandRecord(
    result.kit.flatMap((piece) => piece.evidence),
    result.bandFloorC,
  );
  if (record === undefined) return undefined;
  if (record.warm > record.cold) {
    return fill("warmRuns", { times: timesWord(record.warm) });
  }
  return record.cold === 0
    ? undefined
    : fill("coldRuns", { times: timesWord(record.cold) });
}

function skipSentence(
  result: CallResult,
  names: ReadonlyMap<string, string>,
): string | undefined {
  const chosen = new Set(result.kit.map((piece) => piece.pieceId));
  const flag = loudestTooMuch(
    result.ranking.flatMap((piece) => piece.evidence),
    result.bandFloorC,
    (pieceId) => !chosen.has(pieceId),
  );
  if (flag === undefined) return undefined;
  const name = names.get(flag.pieceId);
  return name === undefined
    ? undefined
    : fill("skipPiece", { name, times: timesWord(flag.times) });
}

/**
The paragraph, or nothing when no fact in this band says anything.
*/
export function kitParagraph(
  result: CallResult,
  names: ReadonlyMap<string, string>,
): string | undefined {
  const sentences = [bandSentence(result), skipSentence(result, names)].filter(
    (sentence) => sentence !== undefined,
  );
  return sentences.length === 0 ? undefined : sentences.join(" ");
}
