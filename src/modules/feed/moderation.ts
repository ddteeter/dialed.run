/**
 * A moderator's Remove, a suspected-CSAM quarantine and a copyright
 * takedown (task 128 · SAF-5, SAF-6), and the notice a Remove or takedown
 * owes its author (SAF-8): the bell row and the email, in one batch.
 *
 * **Removal deletes.** It used to set `moderation_status = 'removed'` and
 * leave the bytes where they were (audit 0.9). It now goes through the
 * same statements and the same outbox path a runner's own delete does
 * (`retract.ts`): every row in one `db.batch()` with the audit row, the
 * notice and an outbox debt owing R2 a reconcile, then the fast path.
 *
 * **A copyright takedown hides instead** (D-130, design 149): the rows
 * and bytes stay, a `copyright_holds` row is written with the hide, and
 * the author is told exactly as before. `sweepCopyrightHolds` puts it
 * back after a counter-notice, or deletes it here 30 days on, with the
 * statements a Remove uses. A removal request's takedown still deletes.
 *
 * **Quarantine is silent and keeps everything** (decision D-70). Before
 * the batch, each photo's bytes are copied to `quarantine/…`
 * (`quarantineKeyFor`), outside the `entries/` prefix a runner's photo
 * route serves, and the rows about to be deleted are read. The batch then
 * deletes as a Remove does — which hides the content from every read at
 * once — and writes those rows, the uploader and the copies' keys to
 * `quarantined_content`, a locked table only an admin reads, kept a year
 * for the owner's report to NCMEC. **Nothing tells the uploader**: no bell
 * row, no email. The copy goes first because a failed copy must stop the
 * delete — losing the evidence is the one outcome worse than a retry.
 *
 * **It lives in feed, not safety**, because the arrow runs feed → safety
 * (`docs/architecture.md`): the deletion statements are feed's, and safety
 * imports nothing from feed.
 */
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { drizzle } from "drizzle-orm/d1";

import {
  entryPhotos,
  entryTags,
  outfitEntries,
  outfitEntryItems,
} from "../../db/schema-core";
import { coreDb, env } from "../../env";
import {
  entryPhotoKeyFor,
  entryPhotoPrefix,
  quarantineKeyFor,
} from "../../lib/entry-photo-key";
import { newUlid } from "../../lib/ids";
import { nowSeconds } from "../../lib/now";
import { emailDebt } from "../email";
import { notificationInsert } from "../notifications";
import { captureException, oweOutbox } from "../ops";
import {
  moderationActionInsert,
  claimDuePurges,
  claimPurgeAfterCase,
  copyrightHoldWrites,
  isCopyrightHeld,
  openSubject,
  purgedWrite,
  restoreDueHolds,
  isCopyrightTakedown,
  keptFingerprints,
  quarantineInsert,
  removalNotice,
  removalRuleOf,
  removalStatements,
  reporterNotices,
  resolveReview,
  settleOpenReviews,
  wasFlaggedAutomatically,
  wasModerated,
  type CaseOverOutcome,
  type ClaimedPurge,
  type RemovalReason,
  type ResolveOutcome,
  type ReviewActionValues,
} from "../safety";

import {
  commit,
  entryStatements,
  mediaDebts,
  owned,
  type Report,
  type Statements,
} from "./retract";

/**
 * The handle every writer here shares: drizzle's own default schema type,
 * which is what `notificationInsert` takes.
 */
type Db = ReturnType<typeof drizzle<Record<string, never>>>;

export type ModeratedSubjectType = "entry" | "photo";

export interface ModerateInput {
  actorId: string;
  action: "remove" | "quarantine" | "takedown";
  subjectType: ModeratedSubjectType;
  subjectId: string;
  reason: RemovalReason;
  /**
   * A takedown's notice — who sent it and its reference — recorded on the
   * audit row after the reason. The runner is told the reason only.
   */
  notice?: string | undefined;
}

/**
 * `already_removed`: the subject is gone and the Desk took it down before —
 * a repeat, answered without writing anything.
 */
export type ModerateOutcome = "removed" | "already_removed" | "not_found";

/**
What is being taken down: whose it is, which entry, and which objects.
*/
interface Target {
  ownerId: string;
  entryId: string;
  /**
  The entry's run, which the audit row keeps for the author's band (R-140).
  */
  runId: string;
  photoKeys: readonly string[];
}

