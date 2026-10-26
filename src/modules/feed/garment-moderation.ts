/**
 * A garment's photo quarantined as suspected CSAM (design 157, D-70): the
 * closet's half of `moderation.ts`'s quarantine, for the one photo a
 * garment has.
 *
 * A garment photo reaches no other runner, but it is hosted here all the
 * same, and an operator who has seen apparent CSAM in one — through the
 * classifier's queue, the D-147 fingerprint hold, or a copy search — owes
 * the same report and the same year of preservation as for a kit photo.
 *
 * **The same order as a kit's**: every object under the photo's version is
 * copied to `quarantine/…` first, so a failed copy stops the removal; then
 * one batch clears the photo from the garment, settles its review, deletes
 * its screenings and writes the audit row and the locked record, with the
 * photo's prefix owed a delete (law 8c). The garment itself stays: the
 * photo was the content. **Nothing tells the owner** (D-70).
 *
 * In feed beside the kit's quarantine, not in closet or safety: it shares
 * `moderation.ts`'s outbox commit, and safety may not import ops.
 */
import { and, eq, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { photoScreenings, wardrobeItems } from "../../db/schema-core";
import { env } from "../../env";
import { quarantineKeyFor } from "../../lib/entry-photo-key";
import { newUlid } from "../../lib/ids";
import { nowSeconds } from "../../lib/now";
import { captureException, oweOutbox } from "../ops";
import {
  garmentPhotoForgotten,
  moderationActionInsert,
  quarantineInsert,
  removalStatements,
  uploaderContextOf,
  wasModerated,
  type RemovalReason,
} from "../safety";

import { commit, type Report, type Statements } from "./retract";

type Db = ReturnType<typeof drizzle<Record<string, never>>>;

export interface GarmentQuarantine {
  actorId: string;
  /**
  The garment whose photo it is.
  */
  itemId: string;
  reason: RemovalReason;
}

/**
 * `removed` when it was quarantined now; `already_removed` when the photo
 * is gone and the Desk acted on it before; `not_found` otherwise.
 */
export type GarmentQuarantineOutcome =
  | "removed"
  | "already_removed"
  | "not_found";

/**
 * The one copy a quarantine makes, shared with a kit's (`moderation.ts`) so
 * the two cannot drift on what is preserved: one object under the
 * quarantine prefix, and where it went and when R2 says it was uploaded.
 * Nothing when the object is already gone.
 */
export async function preserveObject(key: string) {
  const object = await env.MEDIA.get(key);
  if (object === null) return;
  const preservedKey = quarantineKeyFor(key);
  await env.MEDIA.put(preservedKey, object.body, {
    httpMetadata: object.httpMetadata ?? {},
  });
  return {
    preservedKey,
    uploadedAt: Math.floor(object.uploaded.getTime() / 1000),
  };
}

/**
 * Copies every object of the photo's version — the re-encoded original and
 * its sizes — under the quarantine prefix, and says for each where it went
 * and when R2 says it was uploaded. Listed rather than named, because an
 * original kept the extension it arrived with before it was re-encoded.
 * An object gone between the list and the copy is recorded by its key
 * alone, as a kit photo with no bytes is: the purge reads only the keys
 * that were preserved (`preservedKeysOf`).
 */
async function copyVersion(photoKey: string) {
  const listed = await env.MEDIA.list({ prefix: `${photoKey}/` });
  const copies = [];
  for (const { key } of listed.objects) {
    copies.push({ key, ...(await preserveObject(key)) });
  }
  return copies;
}

/**
 * The garment with a photo, as it stands, and what the screener said of
 * the photo — the record's snapshot. Nothing when there is no such garment
 * or it has no photo.
 */
async function garmentWithPhoto(db: Db, itemId: string) {
  const ofThisGarment = and(
    eq(photoScreenings.photoScope, "garment"),
    eq(photoScreenings.photoId, itemId),
  );
  const [items, screenings] = await db.batch([
    db.select().from(wardrobeItems).where(eq(wardrobeItems.id, itemId)),
    db.select().from(photoScreenings).where(ofThisGarment),
  ]);
  const [item] = items;
  if (item?.photoKey == undefined) return;
  return { item, photoKey: item.photoKey, screenings };
}

type Found = NonNullable<Awaited<ReturnType<typeof garmentWithPhoto>>>;

/**
 * The photo off the garment — only the version read, since a photo
 * replaced since is not the one preserved, and this must not clear it.
 */
function clearedPhoto(db: Db, { item, photoKey }: Found) {
  const sameVersion = and(
    eq(wardrobeItems.id, item.id),
    eq(wardrobeItems.photoKey, photoKey),
  );
  return db
    .update(wardrobeItems)
    .set({ photoKey: sql`NULL`, photoFingerprint: sql`NULL`, visibility: "ok" })
    .where(sameVersion);
}

/**
 * The quarantine's batch: the audit row, the photo's review and
 * screenings, the photo off the garment, and the locked record.
 */
async function quarantineWrites(
  db: Db,
  input: GarmentQuarantine,
  found: Found,
): Promise<Statements> {
  const { item, photoKey, screenings } = found;
  const copies = await copyVersion(photoKey);
  const actionId = newUlid();
  return [
    moderationActionInsert(db, {
      id: actionId,
      actorId: input.actorId,
      action: "quarantine",
      subjectType: "garment",
      subjectId: item.id,
      subjectOwnerId: item.userId,
      reason: removalStatements[input.reason],
      preservedKey: quarantineKeyFor(photoKey),
    }),
    ...garmentPhotoForgotten(db, input.actorId, item.id),
    clearedPhoto(db, found),
    quarantineInsert(db, {
      moderationActionId: actionId,
      subjectType: "garment",
      subjectId: item.id,
      uploaderId: item.userId,
      entrySnapshot: JSON.stringify({ item, screenings }),
      photosSnapshot: JSON.stringify(copies),
      uploaderSnapshot: await uploaderContextOf(db, item.userId),
      quarantinedAt: nowSeconds(),
    }),
  ];
}

/**
 * Quarantine a garment's photo: preserve it, take it off the garment, and
 * tell nobody. A garment with no photo is answered as a repeat when the
 * Desk took one before, and `not_found` otherwise.
 */
export async function quarantineGarmentPhoto(
  db: Db,
  input: GarmentQuarantine,
  report: Report = captureException,
): Promise<GarmentQuarantineOutcome> {
  const found = await garmentWithPhoto(db, input.itemId);
  if (found === undefined) {
    return (await wasModerated(db, "garment", input.itemId))
      ? "already_removed"
      : "not_found";
  }
  const { userId, id: itemId } = found.item;
  await commit(
    db,
    await quarantineWrites(db, input, found),
    [oweOutbox({ kind: "photo_delete", payload: { userId, itemId } })],
    report,
  );
  return "removed";
}
