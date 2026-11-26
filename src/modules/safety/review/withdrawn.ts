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
  moderationActions,
  outfitEntries,
  reviewQueue,
  takedownRequests,
  wardrobeItems,
} from "../../../db/schema-core";
import { newUlid } from "../../../lib/ids";
import { nowSeconds } from "../../../lib/now";
import { qualified } from "../../../lib/sql/qualified";
import { reportHidingAtOnce, requestHolds } from "../limits";
import { removalStatements } from "../rules";
import { moderationActionInsertWhere } from "../rules";
import {
  keptFingerprints,
  keptGarmentFingerprintWhere,
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
 * batch, ahead of the statement that settles their reviews: for each of
 * `ownerId`'s photos in scope that is under review as the batch reaches
 * it, a `withdrawn` audit row, then its fingerprint naming that row.
 * Nothing is read before the batch: the photos are chosen in SQL, so a
 * photo uploaded or reviewed since the delete began, or a review settled
 * since, is answered as it stands. `photosInScope` is a condition on
 * `entry_photos`.
 */
export function withdrawnUnderReview(
  db: Db,
  ownerId: string,
  photosInScope: SQL | undefined,
): BatchItem<"sqlite">[] {
  const createdAt = nowSeconds();
  const theirs = inArray(
    entryPhotos.entryId,
    db
      .select({ id: outfitEntries.id })
      .from(outfitEntries)
      .where(eq(outfitEntries.userId, ownerId)),
  );
  // One per photo, so minted in SQL as the fingerprints' ids are; the
  // record is found again below by what it says, which only this batch
  // writes: the owner, withdrawing this photo, in this second.
  const into = moderationActions;
  const records = db
    .select({
      id: sql<string>`lower(hex(randomblob(16)))`.as(into.id.name),
      actorId: sql<string>`${ownerId}`.as(into.actorId.name),
      action: sql<string>`${"withdrawn"}`.as(into.action.name),
      subjectType: sql<string>`${"photo"}`.as(into.subjectType.name),
      subjectId: sql<string>`${entryPhotos.id}`.as(into.subjectId.name),
      subjectOwnerId: sql<string>`${ownerId}`.as(into.subjectOwnerId.name),
      reason: sql<string>`${removalStatements.intimate}`.as(into.reason.name),
      preservedKey: sql<null>`null`.as(into.preservedKey.name),
      createdAt: sql<number>`${createdAt}`.as(into.createdAt.name),
      runId: sql<null>`null`.as(into.runId.name),
    })
    .from(entryPhotos)
    .where(and(photosInScope, theirs, underReview()));
  const recordOfThisPhoto = and(
    eq(into.action, "withdrawn"),
    eq(into.subjectType, "photo"),
    sql`${into.subjectId} = ${qualified(entryPhotos, entryPhotos.id)}`,
    eq(into.actorId, ownerId),
    eq(into.createdAt, createdAt),
  );
  const recordId = sql`(select ${into.id} from ${into} where ${recordOfThisPhoto} limit 1)`;
  const recorded = sql`exists (select 1 from ${into} where ${recordOfThisPhoto})`;
  return [
    db.insert(moderationActions).select(records),
    ...keptFingerprints(db, "intimate", recorded, recordId),
  ];
}

/**
 * The garment-photo form, for an owner's replace, remove or garment
 * delete: the same keep and record when the garment's photo is held as a
 * copy of a removed image and still under review as the batch reaches
 * it, with the fingerprint the garment has then. Nothing is read before
 * the batch, so it goes ahead of the review settle.
 */
export function withdrawnGarmentUnderReview(
  db: Db,
  ownerId: string,
  itemId: string,
): BatchItem<"sqlite">[] {
  const held = sql`exists (select 1 from ${reviewQueue} where ${inArray(reviewQueue.status, ["pending", "reviewing"])} and ${eq(reviewQueue.subjectType, "garment")} and ${eq(reviewQueue.subjectId, itemId)} and ${eq(reviewQueue.source, "fingerprint")})`;
  const theGarment = and(
    eq(wardrobeItems.id, itemId),
    eq(wardrobeItems.userId, ownerId),
    held,
  );
  const id = newUlid();
  return [
    moderationActionInsertWhere(
      db,
      {
        id,
        actorId: ownerId,
        action: "withdrawn",
        subjectType: "garment",
        subjectId: itemId,
        subjectOwnerId: ownerId,
        reason: removalStatements.intimate,
      },
      sql`exists (select 1 from ${wardrobeItems} where ${theGarment})`,
    ),
    ...keptGarmentFingerprintWhere(db, theGarment, id),
  ];
}
