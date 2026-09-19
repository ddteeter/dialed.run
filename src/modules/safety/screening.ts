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
import { and, eq, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  entryPhotos,
  photoScreenings,
  wardrobeItems,
} from "../../db/schema-core";
import { env } from "../../env";
import { newUlid } from "../../lib/ids";
import { nowSeconds } from "../../lib/now";

import {
  decide,
  MODERATION_MODEL,
  type CategoryScores,
  type ScreenDecision,
} from "./classifier/moderation";
import { enqueueForReview } from "./review";

function db() {
  return drizzle(env.DIALED_CORE);
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
    db()
      .insert(photoScreenings)
      .values({
        id: newUlid(),
        photoScope: photo.scope,
        photoId: photo.photoId,
        model: MODERATION_MODEL,
        // The raw scores, kept so a threshold can be re-tuned against real
        // numbers after launch without re-classifying anything.
        scores: JSON.stringify(result.scores),
        decision,
        createdAt: now,
      }),
    visibilityWrite(photo.scope, photo.photoId, decision),
    ...queueWritesFor(photo, decision),
  ]);

  return outcomeOf[decision];
}

/**
 * What the reviewer is asked to look at, which is not the same set as what
 * gets hidden.
 *
 * **`flag` and `review` both queue; only `flag` hides.** That was D-65:
 * `review_queue.source` has carried a `"classifier"` variant since this
 * table existed and nothing ever wrote one, so a photo the model hid was
 * hidden with no one told — the same write-only shape as the `screen_status`
 * bug this lane already fixed, one table over. Queueing both bands is what
 * makes the middle band worth having: a reviewer disagreeing with a
 * borderline score is the only calibration signal that comes from real
 * photos rather than from ones we picked for the eval.
 *
 * **Entry photos only.** A garment photo lives in a closet, which nobody
 * but its owner can see, so queueing one would put a private photo in front
 * of an operator to settle a question nobody asked. It still hides on
 * `flag`, and stays hidden until the owner replaces it — see D-69.
 */
function queueWritesFor(photo: PhotoToScreen, decision: ScreenDecision) {
  if (decision === "pass") return [];
  if (photo.scope !== "entry") return [];
  return [
    enqueueForReview(db(), {
      subjectType: "photo",
      subjectId: photo.photoId,
      source: "classifier",
    }),
  ];
}

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
    return db()
      .update(entryPhotos)
      .set({ screenStatus: status })
      .where(eq(entryPhotos.id, photoId));
  }
  return db()
    .update(wardrobeItems)
    .set({ visibility: status })
    .where(eq(wardrobeItems.id, photoId));
}

export interface PendingPhoto {
  scope: PhotoScope;
  photoId: string;
  photoKey: string;
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
    photoKey: row.photoKey,
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
    : [{ scope: "garment", photoId: row.id, photoKey: row.photoKey }];
}
