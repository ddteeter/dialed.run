import type { JSX } from "react";

import { Mono } from "../../../ui";

/**
 * The TAKE IT DOWN Act's 48 hours at a Desk row's head (R55·197): "DUE IN
 * 31H" as bold hi-viz text while they run, and once they have run out
 * OVERDUE as a filled hi-viz tag with ink text. A Review row an
 * intimate-image report started wears it, and so does every removal
 * request. Uppercase in CSS, so what is said stays in normal case.
 */
export function DueClock({
  due,
  isOverdue,
}: Readonly<{ due: string; isOverdue: boolean }>): JSX.Element {
  return isOverdue ? (
    <Mono
      step="xs"
      className="bg-hi-viz px-2 py-1 font-semibold text-accent-ink"
    >
      {due}
    </Mono>
  ) : (
    <Mono step="xs" className="font-semibold text-hiviz-text">
      {due}
    </Mono>
  );
}
