import type { JSX } from "react";

import { Bracketed } from "../../../ui";
import type { TodayCounts } from "../desk";

/**
 * Review's header on the Desk (round 44 #106): the rail's word for the
 * page, and D1's `[4 WAITING · 2 DECIDED TODAY]` beside it, even at zero.
 * The rail's badge says where to go; this says how the page stands. Both
 * read Today's counts, so they cannot disagree.
 */
export function ReviewHeading({
  counts,
}: Readonly<{
  counts: Pick<TodayCounts, "waiting" | "decidedToday">;
}>): JSX.Element {
  return (
    <div className="flex flex-wrap items-baseline gap-3">
      {/* Focusable from script only: where focus lands when the last of
          Review's "Held in the last day" lines is released (round 45 #103). */}
      <h1 tabIndex={-1} className="m-0 font-display text-title uppercase">
        Review
      </h1>
      <Bracketed step="xs" className="text-muted">
        {`${String(counts.waiting)} waiting · ${String(counts.decidedToday)} decided today`}
      </Bracketed>
    </div>
  );
}
