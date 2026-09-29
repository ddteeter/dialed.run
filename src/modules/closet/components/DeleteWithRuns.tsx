import { Fragment, useEffect, useState } from "react";
import type { JSX } from "react";

import {
  ControlFailureBand,
  inFlight,
  Mono,
  PendingLabel,
  Sheet,
} from "../../../ui";
import type { ControlAction } from "../../../ui";

/**
"1 run", "38 runs" — the one noun this sheet counts twice.
*/
function runs(count: number): string {
  return count === 1 ? "1 run" : `${String(count)} runs`;
}

/**
 * What a delete takes and what it leaves, as round 26 #3 lists them
 * under `IF YOU DELETE IT`. The band row is absent when the piece has no
 * record in any band — a run with no verdict, or no weather, is in none —
 * because "Its record in 0 bands" is a cost of nothing.
 */
function costRows(
  runCount: number,
  bandCount: number,
): { kind: "goes" | "stays"; text: string }[] {
  const kit =
    runCount === 1
      ? "It comes off the kit of its 1 run"
      : `It comes off the kit of all ${runs(runCount)}`;
  const record =
    bandCount === 1
      ? "Its record in 1 band"
      : `Its record in ${String(bandCount)} bands`;
  return [
    { kind: "goes", text: kit },
    ...(bandCount > 0 ? [{ kind: "goes" as const, text: record }] : []),
    {
      kind: "stays",
      text: "Every entry and verdict, and the rest of each kit",
    },
  ];
}

/**
 * The word each row starts with, in the hue round 26 draws it in: what
 * goes in the cold text colour, what stays in the dialed one.
 */
const ROW_WORD = {
  goes: { word: "Goes", className: "text-cold-text" },
  stays: { word: "Stays", className: "text-dialed-text" },
} as const;

/**
 * Round 26 draws retire as the pink primary — pink is the action, and
 * retiring is the one this sheet recommends — and the delete as a
 * hairline secondary.
 */
const RETIRE_LOOK =
  "w-full cursor-pointer rounded-pill border-none bg-action px-4 py-4 text-lead font-bold text-ink";
const DELETE_LOOK =
  "w-full cursor-pointer rounded-pill border border-ink bg-transparent px-4 py-4 text-body font-semibold text-ink";

/**
 * Round 26 #3, "Y Delete with runs": deleting a piece that has runs asks
 * whether to retire it instead — **retire, don't delete**, said as the
 * sheet's shape. Retire it is the pink primary, the delete a hairline
 * secondary, and Cancel below both. The sheet is the confirm, so the
 * delete goes straight through with no second one.
 *
 * Its own sheet rather than `ConfirmSheet`, which has one action: this
 * one has two, and each wears its own failure band under its own button,
 * so a failure is always shown against the action that failed. Focus
 * lands on Cancel, as it lands on Keep it in round 22's confirm: nothing
 * is taken away by the key a runner presses without reading.
 */
export function DeleteWithRuns({
  open,
  name,
  runCount,
  bandCount,
  retire,
  remove,
  onClose,
}: Readonly<{
  open: boolean;
  /**
  The garment's own name — "Delete the Pegasus 40?".
  */
  name: string;
  runCount: number;
  /**
  How many 5 °C bands the piece has a verdicted run in.
  */
  bandCount: number;
  retire: ControlAction<[]>;
  remove: ControlAction<[]>;
  onClose: () => void;
}>): JSX.Element {
  const heading = `Delete the ${name}? Retire it instead.`;
  // Cancel, once it exists and the sheet is open. Held as state so the
  // effect runs again when the button arrives: the sheet's own effect,
  // which opens the dialog, runs after this one on the first pass.
  const [cancel, setCancel] = useState<HTMLButtonElement | undefined>();
  useEffect(() => {
    if (!open) return;
    cancel?.focus();
  }, [open, cancel]);
  const choices = [
    {
      action: retire,
      label: "Retire it",
      pendingLabel: "Retiring",
      look: RETIRE_LOOK,
    },
    {
      action: remove,
      label: "Delete it and its record",
      pendingLabel: "Deleting",
      look: DELETE_LOOK,
    },
  ];

  return (
    <Sheet open={open} onClose={onClose} label={heading}>
      <div
        data-part="sheet"
        data-state="delete-with-runs"
        className="flex flex-col gap-4"
      >
        <h2 className="m-0 font-display text-heading">{heading}</h2>
        <p className="m-0 text-body">
          {`It's on ${runs(runCount)}. Retiring takes it out of the picker and keeps everything it taught you.`}
        </p>
        <div className="flex flex-col gap-2 border-t border-hairline pt-3">
          <Mono step="xs" className="text-muted">
            If you delete it
          </Mono>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {costRows(runCount, bandCount).map((row) => (
              <li key={row.text} className="flex items-baseline gap-3">
                <Mono step="xs" className={ROW_WORD[row.kind].className}>
                  {ROW_WORD[row.kind].word}
                </Mono>
                <span className="text-small">{row.text}</span>
              </li>
            ))}
          </ul>
          <p className="m-0 text-small">This can&apos;t be undone.</p>
        </div>
        {/* Each action with its own band directly under it, so a failure
            is shown against the action that failed. */}
        {choices.map((choice) => (
          <Fragment key={choice.label}>
            <button
              type="button"
              {...inFlight(choice.action.pending)}
              onClick={() => {
                void choice.action.run();
              }}
              // `target` at the site, where the hit-area check reads it.
              className={`target ${choice.look}`}
            >
              <PendingLabel
                label={choice.label}
                pendingLabel={choice.pendingLabel}
                pending={choice.action.pending}
              />
            </button>
            <ControlFailureBand
              failure={choice.action.failure}
              onRetry={choice.action.retry}
              retryRef={choice.action.retryRef}
            />
          </Fragment>
        ))}
        <button
          type="button"
          ref={(node) => {
            setCancel(node ?? undefined);
          }}
          onClick={onClose}
          className="target w-full cursor-pointer border-none bg-transparent px-4 py-3 text-body font-semibold text-label"
        >
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
