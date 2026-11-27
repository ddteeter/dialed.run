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
import type { BatchItem } from "drizzle-orm/batch";
import type { drizzle } from "drizzle-orm/d1";

import {
  photoScreenings,
  reviewQueue,
  wardrobeItems,
} from "../../../db/schema-core";
import { env, primaryCoreDb } from "../../../env";
import { quarantineKeyFor } from "../../../lib/entry-photo-key";
import { newUlid } from "../../../lib/ids";
import { nowSeconds } from "../../../lib/now";
import { hasRowWhere } from "../../../lib/sql/keyed-read";
import { clearedPhoto } from "../../closet";
import { emailDebt } from "../../email";
import { notificationRaise } from "../../notifications";
import { oweOutbox } from "../../ops/outbox";
import { captureException } from "../../ops/sentry";
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
} from "../../safety";

import { commit, type Report, type Statements } from "../entries";

type Db = ReturnType<typeof drizzle<Record<string, never>>>;

export interface GarmentModeration {
  actorId: string;
  /**
  The garment whose photo it is.
  */
  itemId: string;
  action: "remove" | "quarantine";
  reason: RemovalReason;
  /**
   * A statement that fails the takedown's whole batch unless the Review
   * row the decision answers is still open as the page showed it
   * (`openSubject`'s `heldTo`). First in the batch. `refused` says whether
   * an error is that failure.
   */
  heldTo?: HeldTo | undefined;
}

/**
`openSubject`'s hold on a Review row, as a takedown carries it.
*/
export interface HeldTo {
  readonly statement: BatchItem<"sqlite">;
  readonly refused: (error: unknown) => boolean;
}

/**
 * What a quarantine writes if its batch is refused because the subject's
 * owner deleted it in the meantime: the audit row and the record, as the
 * batch held them, with the copies already made.
 */
export interface QuarantineLanding {
  readonly subjectType: "entry" | "photo" | "garment";
  readonly subjectId: string;
  readonly ownerId: string;
  readonly statements: Statements;
}

/**
 * A takedown's failure, passed on as it came — except a quarantine refused
 * by its Review row because the subject's owner deleted the subject, which
 * settled the row: its audit row and record are written all the same, and
 * nothing else, since the owner's delete took the rows. The copies of any
 * other refused quarantine stay until the quarantine purge's sweep of
 * copies no record lists.
 */
export async function passedOn(
  db: Db,
  error: unknown,
  heldTo: HeldTo | undefined,
  landing: QuarantineLanding | undefined,
  report: Report,
): Promise<void> {
  if (
    landing === undefined ||
    heldTo?.refused(error) !== true ||
    !(await wasSettledByOwner(landing))
  ) {
    throw error;
  }
  await commit(db, landing.statements, [], report);
}

/**
 * Whether the subject's owner settled a Review row on it as removed: what
 * their own delete does to an open row. Read from the primary.
 */
async function wasSettledByOwner(landing: QuarantineLanding): Promise<boolean> {
  return hasRowWhere(
    primaryCoreDb(),
    reviewQueue,
    reviewQueue.id,
    and(
      eq(reviewQueue.subjectType, landing.subjectType),
      eq(reviewQueue.subjectId, landing.subjectId),
      eq(reviewQueue.status, "removed"),
      eq(reviewQueue.resolvedBy, landing.ownerId),
    ),
  );
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
 * Nothing when the object is already gone. A copy already at its key is
 * kept as it is, and nothing is written over it.
 */
export async function preserveObject(key: string) {
  const object = await env.MEDIA.get(key);
  if (object === null) return;
  const preservedKey = quarantineKeyFor(key);
  const kept = await env.MEDIA.head(preservedKey);
  await (kept === null
    ? env.MEDIA.put(preservedKey, object.body, {
        httpMetadata: object.httpMetadata ?? {},
      })
    : object.body.cancel());
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
 * A statement that fails the takedown's whole batch unless the garment
 * still has the photo version the decision was made on, read when the
 * batch runs: it would set the garment's visibility, which may not be
 * empty, to nothing (a column this module already writes). First in the batch after any Review hold, so a photo its
 * owner replaced since is never cleared, forgotten or announced in the
 * old one's name. A garment deleted since matches nothing and refuses
 * nothing: the owner's delete already took its rows.
 */
function versionHeld(db: Db, { item, photoKey }: Found) {
  const sameVersion = sql`${wardrobeItems.photoKey} = ${photoKey}`;
  return db
    .update(wardrobeItems)
    .set({
      visibility: sql`(case when ${sameVersion} then ${wardrobeItems.visibility} else null end)`,
    })
    .where(eq(wardrobeItems.id, item.id));
}

/**
 * Whether an error is `versionHeld`'s refusal: SQLite's own words for a
 * NOT NULL refusal of `wardrobe_items.visibility`, wherever D1 or a
 * wrapper puts them in the message.
 */
function isVersionRefusal(error: unknown): boolean {
  return String(error).includes(
    "NOT NULL constraint failed: wardrobe_items.visibility",
  );
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
    clearedPhoto(db, { itemId: item.id, photoKey: found.photoKey }),
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
  const writes = takedownWrites(db, input, found, { id, preservedKey });
  const record = quarantineInsert(db, {
    moderationActionId: id,
    subjectType: "garment",
    subjectId: item.id,
    uploaderId: item.userId,
    entrySnapshot: JSON.stringify({ item, screenings }),
    photosSnapshot: JSON.stringify(copies),
    uploaderSnapshot: await uploaderContextOf(db, item.userId),
    quarantinedAt: nowSeconds(),
  });
  const kept: Statements = [writes[0], record];
  return {
    statements: [...writes, record] satisfies Statements,
    debts: [],
    kept,
    landing: {
      subjectType: "garment",
      subjectId: item.id,
      ownerId: item.userId,
      statements: kept,
    } satisfies QuarantineLanding,
  };
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
  const [audit, ...takedown] = takedownWrites(db, input, found, { id });
  const fingerprint = keptGarmentFingerprint(db, input.reason, item, id);
  const statements: Statements = [
    audit,
    ...takedown,
    ...fingerprint,
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
  return {
    statements,
    debts: [oweOutbox(email)],
    kept: [audit, ...fingerprint] satisfies Statements,
  };
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
  const { statements, debts, kept, landing } =
    input.action === "quarantine"
      ? await quarantineWrites(db, input, found)
      : { ...(await removalWrites(db, input, found)), landing: undefined };
  const { heldTo } = input;
  const versioned: Statements = [versionHeld(db, found), ...statements];
  const held: Statements =
    heldTo === undefined ? versioned : [heldTo.statement, ...versioned];
  try {
    await commit(
      db,
      held,
      [
        oweOutbox({ kind: "photo_delete", payload: { userId, itemId } }),
        ...debts,
      ],
      report,
    );
  } catch (error: unknown) {
    // The owner replaced the photo since it was read: the decision still
    // stands for the version it was made on, so its record lands (the
    // audit row, and the quarantine's record or the removal's kept
    // fingerprint), and nothing touches the photo the garment has now.
    await (isVersionRefusal(error)
      ? commit(db, kept, [], report)
      : passedOn(db, error, heldTo, landing, report));
  }
  return "removed";
}
