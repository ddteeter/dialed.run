/**
 * An owner's delete of a kit photo under review (design 232, SA-M22).
 *
 * A runner told that their photo is hidden for review can delete it, and
 * the delete settles the review. What a person's Remove would have kept
 * is kept here instead, in the delete's batch: the photo's fingerprint,
 * so a copy the owner uploads again is held (D-147), and a `withdrawn` audit row
 * with the owner as its actor, which flags the account as a removal does
 * (D-161; owner, 2026-11-16).
 *
 * Only for a review a removal clock or a copy check opened: a report of
 * a reason that hides at once, a pending removal request that holds its
 * subject, or a fingerprint match. A fingerprint kept here holds only
 * this owner's uploads until their account is closed, and everyone's
 * from then (`removed-fingerprints.ts`). Any other delete keeps nothing. A garment photo is
 * never reported or requested, so only a fingerprint match counts there.
 */
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { drizzle } from "drizzle-orm/d1";

import {
  entryPhotos,
  outfitEntries,
  reviewQueue,
  takedownRequests,
  wardrobeItems,
} from "../../../db/schema-core";
import { newUlid } from "../../../lib/ids";
import { firstRowWhere } from "../../../lib/sql/keyed-read";
import { qualified } from "../../../lib/sql/qualified";
import { reportHidingAtOnce, requestHolds } from "../limits";
import { removalStatements } from "../rules";
import { moderationActionInsertWhere } from "../rules";
import {
  keptFingerprints,
  keptGarmentFingerprint,
} from "./removed-fingerprints";

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
 * report that hides at once, or a pending removal request that holds it
 * (`requestHolds`; it holds without a Review row). Over
 * `entry_photos`.
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
  return sql`(exists (select 1 from ${reviewQueue} where ${open} and ${queued} and ${cause}) or ${requestHolds(requested)})`;
}

/**
 * What an owner's delete of these kit photos keeps, for the delete's
 * batch, ahead of the statement that settles their reviews. The photos
 * are read first, since a batch cannot branch, and each keep is held to
 * the review again in SQL: a review settled since the read keeps
 * nothing. `photosInScope` is a condition on `entry_photos`; only
 * `ownerId`'s photos are read.
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
    const stillUnderReview = sql`${eq(entryPhotos.id, photo.id)} and ${underReview()}`;
    return [
      moderationActionInsertWhere(
        db,
        {
          id,
          actorId: ownerId,
          action: "withdrawn",
          subjectType: "photo",
          subjectId: photo.id,
          subjectOwnerId: ownerId,
          reason: removalStatements.intimate,
        },
        sql`exists (select 1 from ${entryPhotos} where ${stillUnderReview})`,
      ),
      ...keptFingerprints(db, "intimate", stillUnderReview, id),
    ];
  });
}

/**
 * The garment-photo form, for an owner's replace, remove or garment
 * delete: the same keep and record when the garment's photo is held as a
 * copy of a removed image and still under review. Read before the batch,
 * and held to it again in SQL: the review still open, and the garment
 * still the photo read. So it goes ahead of the review settle.
 */
export async function withdrawnGarmentUnderReview(
  db: Db,
  ownerId: string,
  itemId: string,
): Promise<BatchItem<"sqlite">[]> {
  const held = sql`exists (select 1 from ${reviewQueue} where ${inArray(reviewQueue.status, ["pending", "reviewing"])} and ${eq(reviewQueue.subjectType, "garment")} and ${eq(reviewQueue.subjectId, itemId)} and ${eq(reviewQueue.source, "fingerprint")})`;
  const item = await firstRowWhere(
    db,
    wardrobeItems,
    and(eq(wardrobeItems.id, itemId), eq(wardrobeItems.userId, ownerId), held),
  );
  if (item === undefined) return [];
  const id = newUlid();
  const asRead = and(
    eq(wardrobeItems.id, item.id),
    sql`${wardrobeItems.photoFingerprint} is ${item.photoFingerprint}`,
    held,
  );
  const stillHeld = sql`exists (select 1 from ${wardrobeItems} where ${asRead})`;
  return [
    moderationActionInsertWhere(
      db,
      {
        id,
        actorId: ownerId,
        action: "withdrawn",
        subjectType: "garment",
        subjectId: item.id,
        subjectOwnerId: ownerId,
        reason: removalStatements.intimate,
      },
      stillHeld,
    ),
    ...keptGarmentFingerprint(db, "intimate", item, id, stillHeld),
  ];
}
