import type { JSX } from "react";

import { FailureBand } from "../../../ui";

/**
 * NOT RENAMED, the rename's control band (round 35 #45 on D1, round 38
 * #60 on D8). No Try again: the sentence says to press Rename, which is
 * right above it.
 *
 * Its own file because Review renders it, and `one-h1-per-route` follows
 * an import that is rendered into its file: from `DeskRunners.tsx` it
 * would count D8's page title as a second heading on Review.
 */
export function NotRenamedBand({
  message,
}: Readonly<{ message: string }>): JSX.Element {
  return (
    <FailureBand
      kicker="Not renamed"
      message={message}
      part="control-failure"
    />
  );
}
