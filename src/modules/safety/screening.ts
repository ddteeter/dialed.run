/**
 * Photo screening (packet §1): classify a photo before strangers see it.
 *
 * **Fail open for the owner, closed for the public**, and that is a column
 * rather than a branch. `screen_status` starts at `pending`; the owner's
 * own reads ignore it, every public read requires `pass`. So a classifier
 * outage degrades to "nobody else sees it yet" and never to a wrong answer
 * and never to a failed save (law 5). Lane 107 retired a whole
 * deterministic path over exactly this: degradation that produces a WRONG
 * answer is worse than degradation that produces none.
 *
 * **The retry is reconciliation, not a queue** (law 8c). `pending` is
 * already the durable "not finished" marker, and the `screening-retry`
 * cron re-drives anything still wearing it — so a half-completed screening
 * heals itself, exactly as the weather path does. An outbox here would be
 * the over-engineered version.
 *
 * The classifier is injected rather than imported. Not for testability as
 * such — for the fact that the eval and production must run the same
 * decision, and that a test must be able to make the upstream fail on
 * demand, which is the path least likely to be exercised in real life and
 * most important to get right.
 */
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import {
  entryPhotos,
  photoScreenings,
  wardrobeItems,
} from "../../db/schema-core";
import { coreDb } from "../../env";
import {
  garmentOriginalKey,
  garmentVersionId,
} from "../../lib/garment-photo-key";
import { newUlid, ulidSeconds } from "../../lib/ids";
import { nowSeconds } from "../../lib/now";

import {
  decide,
  MODERATION_MODEL,
  type CategoryScores,
  type ScreenDecision,
} from "./classifier/moderation";
import {
  enqueueForReview,
  settleOpenReviews,
  type ReviewSource,
} from "./review";

function db() {
  return coreDb();
}

/** Which table the photo hangs off. Entry photos and garment photos are
 * screened by the same path but live in different rows. */
export type PhotoScope = "entry" | "garment";

export interface PhotoToScreen {
  scope: PhotoScope;
  /**
  `entry_photos.id`, or `wardrobe_items.id` for a garment photo.
  */
  photoId: string;
  bytes: Uint8Array;
  contentType: string;
}

/**
 * What a classifier must provide. Narrower than the OpenAI client on
 * purpose: this is the whole contract, so a fake in a test is a function
 * and not a mock framework.
 */
export type Classify = (params: {
  bytes: Uint8Array;
  contentType: string;
}) => Promise<{ flagged: boolean; scores: CategoryScores }>;

export type ScreenOutcome = "pass" | "review" | "flagged" | "deferred";

/**
 * Screens one photo and records the verdict.
 *
 * Returns `deferred` when there is no classifier, or when it could not
 * answer — the row stays
 * `pending`, the owner keeps seeing their photo, and the cron will try
 * again. **This never throws for a classifier failure**, because the
 * caller is a photo upload and the runner's save must not fail for a
 * reason that has nothing to do with them (law 5).
 */
export async function screenPhoto(
  photo: PhotoToScreen,
  classify: Classify | undefined,
): Promise<ScreenOutcome> {
  // **No classifier is a state, not a stand-in.** Both upload paths used
  // to pass a fake that rejected with a message nothing read — two copies
  // of one idea, and a mutant could empty the message without any test
  // noticing. An absent classifier answers the same way a broken one
  // does, and says so here once.
  if (!classify) return "deferred";

  // The call is made OUTSIDE the try and only the await is inside, and the
  // narrowness is the point: a try around the call would also swallow the
  // guard above going wrong, which made that guard a branch no test could
  // distinguish — skipping it called `undefined(…)` in the same try and
  // produced the same `deferred`. A classifier that throws synchronously
  // rather than rejecting is a bug in this repo, not an upstream outage,
  // and now surfaces as one.
  const answer = classify({
    bytes: photo.bytes,
    contentType: photo.contentType,
  });
  let result: { flagged: boolean; scores: CategoryScores };
  try {
    result = await answer;
  } catch {
    // Deliberately swallowed. The photo stays `pending`, which is both the
    // safe visibility and the marker the retry sweep reads — so there is
    // nothing to record here that the row does not already say.
    return "deferred";
  }

  const decision = decide(result.scores);
  const now = nowSeconds();

  // One batch: the verdict, the visibility it implies, and the row that
  // puts it in front of a person are one fact. A gap between them leaves a
  // photo screened-but-still-pending (harmless, the sweep redoes it),
  // visible-but-unrecorded (not harmless, because nothing would remember
  // why), or — the one this lane shipped and had to come back for —
  // hidden with nobody told.
  await db().batch([
    screeningInsert(photo, result.scores, decision, now),
    visibilityWrite(photo.scope, photo.photoId, decision),
    ...queueWritesFor(photo, decision),
  ]);

  return outcomeOf[decision];
}

/**
 * The verdict's row, written only while the photo it describes still
 * exists (design 157): an `INSERT … SELECT` from the photo's own row, so a
 * classifier answer that lands after its runner deleted the photo writes
 * nothing, and no screening outlives its photo. Every delete of a photo
 * takes its screenings in the same batch (`screeningDeletes`); in D1's
 * serialised batches the two cannot interleave.
 *
 * `scores` are the raw ones, kept so a threshold can be re-tuned against
 * real numbers after launch without re-classifying anything.
 */
