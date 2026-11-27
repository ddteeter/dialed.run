/**
 * "Why not the X?" (B2): the reasoning for a piece the Call left out, kept
 * available without turning the answer into a menu. The answer reads the
 * ranking: what the asked piece's own facts say against it, else what the
 * chosen piece in its group has that it lacks. Every answer's wording is
 * a guess; the board draws only the question.
 */
import type { CallResult, ScoredPiece } from "../contract";
import { loudestTooMuch, pieceRecord } from "./facts";
import { timesWord } from "./lines";
import { fill } from "./words";

export interface WhyNot {
  question: string;
  answer: string;
}

/**
The answer when the kit has a piece in the asked piece's group.
*/
function againstChosen(
  result: CallResult,
  asked: { piece: ScoredPiece; name: string },
  chosen: { piece: ScoredPiece; name: string },
): string {
  const record = pieceRecord(chosen.piece, result.bandFloorC);
  if (record === undefined) {
    return fill("answerRanked", { chosen: chosen.name });
  }
  const counts = {
    chosen: chosen.name,
    name: asked.name,
    dialed: String(record.dialed),
    of: String(record.of),
  };
  const own = pieceRecord(asked.piece, result.bandFloorC);
  if (own === undefined) return fill("answerDialedOnly", counts);
  return fill("answerDialedBoth", {
    ...counts,
    askedDialed: String(own.dialed),
    askedOf: String(own.of),
  });
}

function answerFor(
  result: CallResult,
  asked: { piece: ScoredPiece; name: string },
  names: ReadonlyMap<string, string>,
): string | undefined {
  const flag = loudestTooMuch(
    asked.piece.evidence,
    result.bandFloorC,
    (pieceId) => pieceId === asked.piece.pieceId,
  );
  if (flag !== undefined) {
    return fill("answerFlagged", {
      name: asked.name,
      times: timesWord(flag.times),
    });
  }
  const chosen = result.kit.find((piece) => piece.group === asked.piece.group);
  if (chosen === undefined) return fill("answerLeftOut", { name: asked.name });
  const chosenName = names.get(chosen.pieceId);
  return chosenName === undefined
    ? undefined
    : againstChosen(result, asked, { piece: chosen, name: chosenName });
}

/**
 * The question and its answer for a ranked piece the kit left out.
 * Nothing for a chosen piece, a piece the ranking never had, or a piece
 * (or the chosen piece it is weighed against) with no name to say.
 */
export function whyNot(
  result: CallResult,
  pieceId: string,
  names: ReadonlyMap<string, string>,
): WhyNot | undefined {
  if (result.kit.some((piece) => piece.pieceId === pieceId)) return undefined;
  const piece = result.ranking.find((ranked) => ranked.pieceId === pieceId);
  const name = names.get(pieceId);
  if (piece === undefined || name === undefined) return undefined;
  const answer = answerFor(result, { piece, name }, names);
  return answer === undefined
    ? undefined
    : { question: fill("whyNotQuestion", { name }), answer };
}
