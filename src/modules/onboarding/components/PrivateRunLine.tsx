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
 * - **Opted out**, "just 'Only you see this run.'"
 *
 * **Change opens Settings › Sharing as a sheet**, over the form rather
 * than in place of it, so the verdict, chips and tags being picked are
 * never unmounted — "returns to the form with its values kept". The sheet
 * holds the totals switch alone: the sharing default is a form of its own,
 * and a form cannot sit inside A3's.
 */
export const PRIVATE_UNCONFIRMED =
  "Confirm your email to share. This run saves private.";
export const PRIVATE_ONLY_YOU = "Only you see this run.";
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
        {PRIVATE_ONLY_YOU}
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
