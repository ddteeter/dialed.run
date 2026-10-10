import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { JSX } from "react";

import { entryPhotoIdOf } from "../../../lib/entry-photo-key";
import {
  ConfirmLink,
  ConfirmSheet,
  FormStatus,
  Icon,
  Mono,
  PHOTO_STILL_ON,
  useControlAction,
} from "../../../ui";

/**
 * An entry's owner taking it back (task 128 · SAF-3), as round 27 #26
 * draws D's foot: a `YOURS` kicker over "Delete this entry", owner only,
 * with no overflow menu. The photos' deletes are not here: each is an
 * icon button on its own photo (`DeletePhoto`).
 *
 * Nothing renders for anyone but the owner — the same decision
 * `ReportAffordance` makes the other way round, and made here rather than
 * in the route because a route may not branch. The board's "Edit this
 * entry" above the delete has nothing to open yet, so it is absent.
 */
export function RetractEntry({
  entry,
  viewerId,
  retract,
  onRetracted,
}: Readonly<{
  entry: { id: string; userId: string };
  viewerId: string;
  retract: (input: { data: { entryId: string } }) => Promise<unknown>;
  /**
  Where the runner lands once the entry is gone — it has no page any more.
  */
  onRetracted: () => Promise<void>;
}>): JSX.Element | undefined {
  if (entry.userId !== viewerId) return undefined;

  return (
    <div
      data-part="retract"
      className="mx-auto flex w-full max-w-column flex-col items-start px-5 pb-8 wide:mx-0"
    >
      <div className="flex w-full flex-col items-start gap-1 border-t border-hairline pt-4">
        <Mono step="xs" className="text-muted">
          Yours
        </Mono>
        <ConfirmLink
          label="Delete this entry"
          heading="Delete this entry?"
          body="Your verdict, kit and note for this run go, and it leaves the feed and your Call's record. The run stays. This can't be undone."
          verb="Delete entry"
          pendingVerb="Deleting"
          kicker="Not deleted"
          state="confirm-delete-entry"
          act={async () => {
            await retract({ data: { entryId: entry.id } });
            await onRetracted();
          }}
        />
      </div>
    </div>
  );
}

/**
What a photo's delete is handed: which photo, and the server function.
*/
export interface DeletePhotoProps {
  photoKey: string;
  /**
  Its place on the entry, from 0 — the name says "Delete photo 2".
  */
  index: number;
  deletePhoto: (input: { data: { photoId: string } }) => Promise<unknown>;
}

/**
 * One photo's delete, on the photo (round 27 #26; round 28 #14): a 44×44
 * icon button, top right, drawing the pack's `remove` and named "Delete
 * photo 2". It opens round 27's photo sheet; a failure keeps the sheet
 * open over `PHOTO STILL ON` (round 28 #13).
 *
 * The host decides who sees it — D shows it on the owner's photos only.
 */
export function DeletePhoto(props: Readonly<DeletePhotoProps>): JSX.Element {
  const [isAsking, setIsAsking] = useState(false);
  const name = `Delete photo ${String(props.index + 1)}`;
  return (
    <>
      <button
        type="button"
        aria-label={name}
        onClick={() => {
          setIsAsking(true);
        }}
        className="target absolute top-2 right-2 grid size-11 cursor-pointer place-items-center rounded-pill border-none bg-ground p-0 text-ink"
      >
        <Icon name="remove" size={20} />
      </button>
      {isAsking ? (
        <AskToDeletePhoto
          {...props}
          heading={`${name}?`}
          onDone={() => {
            setIsAsking(false);
          }}
        />
      ) : undefined}
    </>
  );
}

/**
 * The open sheet and its action, mounted only while asking: a fresh
 * action each time, so a failure from a sheet already closed is never on
 * the next one, and its status region is on the page only while there is
 * something to say (rule 08).
 */
function AskToDeletePhoto({
  photoKey,
  deletePhoto,
  heading,
  onDone,
}: Readonly<DeletePhotoProps & { heading: string; onDone: () => void }>) {
  const router = useRouter();
  const deleting = useControlAction({
    kicker: PHOTO_STILL_ON,
    action: async () => {
      await deletePhoto({ data: { photoId: entryPhotoIdOf(photoKey) } });
      await router.invalidate();
      onDone();
    },
  });
  return (
    <>
      <FormStatus>{deleting.status}</FormStatus>
      <ConfirmSheet
        open
        heading={heading}
        body="It comes off this entry for everyone. The entry and its other photos stay. This can't be undone."
        verb="Delete photo"
        pendingVerb="Deleting"
        state="confirm-delete-photo"
        action={deleting}
        onClose={onDone}
      />
    </>
  );
}
