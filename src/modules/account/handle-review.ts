/**
 * The Desk's answer to a handle the re-ask flagged (owner, D-97): the
 * review row offers **Rename** — the moderator's force-rename, with its
 * reasons list and the runner's O0 "USERNAME CHANGED BY A MODERATOR" — or
 * **Keep**, which says the handle is fine and clears the flag. A flagged
 * handle is never offered Remove: removing a person is a ban, and a name
 * is not a reason to close an account.
 *
 * Here, in `account`, because both halves are account's writes (the
 * handle and its verdict) settled beside safety's queue row: account may
 * import safety's barrel, and safety may not import account's.
 */
import { and, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { userProfiles } from "../../db/schema-core";
import { nowSeconds } from "../../lib/now";
import {
  openReviewRow,
  placeholderHandle,
  renameRecord,
  reviewResolution,
  type HandleReviewOutcome,
  type HandleReviewValues,
} from "../safety";
import { forceRename } from "./username";

type Db = ReturnType<typeof drizzle>;

/**
 * Keep: the verdict becomes `clear`, over the flag it answers only — a
 * runner who renamed since holds a new verdict that is not this one's to
 * change — and the row is approved, in one batch.
 */
async function keep(
  db: Db,
  queueId: string,
  userId: string,
  reviewerId: string,
): Promise<HandleReviewOutcome> {
  const cleared = db
    .update(userProfiles)
    .set({ usernameScreen: "clear", usernameScreenedAt: nowSeconds() })
    .where(
      and(
        eq(userProfiles.userId, userId),
        eq(userProfiles.usernameScreen, "flagged"),
      ),
    );
  await db.batch([
    cleared,
    reviewResolution(db, queueId, reviewerId, "approve"),
  ]);
  return "resolved";
}

/**
 * Rename: the moderator's force-rename, its audit row and the queue row
 * settled as removed, in `forceRename`'s one batch.
 */
async function rename(
  db: Db,
  input: Readonly<{
    queueId: string;
    userId: string;
    reviewerId: string;
    nameReason: Extract<HandleReviewValues, { action: "rename" }>["nameReason"];
  }>,
): Promise<HandleReviewOutcome> {
  const renamed = await forceRename(db, {
    userId: input.userId,
    typed: placeholderHandle(),
    reason: input.nameReason,
    recordedAs: renameRecord(db, {
      userId: input.userId,
      actorId: input.reviewerId,
      reason: input.nameReason,
    }),
    also: [reviewResolution(db, input.queueId, input.reviewerId, "remove")],
  });
  return RENAMED[renamed.kind];
}

const RENAMED = {
  renamed: "resolved",
  taken: "taken",
  not_found: "not_found",
} as const satisfies Record<string, HandleReviewOutcome>;

/**
 * Keep or Rename on a review row. Only a row still open, about a runner,
 * is acted on. A row already settled, or gone, is answered as the queue
 * answers it (`already_resolved`, `not_found`), writing nothing; a row
 * about anything but a runner has no handle to keep or rename.
 */
export async function reviewFlaggedHandle(
  db: Db,
  reviewerId: string,
  decision: HandleReviewValues,
): Promise<HandleReviewOutcome> {
  const { queueId } = decision;
  const subject = await openReviewRow(queueId);
  if (typeof subject === "string") return subject;
  if (subject.subjectType !== "profile") return "not_found";
  const userId = subject.subjectId;
  return decision.action === "keep"
    ? keep(db, queueId, userId, reviewerId)
    : rename(db, {
        queueId,
        userId,
        reviewerId,
        nameReason: decision.nameReason,
      });
}
