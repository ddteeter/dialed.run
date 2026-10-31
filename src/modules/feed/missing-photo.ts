/**
 * The Desk's **Clear photo** (D-153, design 167; owner, 2026-10-31): a
 * photo still pending a day after upload whose file is not in storage
 * comes off its kit or garment, and its owner is asked to add it again.
 *
 * **Not a moderation verdict.** Nothing was wrong with the photo; there
 * is no photo. So it cites no rule and writes no `moderation_actions` row
 * — that table is what a runner's run reads back as "removed by a
 * moderator" (R-140) — and the queue row, settled by the reviewer, is the
 * record of who cleared it.
 *
 * **D1 first, the bytes owed (law 8c).** One batch takes the photo off,
 * settles its review, deletes its screenings and raises the owner's bell
 * row, with an outbox debt owing storage a reconcile in the same batch.
 * The fast path then settles the debt, and a storage failure there is
 * reported, not thrown (law 5): the clear has happened, and the drainer
 * finishes it. There is usually nothing in storage to delete; the
 * reconcile is owed anyway, because a part of the upload may have landed.
 */
import { and, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { entryPhotos, wardrobeItems } from "../../db/schema-core";
import { garmentVersionId } from "../../lib/garment-photo-key";
import { ulidSeconds } from "../../lib/ids";
import { nowSeconds } from "../../lib/now";
import { notificationRaise } from "../notifications";
import { captureException, oweOutbox } from "../ops";
import {
  garmentPhotoForgotten,
  isStuck,
  openReviewRow,
  type ResolveOutcome,
  type ReviewSubjectType,
} from "../safety";

import { clearedPhoto } from "./garment-moderation";
import {
  commit,
  entryPhotoWhere,
  mediaDebts,
  photoDeletion,
  type Report,
} from "./retract";

type Db = ReturnType<typeof drizzle<Record<string, never>>>;

/**
 * What the owner is told, by what the photo was on. It names no rule and
 * no moderator, because neither had a part in it: the file never arrived.
 */
export const MISSING_PHOTO_NOTICE = {
  photo:
    "We couldn't find the file for a photo on your run, so we took it off your kit. Add it again if you'd like it there.",
  garment:
    "We couldn't find the file for the photo on one of your garments, so we took it off. Add it again from your Closet if you'd like it there.",
} as const;

type ClearedSubject = keyof typeof MISSING_PHOTO_NOTICE;

interface Clearing {
  db: Db;
  reviewerId: string;
  subjectId: string;
  report: Report;
  now: number;
}

/**
 * Clears the photo a `missing_file` row is about. `resolved` when it came
 * off now; `not_found` when the row is about something else or the photo
 * is no longer the stuck one (screened since, or a garment's photo
 * replaced within the day), and safety's answer for a row already settled
 * or gone.
 */
export async function clearMissingPhoto(
  db: Db,
  reviewerId: string,
  queueId: string,
  report: Report = captureException,
  now: number = nowSeconds(),
): Promise<ResolveOutcome> {
  const row = await openReviewRow(queueId);
  if (typeof row === "string") return row;
  const clear = clearers[row.subjectType];
  if (clear === undefined || row.source !== "missing_file") return "not_found";
  const hasCleared = await clear({
    db,
    reviewerId,
    subjectId: row.subjectId,
    report,
    now,
  });
  return hasCleared ? "resolved" : "not_found";
}

/**
 * The owner's bell row, raised rather than inserted: a garment can lose a
 * second photo the same way, and is told again.
 */
function reuploadNotice(
  db: Db,
  userId: string,
  subject: ClearedSubject,
  subjectId: string,
) {
  return notificationRaise(db, {
    userId,
    kind: "photo_missing",
    subjectId,
    body: MISSING_PHOTO_NOTICE[subject],
  });
}

/**
 * A kit's photo: its row and the entry it is on, while it is still
 * pending — a photo screened since is no longer the one the row is about.
 */
async function wasEntryPhotoCleared({
  db,
  reviewerId,
  subjectId,
  report,
}: Clearing): Promise<boolean> {
  const photo = await entryPhotoWhere(
    db,
    and(eq(entryPhotos.id, subjectId), eq(entryPhotos.screenStatus, "pending")),
  );
  if (photo === undefined) return false;
  await commit(
    db,
    [
      ...photoDeletion(db, subjectId, reviewerId),
      reuploadNotice(db, photo.ownerId, "photo", subjectId),
    ],
    mediaDebts(photo.ownerId, [photo.entryId]),
    report,
  );
  return true;
}

/**
 * A garment's photo, while it is pending and its version is a day old: a
 * version uploaded within the day is the owner adding it again, which the
 * row is not about and this must not take off.
 */
async function wasGarmentPhotoCleared({
  db,
  reviewerId,
  subjectId,
  report,
  now,
}: Clearing): Promise<boolean> {
  const [item] = await db
    .select({ userId: wardrobeItems.userId, photoKey: wardrobeItems.photoKey })
    .from(wardrobeItems)
    .where(
      and(
        eq(wardrobeItems.id, subjectId),
        eq(wardrobeItems.visibility, "pending"),
      ),
    )
    .limit(1);
  if (item?.photoKey == undefined) return false;
  const { userId, photoKey } = item;
  if (!isStuck(ulidSeconds(garmentVersionId(photoKey)), now)) return false;
  await commit(
    db,
    [
      clearedPhoto(db, { item: { id: subjectId }, photoKey }),
      ...garmentPhotoForgotten(db, reviewerId, subjectId),
      reuploadNotice(db, userId, "garment", subjectId),
    ],
    [
      oweOutbox({
        kind: "photo_delete",
        payload: { userId, itemId: subjectId },
      }),
    ],
    report,
  );
  return true;
}

/**
 * Which subjects have a photo to clear, by the queue's subject type: a
 * kit's photo and a garment's. Anything else has none.
 */
const clearers: Partial<
  Record<ReviewSubjectType, (clearing: Clearing) => Promise<boolean>>
> = {
  photo: wasEntryPhotoCleared,
  garment: wasGarmentPhotoCleared,
};
