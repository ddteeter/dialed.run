import { useState } from "react";
import type { JSX } from "react";

import { Sheet } from "../../../ui";
import type { CountInTotalsChoice } from "../inputs";
import { TotalsSwitch } from "./TotalsSwitch";

/**
 * A3's sub-line in the PRIVATE state (D-108 E; round 32, frame 2a), in the
 * board's words:
 *
 * - **Unconfirmed**, round 27's line, which "takes precedence when it
 *   applies": an unconfirmed runner's run saves private (D-50), and it
 *   counts in no total either (D-108 C).
 * - **Counted**, the disclosure, with Change.
 * - **Opted out**, the board's "just 'Only you see this run.'", now
 *   "Other runners won't see this run." (owner, D-121: private means not
 *   shown to other runners or the public; design deltas item 62). "Won't"
 *   because the run is not saved yet: the line is a promise about what
 *   happens to it. The review bands say "can't" of something already
 *   there and hidden, and the export "don't" of the rule; all three name
 *   the same audience, other runners.
 *
 * **Change opens Settings › Sharing as a sheet**, over the form rather
 * than in place of it, so the verdict, chips and tags being picked are
 * never unmounted — "returns to the form with its values kept". The sheet
 * holds the totals switch alone: the sharing default is a form of its own,
 * and a form cannot sit inside A3's.
 */
export const PRIVATE_UNCONFIRMED =
  "Confirm your email to share. This run saves private.";
export const PRIVATE_NOT_SHOWN = "Other runners won't see this run.";
export const PRIVATE_COUNTED =
  "Its kit and verdict still count, anonymously, in the guides.";

/**
The share switch's sub-line, set as A3's shared line is.
*/
const LINE = "text-small text-muted";

export function PrivateRunLine({
  hintId,
  isVerified,
  countInTotals,
  saveCountInTotals,
}: Readonly<{
  /**
   * The id A3's switch is described by. The line carries it and the sheet
   * sits beside it, so the switch's description is the sentence and never
   * the sheet's contents.
   */
  hintId: string;
  isVerified: boolean;
  countInTotals: boolean;
  saveCountInTotals: (input: { data: CountInTotalsChoice }) => Promise<unknown>;
}>): JSX.Element {
  const [isCounted, setIsCounted] = useState(countInTotals);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  if (!isVerified) {
    return (
      <span id={hintId} className={LINE}>
        {PRIVATE_UNCONFIRMED}
      </span>
    );
  }
  return (
    <>
      <span id={hintId} className={LINE}>
        {PRIVATE_NOT_SHOWN}
        {isCounted ? (
          <>
            {` ${PRIVATE_COUNTED} `}
            <button
              type="button"
              onClick={() => {
                setIsSheetOpen(true);
              }}
              className="target cursor-pointer border-none bg-transparent p-0 text-small font-semibold text-ink underline underline-offset-4"
            >
              Change
            </button>
          </>
        ) : undefined}
      </span>
      <Sheet
        open={isSheetOpen}
        onClose={() => {
          setIsSheetOpen(false);
        }}
        label="Sharing"
      >
        <div className="flex flex-col gap-6">
          <h2 className="m-0 font-display text-heading">Sharing</h2>
          <TotalsSwitch
            initial={isCounted}
            save={saveCountInTotals}
            onSaved={setIsCounted}
          />
          <button
            type="button"
            onClick={() => {
              setIsSheetOpen(false);
            }}
            className="target cursor-pointer rounded-pill border border-hairline bg-transparent px-6 py-3 text-body font-semibold"
          >
            Done
          </button>
        </div>
      </Sheet>
    </>
  );
}
