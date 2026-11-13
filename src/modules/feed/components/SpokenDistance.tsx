import type { JSX } from "react";

import type { Units } from "../../../lib/contracts";
import { measuredLine } from "../../../lib/contracts/measures";
import { Spoken } from "../../../ui";

/**
 * A run's distance as the feed draws it beside its conditions: spaced, in
 * the runner's unit ("8.1 mi", which the mono step sets in caps), and said
 * in words ("8.1 miles", round 52 #158). The E1 card's strip (E1-08) and
 * A2's rail draw the same line, so it is said here once.
 */
export function SpokenDistance({
  distanceM,
  units,
}: Readonly<{ distanceM: number; units: Units }>): JSX.Element {
  return (
    <Spoken
      {...measuredLine(
        [[{ kind: "distance", distanceM, spaced: true }]],
        units,
      )}
    />
  );
}