async function targetOf(
  db: Db,
  subjectType: ModeratedSubjectType,
  subjectId: string,
): Promise<Target | undefined> {
  // One read for both: an entry with every photo on it, or the one photo
  // with its entry. Either way the rows share an owner and an entry.
  const rows = await db
    .select(targetColumns)
    .from(outfitEntries)
    .leftJoin(entryPhotos, eq(entryPhotos.entryId, outfitEntries.id))
    .where(eq(subjectColumn[subjectType], subjectId));
  const [first] = rows;
  if (first === undefined) return undefined;
  return {
    ownerId: first.ownerId,
    entryId: first.entryId,
    runId: first.runId,
    photoKeys: rows.flatMap((row) => row.photoKey ?? []),
  };
}

/**
What `targetOf` reads for each row.
*/
const targetColumns = {
  ownerId: outfitEntries.userId,
  entryId: outfitEntries.id,
  runId: outfitEntries.runId,
  photoKey: entryPhotos.photoKey,
};

/**
Which id a subject is named by.
*/
const subjectColumn = {
  entry: outfitEntries.id,
  photo: entryPhotos.id,
} as const;

/**
 * Copies each photo's bytes under the quarantine prefix, and says, by the
 * photo's key, where each went and when R2 says it was uploaded. A photo
 * whose object is already gone has nothing to copy and no entry here.
 */
async function copyBytes(photoKeys: readonly string[]) {
  const copies = new Map<
    string,
    { preservedKey: string; uploadedAt: number }
  >();
  for (const photoKey of photoKeys) {
    const object = await env.MEDIA.get(photoKey);
    if (object === null) continue;
    const preservedKey = quarantineKeyFor(photoKey);
    await env.MEDIA.put(preservedKey, object.body, {
      httpMetadata: object.httpMetadata ?? {},
    });
    copies.set(photoKey, {
      preservedKey,
      uploadedAt: Math.floor(object.uploaded.getTime() / 1000),
    });
  }
  return copies;
}

/**
 * The rows a quarantine is about to delete, as they stand: the entry, its
 * items and tags, and the photos in scope — one batch of reads.
 */
/**
The subject's photos: the one photo, or every photo on the entry.
*/
function photosInScope(input: ModerateInput, target: Target) {
  return input.subjectType === "photo"
    ? eq(entryPhotos.id, input.subjectId)
    : eq(entryPhotos.entryId, target.entryId);
}

/**
 * What a Remove or takedown for `intimate` keeps of its photos (D-147,
 * design 152): their fingerprints, so a re-upload is caught. A quarantine
 * keeps its own snapshot (D-70), and a copyright hold keeps the photos.
 */
function fingerprintWrites(
  db: Db,
  input: ModerateInput,
  target: Target,
  actionId: string,
) {
  return input.action === "quarantine"
    ? []
    : keptFingerprints(
        db,
        input.reason,
        photosInScope(input, target),
        actionId,
      );
}

async function rowsOf(db: Db, target: Target, input: ModerateInput) {
  const [entry, items, tags, photos] = await db.batch([
    db.select().from(outfitEntries).where(eq(outfitEntries.id, target.entryId)),
    db
      .select()
      .from(outfitEntryItems)
      .where(eq(outfitEntryItems.entryId, target.entryId)),
    db.select().from(entryTags).where(eq(entryTags.entryId, target.entryId)),
    db.select().from(entryPhotos).where(photosInScope(input, target)),
  ]);
  return { entry: { entry, items, tags }, photos };
}

/**
 * Everything a quarantine keeps, ready for the batch: the bytes are copied
 * now, and the rows are read now, so the statement that preserves them
 * lands with the deletes.
 */
async function preservation(
  db: Db,
  target: Target,
  input: ModerateInput,
  actionId: string,
): Promise<{ preservedKey: string; record: BatchItem<"sqlite"> }> {
  const copyOf = await copyBytes(target.photoKeys);
  const rows = await rowsOf(db, target, input);
  const photos = rows.photos.map((photo) => ({
    ...photo,
    ...copyOf.get(photo.photoKey),
  }));
  const preservedKey = quarantineKeyFor(
    input.subjectType === "photo"
      ? entryPhotoKeyFor(target.ownerId, target.entryId, input.subjectId)
      : entryPhotoPrefix(target.ownerId, target.entryId),
  );
  return {
    preservedKey,
    record: quarantineInsert(db, {
      moderationActionId: actionId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      uploaderId: target.ownerId,
      entryId: target.entryId,
      entrySnapshot: JSON.stringify(rows.entry),
      photosSnapshot: JSON.stringify(photos),
      quarantinedAt: nowSeconds(),
    }),
  };
}

