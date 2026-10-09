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
import { runsLabel } from "../label";

/**
 * What a delete takes and what it leaves, as round 26 #3 lists them
 * under `IF YOU DELETE IT`. The band row is absent when the piece has no
 * record in any band — a run with no verdict, or no weather, is in none —
 * because "Its record in 0 bands" is a cost of nothing. It is absent too
 * while the count is on its way, and when it could not be had: the sheet
 * never waits on it, and never fails for it (law 5).
 */
function costRows(
  runCount: number,
  bandCount: number | undefined,
): { kind: "goes" | "stays"; text: string }[] {
  const kit =
    runCount === 1
      ? "It comes off the kit of its 1 run"
      : `It comes off the kit of all ${runsLabel(runCount)}`;
  const record =
    bandCount === 1
      ? "Its record in 1 band"
      : `Its record in ${String(bandCount)} bands`;
  return [
    { kind: "goes", text: kit },
    // Not yet counted, or not countable, reads as no record at all.
    ...((bandCount ?? 0) > 0 ? [{ kind: "goes" as const, text: record }] : []),
    {
      kind: "stays",
      text: "Every entry and verdict, and the rest of each kit",
    },
  ];
}

/**
 * The word each row starts with, **in ink** (round 28 #13): hue means
 * verdict, and what a delete takes or leaves is not one. Round 26 drew
 * them cold and dialed, and D-77 built that; round 28 reverses it.
 */
const ROW_WORD = {
  goes: "Goes",
  stays: "Stays",
} as const;

/**
 * How many 5 °C bands the piece has a verdicted run in, asked for each
 * time the sheet opens rather than with the garment page (PR #129
 * review): the count walks every run in the piece and then the weather,
 * for one line of a sheet most views never open.
 *
 * `undefined` until it arrives, and again if the asking fails — the
 * server already turns a failed count into `undefined` and reports it, so
 * a rejection here is the connection, and the row simply stays out.
 */
function useBandCount(
  isOpen: boolean,
  itemId: string,
  countBands: BandCount,
): number | undefined {
  const [count, setCount] = useState<number | undefined>();
  useEffect(() => {
    if (!isOpen) return;
    void countBands({ data: { itemId } })
      .then(setCount)
      .catch(() => {
        setCount(undefined);
      });
  }, [isOpen, itemId, countBands]);
  return count;
}

/**
 * Feed's band count, in the server function's own shape so the route
 * hands it over as it is: `undefined` when the count failed.
 */
export type BandCount = (input: {
  data: { itemId: string };
}) => Promise<number | undefined>;

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
  itemId,
  name,
  runCount,
  countBands,
  retire,
  remove,
  onClose,
}: Readonly<{
  open: boolean;
  itemId: string;
  /**
  The garment's own name — "Delete the Pegasus 40?".
  */
  name: string;
  runCount: number;
  /**
  Asked, on opening, how many 5 °C bands the piece has a record in.
  */
  countBands: BandCount;
  retire: ControlAction<[]>;
  remove: ControlAction<[]>;
  onClose: () => void;
}>): JSX.Element {
  const heading = `Delete the ${name}? Retire it instead.`;
  const bandCount = useBandCount(open, itemId, countBands);
  // One guard for both: a retire in flight is no moment to start a
  // delete, nor the other way round. Held off by `aria-disabled` and the
  // handler, never `disabled`, which drops focus and stops announcing.
  const isBusy = retire.pending || remove.pending;
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
          {`It's on ${runsLabel(runCount)}. Retiring takes it out of the picker and keeps everything it taught you.`}
        </p>
        <div className="flex flex-col gap-2 border-t border-hairline pt-3">
          <Mono step="xs" className="text-muted">
            If you delete it
          </Mono>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {costRows(runCount, bandCount).map((row) => (
              <li key={row.text} className="flex items-baseline gap-3">
                <Mono step="xs" className="text-ink">
                  {ROW_WORD[row.kind]}
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
              {...inFlight(isBusy)}
              onClick={() => {
                if (isBusy) return;
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
