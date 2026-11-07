import type { JSX } from "react";

import { PendingLabel } from "./form";

/**
 * A link's label as X3 draws it while its page is slow: in breathing
 * brackets once `useTappedSlow` says this was the link pressed, and
 * plain otherwise. On a whole-block link it is the date that breathes,
 * not the handle (round 47 #122).
 */
export function SlowLabel({
  label,
  isWaiting,
}: Readonly<{ label: string; isWaiting: boolean }>): JSX.Element {
  return isWaiting ? (
    <PendingLabel label={label} pendingLabel={label} pending />
  ) : (
    <>{label}</>
  );
}
