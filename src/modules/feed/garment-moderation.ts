/**
 * A garment's photo taken down by a person: a Remove, which tells its
 * owner (R-167, design 159), or a quarantine as suspected CSAM, which
 * tells nobody (design 157, D-70) — the closet's half of `moderation.ts`,
 * for the one photo a garment has.
 *
 * A garment photo reaches no other runner, but it is hosted here all the
 * same, and an operator who has seen it break the rules — through the
 * classifier's queue, the D-147 fingerprint hold, or a copy search — owes
 * its owner the same statement of reasons as for a kit photo, and, for
 * apparent CSAM, the same report and year of preservation.
 *
 * **The same order as a kit's**: a quarantine copies every object under
 * the photo's version to `quarantine/…` first, so a failed copy stops the
 * removal; then one batch clears the photo from the garment, settles its
 * review, deletes its screenings and writes the audit row — with the
 * locked record for a quarantine, or the owner's bell row and email debt
 * for a Remove — and the photo's prefix is owed a delete (law 8c). The
 * garment itself stays: the photo was the content.
 *
 * In feed beside the kit's, not in closet or safety: it shares
 * `moderation.ts`'s outbox commit, and safety may not import ops.
 */
import { and, eq, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { photoScreenings, wardrobeItems } from "../../db/schema-core";
import { env } from "../../env";
import { quarantineKeyFor } from "../../lib/entry-photo-key";
import { newUlid } from "../../lib/ids";
import { nowSeconds } from "../../lib/now";
import { emailDebt } from "../email";
import { notificationRaise } from "../notifications";
import { captureException, oweOutbox } from "../ops";
import {
  garmentPhotoForgotten,
  garmentRemovalNotice,
  keptGarmentFingerprint,
  moderationActionInsert,
  quarantineInsert,
  removalRuleOf,
  removalStatements,
  uploaderContextOf,
  wasFlaggedAutomatically,
  wasModerated,
  type RemovalReason,
} from "../safety";

import { commit, type Report, type Statements } from "./retract";

type Db = ReturnType<typeof drizzle<Record<string, never>>>;

export interface GarmentModeration {
  actorId: string;
  /**
  The garment whose photo it is.
  */
  itemId: string;
  action: "remove" | "quarantine";
  reason: RemovalReason;
}

/**
 * `removed` when it was taken down now; `already_removed` when the photo
 * is gone and the Desk acted on it before; `not_found` otherwise.
 */
export type GarmentModerationOutcome =
  "removed" | "already_removed" | "not_found";

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
 * replaced since is not the one decided on, and this must not clear it.
 * Also the Desk's Clear photo on a garment whose file is missing (D-153).
 */
export function clearedPhoto(
  db: Db,
  { item, photoKey }: { item: { id: string }; photoKey: string },
) {
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
 * What every takedown of the photo writes, whichever it is: the audit row,
 * the photo's review and screenings, and the photo off the garment.
 */
function takedownWrites(
  db: Db,
  input: GarmentModeration,
  found: Found,
  record: { id: string; preservedKey?: string },
): Statements {
  const { item } = found;
  return [
    moderationActionInsert(db, {
      ...record,
      actorId: input.actorId,
      action: input.action,
      subjectType: "garment",
      subjectId: item.id,
      subjectOwnerId: item.userId,
      reason: removalStatements[input.reason],
    }),
    ...garmentPhotoForgotten(db, input.actorId, item.id),
    clearedPhoto(db, found),
  ];
}

/**
 * The quarantine's batch: the takedown, and the locked record. Tells
 * nobody (D-70).
 */
async function quarantineWrites(
  db: Db,
  input: GarmentModeration,
  found: Found,
) {
  const { item, photoKey, screenings } = found;
  const copies = await copyVersion(photoKey);
  const id = newUlid();
  const preservedKey = quarantineKeyFor(photoKey);
  const statements: Statements = [
    ...takedownWrites(db, input, found, { id, preservedKey }),
    quarantineInsert(db, {
      moderationActionId: id,
      subjectType: "garment",
      subjectId: item.id,
      uploaderId: item.userId,
      entrySnapshot: JSON.stringify({ item, screenings }),
      photosSnapshot: JSON.stringify(copies),
      uploaderSnapshot: await uploaderContextOf(db, item.userId),
      quarantinedAt: nowSeconds(),
    }),
  ];
  return { statements, debts: [] };
}

/**
 * The Remove's batch (R-167, design 159): the takedown, the fingerprint an
 * intimate image keeps (D-147), and the owner told — the bell row and the
 * email, in the owner's words (2026-10-26). The email names the rule and
 * who decided, read before the batch settles the review that says whether
 * the automatic check flagged it.
 *
 * The bell row is raised rather than inserted: its subject is the garment,
 * and a later photo on the same garment can be removed too. The email is
 * deduplicated by the photo's version for the same reason.
 */
async function removalWrites(db: Db, input: GarmentModeration, found: Found) {
  const { item, photoKey } = found;
  const id = newUlid();
  const isFlagged = await wasFlaggedAutomatically(db, "garment", item.id);
  const statements: Statements = [
    ...takedownWrites(db, input, found, { id }),
    ...keptGarmentFingerprint(db, input.reason, item, id),
    notificationRaise(db, {
      userId: item.userId,
      kind: "content_removed",
      subjectId: item.id,
      body: garmentRemovalNotice(input.reason),
    }),
  ];
  const email = emailDebt(
    {
      to: { userId: item.userId },
      template: {
        kind: "content_removed",
        subject: "garment",
        reason: removalStatements[input.reason],
        rule: removalRuleOf(input.action, input.reason),
        flagged: isFlagged,
      },
    },
    { dedupeKey: `content_removed:garment:${photoKey}` },
  );
  return { statements, debts: [oweOutbox(email)] };
}

/**
 * Take a garment's photo down: a Remove tells its owner, a quarantine
 * preserves it and tells nobody. A garment with no photo is answered as a
 * repeat when the Desk took one before, and `not_found` otherwise.
 */
export async function moderateGarmentPhoto(
  db: Db,
  input: GarmentModeration,
  report: Report = captureException,
): Promise<GarmentModerationOutcome> {
  const found = await garmentWithPhoto(db, input.itemId);
  if (found === undefined) {
    return (await wasModerated(db, "garment", input.itemId))
      ? "already_removed"
      : "not_found";
  }
  const { userId, id: itemId } = found.item;
  const { statements, debts } =
    input.action === "quarantine"
      ? await quarantineWrites(db, input, found)
      : await removalWrites(db, input, found);
  await commit(
    db,
    statements,
    [
      oweOutbox({ kind: "photo_delete", payload: { userId, itemId } }),
      ...debts,
    ],
    report,
  );
  return "removed";
}