function screeningInsert(
  photo: PhotoToScreen,
  scores: CategoryScores,
  decision: ScreenDecision,
  now: number,
) {
  // Each field is named for the column it fills, read from the table.
  const into = photoScreenings;
  const row = {
    id: sql<string>`${newUlid()}`.as(into.id.name),
    photoScope: sql<PhotoScope>`${photo.scope}`.as(into.photoScope.name),
    photoId: sql<string>`${photo.photoId}`.as(into.photoId.name),
    model: sql<string>`${MODERATION_MODEL}`.as(into.model.name),
    scores: sql<string>`${JSON.stringify(scores)}`.as(into.scores.name),
    decision: sql<ScreenDecision>`${decision}`.as(into.decision.name),
    createdAt: sql<number>`${now}`.as(into.createdAt.name),
  };
  const stillThere =
    photo.scope === "entry"
      ? db()
          .select(row)
          .from(entryPhotos)
          .where(eq(entryPhotos.id, photo.photoId))
      : db()
          .select(row)
          .from(wardrobeItems)
          .where(
            and(
              eq(wardrobeItems.id, photo.photoId),
              isNotNull(wardrobeItems.photoKey),
            ),
          );
  return db().insert(photoScreenings).select(stillThere);
}

/**
 * What goes when a garment's photo does — replaced, removed by its owner,
 * or the garment deleted (design 157): what the screener said of it, and
 * any review still open on it, settled as removed by its owner, as a kit
 * photo's is when its runner deletes it. Statements for the caller's
 * batch, ahead of the write that takes the photo.
 */
export function garmentPhotoForgotten(
  database: ReturnType<typeof drizzle>,
  ownerId: string,
  itemId: string,
) {
  return [
    screeningDeletes(database, "garment", [itemId]),
    settleOpenReviews(database, "garment", [itemId], ownerId),
  ] as const;
}

/**
 * What the screener said about these photos, deleted — a statement for
 * the batch that deletes the photos themselves (design 157), placed before
 * that delete when `photoIds` is a subquery over the photos. `photoIds` are
 * `entry_photos` ids, or garment ids for a garment's photo.
 */
export function screeningDeletes(
  database: ReturnType<typeof drizzle>,
  scope: PhotoScope,
  photoIds: SQLWrapper | readonly string[],
) {
  return database
    .delete(photoScreenings)
    .where(
      and(
        eq(photoScreenings.photoScope, scope),
        inArray(photoScreenings.photoId, photoIds),
      ),
    );
}

/**
 * What the reviewer is asked to look at, which is not the same set as what
 * gets hidden.
 *
 * **`flag` and `review` both queue; only `flag` hides.** That was R-65:
 * `review_queue.source` has carried a `"classifier"` variant since this
 * table existed and nothing ever wrote one, so a photo the model hid was
 * hidden with no one told — the same write-only shape as the `screen_status`
 * bug this lane already fixed, one table over. Queueing both bands is what
 * makes the middle band worth having: a reviewer disagreeing with a
 * borderline score is the only calibration signal that comes from real
 * photos rather than from ones we picked for the eval.
 *
 * **Garment photos too** (design 157, reversing R-69's first shape). A
 * garment photo nobody but its owner sees still has to reach a person: a
 * flagged one otherwise stayed hidden for good with nobody deciding, and
 * suspected CSAM in a closet must be quarantinable like any other. It
 * queues by the garment's id, as a `garment` subject.
 */
function queueWritesFor(photo: PhotoToScreen, decision: ScreenDecision) {
  // A pass that lands after the photo went to the Desk as stuck (D-157)
  // settles that row: the reason it was opened has gone. Only that row —
  // one reports opened is a person's question, not the screener's. A
  // `review` or `flag` re-points it to `classifier` below instead.
  if (decision === "pass") {
    return [
      settleOpenReviews(
        db(),
        queueSubjectOf[photo.scope],
        [photo.photoId],
        "screening",
        { as: "approved", onlyFrom: stuckSources },
      ),
    ];
  }
  return [
    enqueueForReview(db(), {
      subjectType: queueSubjectOf[photo.scope],
      subjectId: photo.photoId,
      source: "classifier",
    }),
  ];
}

/**
Which queue subject a photo of each scope is.
*/
export const queueSubjectOf = {
  entry: "photo",
  garment: "garment",
} as const satisfies Record<PhotoScope, string>;

/**
 * Why a photo still pending a day after upload is in the queue (D-157,
 * design 167): storage had nothing to screen, or the classifier has not
 * answered. Here rather than with the escalation, because a verdict that
 * finally lands settles exactly these.
 */
export const stuckSources = [
  "missing_file",
  "unscreened",
] as const satisfies readonly ReviewSource[];

/**
Which outcome each decision reports to the caller.
*/
const outcomeOf: Record<ScreenDecision, ScreenOutcome> = {
  pass: "pass",
  review: "review",
  flag: "flagged",
};