/**
 * The row statements for the subject: the photo and its open review, or
 * the entry and everything hung on it — settled by the moderator.
 */
function deletions(
  db: Db,
  input: Pick<ModerateInput, "actorId" | "subjectType" | "subjectId">,
  target: Pick<Target, "ownerId">,
): Statements {
  return input.subjectType === "photo"
    ? [
        settleOpenReviews(db, "photo", [input.subjectId], input.actorId),
        db.delete(entryPhotos).where(eq(entryPhotos.id, input.subjectId)),
      ]
    : entryStatements(
        db,
        target.ownerId,
        owned(db, outfitEntries, target.ownerId, [input.subjectId]),
        input.actorId,
      );
}

/**
 * What a Remove or takedown tells its author: the bell row and the email,
 * both in the batch. The email rides the outbox; its debt is returned so
 * the fast path can settle it after the batch.
 *
 * **One sentence in all three** (round 27 #20, R-140): a copyright
 * takedown's bell row says "We removed this photo after a copyright
 * notice.", as its band does, and its email says the same rather than
 * quoting the moderator's reason. `action` is what decides, with the
 * reason (`isCopyrightTakedown`): a removal request's takedown carries
 * `intimate` and answered no copyright notice.
 *
 * **The email is the full statement of reasons** (C8, D-145): the rule
 * it broke, unless a copyright notice is why, and whether the automatic
 * check flagged it before a person decided.
 */
async function authorNotice(
  db: Db,
  input: ModerateInput,
  action: "remove" | "takedown",
  target: Target,
) {
  const rule = removalRuleOf(action, input.reason);
  const isFlagged = await wasFlaggedAutomatically(
    db,
    input.subjectType,
    input.subjectId,
  );
  const debt = oweOutbox(
    emailDebt(
      {
        to: { userId: target.ownerId },
        template: {
          kind: "content_removed",
          subject: input.subjectType,
          reason: removalStatements[input.reason],
          ...(isCopyrightTakedown(action, input.reason) && {
            cause: "copyright_notice" as const,
          }),
          rule,
          flagged: isFlagged,
        },
      },
      { dedupeKey: `content_removed:${input.subjectType}:${input.subjectId}` },
    ),
  );
  return {
    statement: notificationInsert(db, {
      userId: target.ownerId,
      kind: "content_removed",
      subjectId: input.subjectId,
      body: removalNotice(input.subjectType, action, input.reason),
    }),
    debt,
  };
}

/**
 * Takes the subject down and records it — one batch, then the bytes. A
 * Remove or takedown tells its author; a quarantine preserves instead,
 * and tells nobody.
 */
export async function moderateContent(
  db: Db,
  input: ModerateInput,
  report: Report = captureException,
): Promise<ModerateOutcome> {
  const target = await targetOf(db, input.subjectType, input.subjectId);
  if (target === undefined) {
    return (await wasModerated(db, input.subjectType, input.subjectId))
      ? "already_removed"
      : "not_found";
  }
  const { action } = input;
  // D-130: a copyright takedown hides for 30 days rather than deleting,
  // and one already hidden is answered as a repeat.
  const isHold = isCopyrightTakedown(action, input.reason);
  if (
    isHold &&
    (await isCopyrightHeld(db, input.subjectType, input.subjectId))
  ) {
    return "already_removed";
  }
  const actionId = newUlid();
  const kept =
    action === "quarantine"
      ? await preservation(db, target, input, actionId)
      : undefined;
  // A quarantine tells nobody: not its author, and not whoever reported
  // it (D-70). A Remove or takedown tells both (C8, D-132).
  const told =
    action === "quarantine"
      ? undefined
      : {
          ...(await authorNotice(db, input, action, target)),
          reporters: await reporterNotices(
            db,
            input.subjectType,
            input.subjectId,
            "removed",
          ),
        };
  const words = removalStatements[input.reason];
  const takenDown: Statements = isHold
    ? copyrightHoldWrites(db, {
        moderationActionId: actionId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        ownerId: target.ownerId,
        entryId: target.entryId,
      })
    : deletions(db, input, target);
  await commit(
    db,
    [
      moderationActionInsert(db, {
        id: actionId,
        actorId: input.actorId,
        action: input.action,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        subjectOwnerId: target.ownerId,
        reason:
          input.notice === undefined ? words : `${words} — ${input.notice}`,
        preservedKey: kept?.preservedKey,
        // Read before the delete, in `targetOf`: once the batch lands the
        // entry is gone, and this is how its author's run still finds it.
        runId: target.runId,
      }),
      // Before the delete in `takenDown`, which they read.
      ...fingerprintWrites(db, input, target, actionId),
      ...takenDown,
      ...(kept === undefined ? [] : [kept.record]),
      ...(told === undefined ? [] : [told.statement, ...told.reporters]),
    ],
    [
      // A hold keeps the bytes, and with them the photo's fingerprint
      // (C16), until its purge owes them.
      ...(isHold ? [] : mediaDebts(target.ownerId, [target.entryId])),
      ...(told === undefined ? [] : [told.debt]),
    ],
    report,
  );
  return "removed";
}

