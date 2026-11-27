import type { JSX } from "react";

import { Mono } from "../../../../ui";
import type { B2Piece } from "../../evidence";
import { DrawnLine } from "./DrawnLine";

/**
 * The kit, one ruled row a piece (Round 62, "B2 probable"): the runner's
 * own name for the piece, and under it the piece's one counted line in
 * MONO.xs, never beside it (364.1). A list, so a screen reader says how
 * many pieces the kit has.
 *
 * A piece the lookup has no name for draws its line alone: the screen
 * writes no name of its own (QUESTIONS.md, A6). With no piece there is no
 * list, since an empty one would be announced.
 */
export function KitPieces({
  pieces,
}: Readonly<{ pieces: readonly B2Piece[] }>): JSX.Element | undefined {
  return pieces.length === 0 ? undefined : (
    <ul data-part="kit" className="m-0 flex list-none flex-col p-0">
      {pieces.map((piece) => (
        <li
          key={piece.pieceId}
          className="flex flex-col gap-1 border-t border-hairline py-3"
        >
          <PieceName name={piece.name} />
          <Mono step="xs" className="text-quiet">
            <DrawnLine line={piece.line} />
          </Mono>
        </li>
      ))}
    </ul>
  );
}

function PieceName({
  name,
}: Readonly<{ name: string | undefined }>): JSX.Element | undefined {
  return name === undefined ? undefined : (
    <span className="font-display text-heading">{name}</span>
  );
}

/**
 * B2's hi-viz field: the app telling the runner something, in one or two
 * of the engine's sentences. With no sentence the field is absent, not
 * empty (Round 62, 364.2). The paragraph holds no measure, so it is said
 * as it is drawn. Square, as a statement is; its text is accent ink, which
 * stays ink on a dark page.
 */
export function KitParagraph({
  text,
}: Readonly<{ text: string | undefined }>): JSX.Element | undefined {
  if (text === undefined) return undefined;
  return (
    <p
      data-part="paragraph"
      className="m-0 bg-hi-viz p-4 text-body text-accent-ink"
    >
      {text}
    </p>
  );
}
