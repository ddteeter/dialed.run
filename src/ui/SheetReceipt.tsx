import type { JSX, ReactNode } from "react";

import { INK_PILL } from "./form";
import { focusSheetHeading } from "./Sheet";

/**
 * A sheet's receipt, swapped in place of its form (round 42's report
 * receipt; R48·129d's correction receipt "the same as 84's"): what happens
 * next, then Done. No toast.
 *
 * The receipt's kicker and heading are the sheet's own (R55·173: every
 * sheet heading is the sheet's TYPE.title, receipts included), so the
 * caller swaps them on `Sheet` — `kicker="Report sent"`,
 * `label="Thanks for telling us."` — along with this body. What stays
 * here is the focus move: the heading takes focus as the receipt mounts,
 * so the swap is read out.
 *
 * Done is the ink pill, a sheet's act (R58·306): a receipt is not a flow
 * step, and a display-caps card is never a button.
 */
export function SheetReceipt({
  part,
  children,
  onDone,
}: Readonly<{
  /**
  The receipt's `data-part`, which a test and the conformance harness find.
  */
  part: string;
  /**
  What happens next: a sentence, and anything after it.
  */
  children: ReactNode;
  onDone: () => void;
}>): JSX.Element {
  return (
    <div data-part={part} ref={focusSheetHeading} className="flex flex-col gap-4">
      {children}
      <button
        type="button"
        onClick={onDone}
        className={`target ${INK_PILL}`}
      >
        Done
      </button>
    </div>
  );
}
