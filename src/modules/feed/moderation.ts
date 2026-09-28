/**
 * A moderator's Remove, a suspected-CSAM quarantine and a copyright
 * takedown (task 128 · SAF-5, SAF-6), and the notice each owes its author
 * (SAF-8).
 *
 * **Removal deletes.** It used to set `moderation_status = 'removed'` and
 * leave the bytes where they were (audit 0.9). It now goes through the
 * same statements and the same outbox path a runner's own delete does
 * (`retract.ts`): every row in one `db.batch()` with the audit row, the
 * notice and an outbox debt owing R2 a reconcile, then the fast path.
 *
 * **Quarantine keeps one copy, where no route looks.** Before the batch,
 * each photo is copied to `quarantine/…` (`quarantineKeyFor`), outside the
 * `entries/` prefix every photo route insists on; then the delete runs as
 * for a Remove, and the reconcile clears the original. The copy is named
 * on the audit row, which is the only thing that names it, and is kept for
 * the preservation period the owner's NCMEC procedure sets (deployment
 * plan §8). The copy goes first because a failed copy must stop the delete
 * — losing the evidence is the one outcome worse than a retry.
 *
 * **It lives in feed, not safety**, because the arrow runs feed → safety
 * (`docs/architecture.md`): the deletion statements are feed's, and safety
 * imports nothing from feed.
 */
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { entryPhotos, outfitEntries } from "../../db/schema-core";
import { env } from "../../env";
import { entryPhotoPrefix, quarantineKeyFor } from "../../lib/entry-photo-key";
import { notificationInsert } from "../notifications";
import { captureException } from "../ops";
import {
  moderationActionInsert,
  openRow,
  removalSentence,
  removalStatements,
  resolveReview,
  settleOpenReviews,
  type RemovalReason,
  type ResolveOutcome,
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

export type ModerateOutcome = "removed" | "not_found";

/**
What is being taken down: whose it is, which entry, and which objects.
*/
interface Target {
  ownerId: string;
  entryId: string;
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
    photoKeys: rows.flatMap((row) => row.photoKey ?? []),
  };
}

/**
What `targetOf` reads for each row.
*/
const targetColumns = {
  ownerId: outfitEntries.userId,
  entryId: outfitEntries.id,
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
 * Copies each object under the quarantine prefix, and says where. A photo
 * whose object is already gone has nothing to preserve and is skipped.
 */
async function quarantine(
  target: Target,
  subjectType: ModeratedSubjectType,
): Promise<string> {
  for (const key of target.photoKeys) {
    const object = await env.MEDIA.get(key);
    if (object === null) continue;
    await env.MEDIA.put(quarantineKeyFor(key), object.body, {
      httpMetadata: object.httpMetadata ?? {},
    });
  }
  return quarantineKeyFor(
    subjectType === "photo"
      ? (target.photoKeys[0] ?? "")
      : entryPhotoPrefix(target.ownerId, target.entryId),
  );
}

/**
 * The row statements for the subject: the photo and its open review, or
 * the entry and everything hung on it — settled by the moderator.
 */
function deletions(db: Db, input: ModerateInput, target: Target): Statements {
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
 * Takes the subject down, records it and tells its author — one batch,
 * then the bytes.
 */
export async function moderateContent(
  db: Db,
  input: ModerateInput,
  report: Report = captureException,
): Promise<ModerateOutcome> {
  const target = await targetOf(db, input.subjectType, input.subjectId);
  if (target === undefined) return "not_found";
  const preservedKey =
    input.action === "quarantine"
      ? await quarantine(target, input.subjectType)
      : undefined;
  const words = removalStatements[input.reason];
  await commit(
    db,
    [
      ...deletions(db, input, target),
      moderationActionInsert(db, {
        actorId: input.actorId,
        action: input.action,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        subjectOwnerId: target.ownerId,
        reason:
          input.notice === undefined ? words : `${words} — ${input.notice}`,
        preservedKey,
      }),
      notificationInsert(db, {
        userId: target.ownerId,
        kind: "content_removed",
        subjectId: input.subjectId,
        body: removalSentence(input.subjectType, input.reason),
      }),
      // NEED(#119, 126 · ACC-2): the content-removed email (round 27 #20)
      // joins this batch as an `emailDebt` row once `modules/email` is on
      // main — the same sentence, and the community rules link.
    ],
    mediaDebts(target.ownerId, [target.entryId]),
    report,
  );
  return "removed";
}

export type ReviewAction = "approve" | "remove" | "quarantine";

/**
 * A review queue decision. Approve is safety's; a Remove or quarantine of
 * an entry or a photo is `moderateContent`, which settles the queue row
 * with everything else. A product or a profile keeps safety's own path —
 * a product is hidden, and a person is banned from the Desk.
 */
export async function decideReview(
  db: Db,
  queueId: string,
  reviewerId: string,
  action: ReviewAction,
  reason: RemovalReason,
): Promise<ResolveOutcome> {
  if (action === "approve") {
    return resolveReview(queueId, reviewerId, "approve");
  }
  const row = await openRow(queueId);
  if (typeof row === "string") return row;
  const { subjectType, subjectId } = row;
  const outcome =
    subjectType === "entry" || subjectType === "photo"
      ? await moderateContent(db, {
          actorId: reviewerId,
          action,
          subjectType,
          subjectId,
          reason,
        })
      : "not_found";
  // Anything moderateContent did not take down — a product, a profile, or
  // an entry already gone — is settled by safety's own writer, so the row
  // never stays open on a subject nobody can act on.
  return outcome === "removed"
    ? "resolved"
    : resolveReview(queueId, reviewerId, "remove");
}
