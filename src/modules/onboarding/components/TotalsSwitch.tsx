import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import type { JSX } from "react";

import { ControlFailureBand, ToggleField, useControlAction } from "../../../ui";
import type { FieldProps } from "../../../ui";
import type { CountInTotalsChoice } from "../inputs";

/**
 * Settings › Sharing's "Count my runs in anonymous totals" (D-108 D;
 * round 32, frames 1a and 1b). The copy is the board's, verbatim.
 */
export const TOTALS_LABEL = "Count my runs in anonymous totals";
export const TOTALS_ON =
  "Shared and private runs add their temperature, kit and verdict to the guides and reports. Never your name, notes, photos, or where and when you ran.";
export const TOTALS_OFF =
  "Off. Your runs leave the guides at tonight's update. Reports already published stay as they are.";

/**
 * The switch itself: the same `ToggleField` the sharing default uses
 * (round 32: "the switch uses the same component as Share new runs"),
 * saved on toggle with no confirm ("off is a normal choice, not a loss").
 *
 * **Not optimistic** (§4a): the box keeps its old state until the save
 * lands, and a failed save leaves it there under a `Not changed` band
 * with Try again. The sub-line follows the saved state, so it never says
 * something the server has not agreed to.
 *
 * `onSaved` tells a caller that shows the setting elsewhere — A3's
 * private line — what it now is.
 *
 * "How the guides are made" belongs to the marketing site
 * (`dialed.run/how-it-works#totals`), which is not live, so it opens the
 * privacy policy until it is (design-deltas open queue item 59).
 */
export function TotalsSwitch({
  initial,
  save,
  onSaved,
}: Readonly<{
  initial: boolean;
  save: (input: { data: CountInTotalsChoice }) => Promise<unknown>;
  onSaved?: ((isCounted: boolean) => void) | undefined;
}>): JSX.Element {
  const [isOn, setIsOn] = useState(initial);
  const hintId = useId();
  const control = useControlAction<[boolean]>({
    action: (countInTotals) => save({ data: { countInTotals } }),
    kicker: "Not changed",
    onSuccess: (countInTotals) => {
      setIsOn(countInTotals);
      onSaved?.(countInTotals);
    },
  });
  const field = (name: string): FieldProps => ({
    name,
    readOnly: control.pending,
    "aria-invalid": undefined,
    "aria-describedby": hintId,
    onInput: noop,
  });

  return (
    <div data-part="totals-optout" className="flex flex-col gap-2">
      <ToggleField
        name="countInTotals"
        label={TOTALS_LABEL}
        field={field}
        isOn={isOn}
        onChange={(next) => {
          void control.run(next);
        }}
      />
      <p id={hintId} className="m-0 text-small text-muted">
        {isOn ? TOTALS_ON : TOTALS_OFF}
      </p>
      <ControlFailureBand
        failure={control.failure}
        onRetry={control.retry}
        retryRef={control.retryRef}
      />
      <Link
        to="/privacy"
        className="target self-start text-small text-ink underline underline-offset-4"
      >
        How the guides are made
      </Link>
    </div>
  );
}

/**
 * The switch has no validation to clear: `FieldProps` asks for an input
 * handler, and a saved-on-toggle box has nothing for it to do.
 */
function noop(): void {
  // Nothing to clear.
}
