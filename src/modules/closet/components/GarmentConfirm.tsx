import type { JSX } from "react";

import { ConfirmSheet } from "../../../ui";
import type { ControlAction } from "../../../ui";

/**
Which of round 22's two confirm sheets is open, if either.
*/
export type ConfirmKind = "retire" | "delete";

/**
 * The words on each sheet, from round 22's "Y Retire confirm".
 *
 * The verb on the primary repeats the verb that opened it, and it is the
 * in-flight label too: "[ Retiring ]".
 */
const VERBS: Record<ConfirmKind, { verb: string; pending: string }> = {
  retire: { verb: "Retire", pending: "Retiring" },
  delete: { verb: "Delete", pending: "Deleting" },
};

/**
 * What retiring keeps, with the space that joins it to the sentence before.
 * Nothing when the piece has no runs — round 22: *"A garment with 0 runs
 * deletes without this sheet's second sentence"*, and a sheet promising
 * that none of its runs will be lost is the same sentence about nothing.
 */
function keptSentence(runCount: number): string {
  if (runCount === 0) return "";
  if (runCount === 1) return " Its 1 run and verdict stay, and still count.";
  return ` Its ${String(runCount)} runs and verdicts stay, and still count.`;
}

/**
 * The body under the heading. Delete spells out its cost plainly; retire
 * says what it keeps. Both are round 22's sentences, extended to every
 * run count.
 *
 * Delete is only ever asked here of a piece with no runs: one with runs
 * gets round 26's own sheet (`DeleteWithRuns`), which lists what goes.
 */
function body(kind: ConfirmKind, runCount: number): string {
  if (kind === "delete") {
    return "This can't be undone. Retire keeps the history.";
  }
  return `It leaves the closet and the picker.${keptSentence(runCount)} You can bring it back.`;
}

/**
 * Round 22's retire and delete confirm: *"Shade sheet frame … Verb on the
 * primary repeats the verb that opened it. No red and no pink:
 * destruction isn't an alarm, and pink is the log verb. Focus lands on
 * Keep it."* At width the sheet is DS3's panel, which `Sheet` already is.
 *
 * The action is a control, not a form: it waits behind its in-flight
 * label, and a failure is the control band under it (round 23, item 9)
 * with the sheet left open so Try again is right there.
 */
export function GarmentConfirm({
  kind,
  name,
  runCount,
  action,
  onClose,
}: Readonly<{
  kind: ConfirmKind | undefined;
  /**
  The garment's own name — "Retire the Rover Half-zip?".
  */
  name: string;
  runCount: number;
  /**
   * The confirmed action, owned by the screen: its status sentence belongs
   * in the screen's one status region, and its kicker names what is still
   * true of this garment, which the screen knows.
   */
  action: ControlAction<[]>;
  onClose: () => void;
}>): JSX.Element {
  const shown = kind ?? "retire";
  return (
    <ConfirmSheet
      open={kind !== undefined}
      state={`confirm-${shown}`}
      heading={`${VERBS[shown].verb} the ${name}?`}
      body={body(shown, runCount)}
      verb={VERBS[shown].verb}
      pendingVerb={VERBS[shown].pending}
      action={action}
      onClose={onClose}
    />
  );
}
