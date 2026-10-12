import type { JSX } from "react";

import type { RunRemoval } from "../run-removals";
import { ContentRemoved } from "./NoticeBand";

/**
 * Where the Desk took something off a runner's run (round 27 #20, R-140):
 * one band per removal, newest first — "PHOTO REMOVED" where a photo was,
 * "REMOVED FROM THE FEED" in place of the entry — each saying why, or that
 * it answered a copyright notice. Only the run's author is handed any.
 *
 * Nothing renders for a run nothing was taken off.
 */
export function RunRemovals({
  removals,
}: Readonly<{ removals: readonly RunRemoval[] }>): JSX.Element | undefined {
  if (removals.length === 0) return undefined;
  return (
    <div data-part="run-removals" className="flex flex-col gap-3">
      {removals.map((removal) => (
        <ContentRemoved
          key={removal.id}
          subjectType={removal.subjectType}
          action={removal.action}
          reason={removal.reason}
        />
      ))}
    </div>
  );
}