/**
Whether a queue subject is one `moderateContent` takes down.
*/
function isModerated(subject: {
  subjectType: string;
  subjectId: string;
}): subject is { subjectType: ModeratedSubjectType; subjectId: string } {
  return subject.subjectType === "entry" || subject.subjectType === "photo";
}

/**
 * A review queue decision. Approve is safety's; a Remove or quarantine of
 * an entry or a photo is `moderateContent`, which settles the queue row
 * with everything else. A product or a profile keeps safety's own path —
 * a product is hidden, and a person is banned from the Desk.
 */
export async function decideReview(
  db: Db,
  reviewerId: string,
  decision: ReviewActionValues,
): Promise<ResolveOutcome> {
  const { queueId } = decision;
  if (decision.action === "approve") {
    return resolveReview(queueId, reviewerId, "approve");
  }
  // Only a row still open is acted on; a settled or missing one is
  // answered by safety's own writer below, which says which it was.
  const subject = await openSubject(queueId);
  const isTakenDown =
    subject !== undefined &&
    isModerated(subject) &&
    (await moderateContent(db, {
      actorId: reviewerId,
      action: decision.action,
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      reason: decision.reason,
    })) === "removed";
  // Anything moderateContent did not take down — a product, a profile, or
  // an entry already gone — is settled by safety's own writer, so the row
  // never stays open on a subject nobody can act on.
  return isTakenDown
    ? "resolved"
    : resolveReview(queueId, reviewerId, decision.action);
}

/**
 * The copyright holds' daily sweep (D-130, design 149), handed to the
 * daily firing (`DailyUpkeep.sweepCopyrightHolds`) because `ops` cannot
 * import feed. Restores first — a hold due both ways is one a
 * counter-notice saved, and the purge's claim skips it — then deletes
 * each hold the purge claimed with the same statements a Remove uses,
 * marking it `purged` in the same batch. A purge whose batch fails stays
 * `purging`, and the next sweep takes it over.
 */
export async function sweepCopyrightHolds(
  db: Db = coreDb(),
  now = nowSeconds(),
  report: Report = captureException,
): Promise<void> {
  await restoreDueHolds(db, now);
  const claimed = await claimDuePurges(db, now);
  for (const hold of claimed) await purgeHeld(db, hold, now, report);
}

/**
 * A claimed hold deleted with the statements a Remove uses, the R2 debt
 * and `purged` in one batch — the bytes and the photo's fingerprint (C16)
 * go with it.
 */
async function purgeHeld(
  db: Db,
  hold: ClaimedPurge,
  now: number,
  report: Report,
): Promise<void> {
  await commit(
    db,
    [...deletions(db, hold, hold), purgedWrite(db, hold.id, now)],
    mediaDebts(hold.ownerId, [hold.entryId]),
    report,
  );
}

/**
 * The Desk's "Case over: delete" (D-146): a litigation hold ends with the
 * material deleted now, as its purge would have. The claim is
 * `safety`'s; a delete whose batch fails stays `purging` for the sweep
 * to take over, so a second click answers `gone` and never deletes
 * twice.
 */
export async function deleteAfterCase(
  db: Db,
  actorId: string,
  holdId: string,
  now = nowSeconds(),
  report: Report = captureException,
): Promise<CaseOverOutcome> {
  const claim = await claimPurgeAfterCase(db, actorId, holdId, now);
  if (claim.outcome !== "claimed") return claim;
  await purgeHeld(db, claim.hold, now, report);
  return { outcome: "recorded" };
}
