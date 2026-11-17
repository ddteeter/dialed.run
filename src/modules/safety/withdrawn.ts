/**
 * An owner's delete of a kit photo under review (design 232, SA-M22).
 *
 * A runner told that their photo is hidden for review can delete it, and
 * the delete settles the review. What a person's Remove would have kept
 * is kept here instead, in the delete's batch: the photo's fingerprint,
 * so a copy uploaded again is held (D-147), and a `withdrawn` audit row
 * with the owner as its actor, which flags the account as a removal does
 * (D-161; owner, 2026-11-16).
 *
 * Only for a review a removal clock or a copy check opened: a report of
 * a reason that hides at once, a pending removal request, or a
 * fingerprint match. Any other delete keeps nothing.
 */
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { drizzle } from "drizzle-orm/d1";

import {
  entryPhotos,
  outfitEntries,
  reviewQueue,
  takedownRequests,
} from "../../db/schema-core";
import { newUlid } from "../../lib/ids";
import { qualified } from "../../lib/sql/qualified";
import { reportHidingAtOnce } from "./at-once";
import { removalStatements } from "./contracts";
import { moderationActionInsert } from "./moderation-actions";
import { keptFingerprints } from "./removed-fingerprints";

type Db = ReturnType<typeof drizzle>;

/**
 * The subject a correlated read names is this kit photo, or its kit: for
 * a `subject_type`/`subject_id` pair of `table`, over `entry_photos` as
 * the outer table.
 */
function namesPhotoOrKit(type: SQL, id: SQL): SQL {
  const photo = sql`(${type} = 'photo' and ${id} = ${qualified(entryPhotos, entryPhotos.id)})`;
  const kit = sql`(${type} = 'entry' and ${id} = ${qualified(entryPhotos, entryPhotos.entryId)})`;
  return sql`(${photo} or ${kit})`;
}

/**
 * The kit photo, or its kit, is under a review a removal clock or a copy
 * check opened: an open Review row from a fingerprint match or with a
 * report that hides at once, or a pending removal request (which holds
 * its subject without a Review row). Over `entry_photos`.
 */
function underReview(): SQL {
  const open = inArray(reviewQueue.status, ["pending", "reviewing"]);
  const queued = namesPhotoOrKit(
    qualified(reviewQueue, reviewQueue.subjectType),
    qualified(reviewQueue, reviewQueue.subjectId),
  );
  const cause = sql`(${eq(reviewQueue.source, "fingerprint")} or ${reportHidingAtOnce()})`;
  const requested = namesPhotoOrKit(
    qualified(takedownRequests, takedownRequests.subjectType),
    qualified(takedownRequests, takedownRequests.subjectId),
  );
  return sql`(exists (select 1 from ${reviewQueue} where ${open} and ${queued} and ${cause}) or exists (select 1 from ${takedownRequests} where ${qualified(takedownRequests, takedownRequests.status)} = 'pending' and ${requested}))`;
}

/**
 * What an owner's delete of these kit photos keeps, for the delete's
 * batch, ahead of the statements that take the photos: read first,
 * since a batch cannot branch. `photosInScope` is a condition on
 * `entry_photos`; only `ownerId`'s photos are read.
 */
export async function withdrawnUnderReview(
  db: Db,
  ownerId: string,
  photosInScope: SQL | undefined,
): Promise<BatchItem<"sqlite">[]> {
  const withdrawn = await db
    .select({ id: entryPhotos.id })
    .from(entryPhotos)
    .innerJoin(outfitEntries, eq(outfitEntries.id, entryPhotos.entryId))
    .where(
      and(photosInScope, eq(outfitEntries.userId, ownerId), underReview()),
    );
  return withdrawn.flatMap((photo) => {
    const id = newUlid();
    return [
      moderationActionInsert(db, {
        id,
        actorId: ownerId,
        action: "withdrawn",
        subjectType: "photo",
        subjectId: photo.id,
        subjectOwnerId: ownerId,
        reason: removalStatements.intimate,
      }),
      ...keptFingerprints(db, "intimate", eq(entryPhotos.id, photo.id), id),
    ];
  });
}
