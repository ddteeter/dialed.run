import { useRouter } from "@tanstack/react-router";
import type { JSX } from "react";

import { entryPhotoIdOf } from "../../../lib/entry-photo-key";
import { ConfirmLink } from "../../../ui";

/**
 * An entry's owner taking it back (task 128 · SAF-3): the entry, or one
 * photo on it.
 *
 * **Undrawn.** The packet's design ask is "the D/E1 overflow"; until it
 * comes back these are text links at the foot of D, in the report link's
 * grammar, each opening round 22's confirm sheet. Listed as a design delta.
 *
 * Nothing renders for anyone but the owner — the same decision
 * `ReportAffordance` makes the other way round, and made here rather than
 * in the route because a route may not branch.
 */
export function RetractEntry({
  entry,
  viewerId,
  retract,
  deletePhoto,
  onRetracted,
}: Readonly<{
  entry: { id: string; userId: string; photoKeys: readonly string[] };
  viewerId: string;
  retract: (input: { data: { entryId: string } }) => Promise<unknown>;
  deletePhoto: (input: { data: { photoId: string } }) => Promise<unknown>;
  /**
  Where the runner lands once the entry is gone — it has no page any more.
  */
  onRetracted: () => Promise<void>;
}>): JSX.Element | undefined {
  const router = useRouter();
  if (entry.userId !== viewerId) return undefined;

  return (
    <div data-part="retract" className="flex flex-col items-start">
      {entry.photoKeys.map((key, index) => (
        <ConfirmLink
          key={key}
          label={`Delete photo ${String(index + 1)}`}
          heading={`Delete photo ${String(index + 1)}?`}
          body="It comes off this entry and out of storage. This can't be undone."
          verb="Delete"
          pendingVerb="Deleting"
          kicker="Photo kept"
          state="confirm-delete-photo"
          act={async () => {
            await deletePhoto({ data: { photoId: entryPhotoIdOf(key) } });
            await router.invalidate();
          }}
        />
      ))}
      <ConfirmLink
        label="Delete this entry"
        heading="Delete this entry?"
        body="Its kit, verdict and photos go, and it leaves every feed. The run stays. This can't be undone."
        verb="Delete"
        pendingVerb="Deleting"
        kicker="Not deleted"
        state="confirm-delete-entry"
        act={async () => {
          await retract({ data: { entryId: entry.id } });
          await onRetracted();
        }}
      />
    </div>
  );
}
