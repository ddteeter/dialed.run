import type { JSX } from "react";

import { ConfirmLink } from "../../../ui";

/**
 * Deleting a run from its own page (task 128 · SAF-3). The entry, its
 * photos and any uploaded file go with it — the sheet says so, because a
 * runner deleting a run may not know the entry hangs on it.
 *
 * **Undrawn** ("the run-detail action" is one of the packet's design
 * asks): a text link at the foot of the run, round 22's confirm sheet.
 * Listed as a design delta.
 */
export function DeleteRun({
  runId,
  deleteRun,
  onDeleted,
}: Readonly<{
  runId: string;
  deleteRun: (input: { data: { runId: string } }) => Promise<unknown>;
  /**
  Where the runner lands — the run has no page any more.
  */
  onDeleted: () => Promise<void>;
}>): JSX.Element {
  return (
    <div data-part="delete-run" className="flex flex-col items-start">
      <ConfirmLink
        label="Delete this run"
        heading="Delete this run?"
        body="Its entry, verdict and photos go with it, and so does any file you uploaded for it. This can't be undone."
        verb="Delete"
        pendingVerb="Deleting"
        kicker="Not deleted"
        state="confirm-delete-run"
        act={async () => {
          await deleteRun({ data: { runId } });
          await onDeleted();
        }}
      />
    </div>
  );
}
