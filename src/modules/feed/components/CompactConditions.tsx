import type { JSX } from "react";

import type { Units } from "../../../lib/contracts";
import type { CompactConditions as Matched } from "../compact-conditions";
import { matchedConditions, SameConditionsEyebrow } from "./ConditionsTab";

/**
 * E1's compact line (FEED-9), composed as the E2 frame draws it on
 * `Remaining Screens` — the teal band under the tabs, the SAME CONDITIONS
 * eyebrow without a window, and one sentence — and placed at the top of
 * Following, above the posts (design deltas: E1 draws no conditions line
 * of its own). Teal, because it is a match; nothing when there is none.
 */
export function CompactConditions({
  result,
  units,
}: Readonly<{ result: Matched; units: Units }>): JSX.Element {
  // Round 25's "in the last 3 days"; two weeks when the match had to widen,
  // as Your conditions says it ("looks back two weeks").
  const when =
    result.windowDays === 14 ? "in the last 2 weeks" : "in the last 3 days";
  return (
    <div
      data-part="compact-conditions"
      className="flex flex-col gap-1 bg-teal px-5 py-4 text-ink desk:rounded-card"
    >
      <SameConditionsEyebrow band={result.band} units={units} />
      <p className="m-0 text-body font-semibold">
        {`${String(result.runners)} runners logged ${matchedConditions(result.band, units)} ${when}.`}
      </p>
    </div>
  );
}