/**
 * The visibility half of the verdict, for whichever table owns the photo.
 *
 * A flagged photo becomes `hidden_pending_review` rather than `flagged`:
 * the state that matters to every reader is "not public, a person will
 * look", and a separate `flagged` value would be a second name for it that
 * some query would eventually forget to check.
 */
function visibilityWrite(
  scope: PhotoScope,
  photoId: string,
  decision: ScreenDecision,
) {
  // `review` publishes. That is the band's whole point: the runner is not
  // charged for our uncertainty, and the reviewer looks at a photo that is
  // already live rather than at one being held for them.
  const status = decision === "flag" ? "hidden_pending_review" : "pass";
  if (scope === "entry") {
    // Only over `pending`, the state a verdict is owed for. A report or a
    // removal request can hide a photo while the classifier is still
    // answering, and a `pass` landing after it would put the photo back
    // with nobody having decided (C6: a removal is never undone by
    // itself). Hidden already, a `flag` has nothing left to hide.
    return db()
      .update(entryPhotos)
      .set({ screenStatus: status })
      .where(
        and(
          eq(entryPhotos.id, photoId),
          eq(entryPhotos.screenStatus, "pending"),
        ),
      );
  }
  // Over `pending` only, as above (design 157): a garment photo held as a
  // copy of a removed image (D-147) waits for a person, and a verdict
  // landing late must not clear it.
  return db()
    .update(wardrobeItems)
    .set({ visibility: status })
    .where(
      and(
        eq(wardrobeItems.id, photoId),
        eq(wardrobeItems.visibility, "pending"),
      ),
    );
}

export interface PendingPhoto {
  scope: PhotoScope;
  photoId: string;
  /**
   * The R2 object holding the bytes to screen. Not always the row's
   * `photo_key`: an entry photo's key is its object, but a garment's is
   * the prefix of a version (`garmentOriginalKey`).
   */
  objectKey: string;
  /**
   * When it was uploaded, in unix seconds, read from the ULID the upload
   * minted (D-157): an entry photo's id, a garment photo's version. No
   * column records it; the id already does.
   */
  uploadedAt: number | undefined;
}

/**
 * Entry photos still waiting on a verdict, oldest first — what the
 * `screening-retry` sweep works through.
 *
 * Bounded, because a cron firing should do a bounded amount of work and
 * the next one is fifteen minutes away. A backlog drains over several
 * firings rather than one firing timing out and achieving nothing, which
 * is the failure mode an unbounded sweep has.
 */
export async function pendingEntryPhotos(limit = 50): Promise<PendingPhoto[]> {
  const rows = await db()
    .select({ id: entryPhotos.id, photoKey: entryPhotos.photoKey })
    .from(entryPhotos)
    .where(eq(entryPhotos.screenStatus, "pending"))
    .orderBy(entryPhotos.id)
    .limit(limit);
  return rows.map((row) => ({
    scope: "entry" as const,
    photoId: row.id,
    objectKey: row.photoKey,
    uploadedAt: ulidSeconds(row.id),
  }));
}

/**
 * Garment photos still waiting. Separate from the entry read rather than
 * unioned: they are different tables, and `wardrobe_items` rows without a
 * photo at all must not be swept.
 */
export async function pendingGarmentPhotos(
  limit = 50,
): Promise<PendingPhoto[]> {
  const rows = await db()
    .select({ id: wardrobeItems.id, photoKey: wardrobeItems.photoKey })
    .from(wardrobeItems)
    .where(
      and(
        eq(wardrobeItems.visibility, "pending"),
        // A garment with no photo has nothing to screen. In SQL rather
        // than filtered afterwards: a closet is mostly garments without
        // photos, so this is the difference between scanning the marked
        // ones and scanning all of them.
        isNotNull(wardrobeItems.photoKey),
      ),
    )
    .orderBy(wardrobeItems.id)
    .limit(limit);
  // The WHERE already excludes a null photo_key; the mapping below
  // narrows the type rather than re-deciding it.
  return rows.flatMap((row) => pendingGarmentFrom(row));
}

/**
 * One garment row as the sweep's reading list sees it, or nothing.
 *
 * Exported and returning a list rather than written inline as a ternary,
 * because the empty half is unreachable through the query that calls it —
 * `isNotNull` lives in the WHERE, since a closet is mostly garments
 * without photos and scanning the marked ones instead of all of them is
 * the difference D1 bills for. A named function can be asked the question
 * directly; an unreachable branch inside a `.map` cannot be asked
 * anything.
 */
export function pendingGarmentFrom(row: {
  id: string;
  photoKey: string | null;
}): PendingPhoto[] {
  return row.photoKey === null
    ? []
    : [
        {
          scope: "garment",
          photoId: row.id,
          // The original the runner sent, as the upload screens it: the
          // row names a version, and a version is a prefix, not an object.
          objectKey: garmentOriginalKey(row.photoKey),
          // A replaced photo is a new version, so its day starts again.
          uploadedAt: ulidSeconds(garmentVersionId(row.photoKey)),
        },
      ];
}
