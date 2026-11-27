import { useId, useState } from "react";
import type { JSX } from "react";

import { focusOnMount, Mono } from "../../../../ui";
import type { WhyNotRow } from "../facts";
import { moreWords, SCREEN_WORDS } from "../words";

/**
 * How many why-nots show before the fold (Round 62, 365: "up to three").
 */
const SHOWN_FIRST = 3;

/**
 * One why-not's answer, in TYPE.small. It is always in the page and hidden
 * while its question is closed, so the question's `aria-controls` never
 * points at nothing.
 */
function Answer({
  id,
  isOpen,
  text,
}: Readonly<{ id: string; isOpen: boolean; text: string }>): JSX.Element {
  return (
    <p id={id} hidden={!isOpen} className="m-0 pb-3 text-small text-quiet">
      {text}
    </p>
  );
}

/**
 * One why-not: a real disclosure. The question is a button that says
 * whether it is open (`aria-expanded`) and names its answer
 * (`aria-controls`). The row is 44 high (`target`). The board's mark, +
 * closed and − open, is drawn in mono and not said: the state is the
 * button's.
 *
 * `onOpen` is told which row is open now: this one, or none when the open
 * row is pressed again. The first row "N more" reveals takes the focus as
 * it is drawn.
 */
function WhyNotItem({
  row,
  place,
  openId,
  onOpen,
}: Readonly<{
  row: WhyNotRow;
  place: number;
  openId: string | undefined;
  onOpen: (pieceId: string | undefined) => void;
}>): JSX.Element {
  const isOpen = row.pieceId === openId;
  const answerId = useId();
  return (
    <li className="flex flex-col border-t border-hairline">
      <button
        type="button"
        ref={place === SHOWN_FIRST ? focusOnMount : undefined}
        aria-expanded={isOpen}
        aria-controls={answerId}
        onClick={() => {
          onOpen(isOpen ? undefined : row.pieceId);
        }}
        className="target flex w-full cursor-pointer items-center justify-between gap-3 border-none bg-transparent p-0 text-left text-body font-semibold text-ink"
      >
        <span>{row.question}</span>
        <Mono step="md" className="font-normal">
          <span aria-hidden="true">{isOpen ? "−" : "+"}</span>
        </Mono>
      </button>
      <Answer id={answerId} isOpen={isOpen} text={row.answer} />
    </li>
  );
}

/**
 * "▸ N more": the why-nots past the third, behind one ruled, underlined
 * text button. The mark is the board's text mark, drawn and not said.
 * Nothing when nothing is folded, since a control over an empty set lies.
 */
function MoreRows({
  count,
  onUnfold,
}: Readonly<{ count: number; onUnfold: () => void }>): JSX.Element | undefined {
  return count === 0 ? undefined : (
    <button
      type="button"
      onClick={onUnfold}
      className="target flex cursor-pointer items-center gap-1 border-x-0 border-b-0 border-t border-hairline bg-transparent p-0 text-left text-small font-semibold text-ink underline underline-offset-4"
    >
      <span aria-hidden="true">▸</span>
      {moreWords(count)}
    </button>
  );
}

/**
 * B2's "Why not the X?" (Round 62, 365): the reasoning for what the Call
 * left out, kept available without turning the answer into a menu. Under
 * the MONO.xs caption, up to three disclosure rows in the order the rows
 * arrive (the closet's group order), one open at a time, and the rest
 * behind "▸ N more".
 *
 * The caption heads a group, so it is a heading (Accessibility Contract
 * 04). With no row there is no caption either.
 *
 * "N more" reveals the rest and goes: 365 draws no way back, and the
 * screen writes no word of its own for one. Focus moves to the first row
 * it revealed, so a keyboard is not left on a button that is gone.
 */
export function WhyNots({
  rows,
}: Readonly<{ rows: readonly WhyNotRow[] }>): JSX.Element | undefined {
  const [openId, setOpenId] = useState<string>();
  const [isUnfolded, setIsUnfolded] = useState(false);
  const shown = isUnfolded ? rows : rows.slice(0, SHOWN_FIRST);
  return rows.length === 0 ? undefined : (
    <section data-part="why-nots" className="flex flex-col">
      <h2 className="m-0 pb-2 font-normal">
        <Mono step="xs" className="text-label">
          {SCREEN_WORDS.whyNot}
        </Mono>
      </h2>
      <ul className="m-0 flex list-none flex-col p-0">
        {shown.map((row, place) => (
          <WhyNotItem
            key={row.pieceId}
            row={row}
            place={place}
            openId={openId}
            onOpen={setOpenId}
          />
        ))}
      </ul>
      <MoreRows
        count={rows.length - shown.length}
        onUnfold={() => {
          setIsUnfolded(true);
        }}
      />
    </section>
  );
}
