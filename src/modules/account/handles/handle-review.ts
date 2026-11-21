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
import type { BatchItem } from "drizzle-orm/batch";
import type { drizzle } from "drizzle-orm/d1";

import { reviewQueue, userProfiles } from "../../../db/schema-core";
import { coreDb } from "../../../env";
import { nowSeconds } from "../../../lib/now";
import {
  openReviewRow,
  placeholderHandle,
  renameRecord,
  reporterNotices,
  reviewResolution,
  settledHere,
  stillAsShown,
  type HandleReview,
  type HandleReviewValues,
  type ShownRow,
} from "../../safety";
import { forceRename } from "./username";

type Db = ReturnType<typeof drizzle>;

/**
 * The row a decision here is on: its id, the runner it is about, and the
 * row as the page showed it.
 */
type HandleRow = Readonly<{ queueId: string; userId: string; shown: ShownRow }>;

/**
 * Keep: the verdict becomes `clear`, over the flag it answers only — a
 * runner who renamed since holds a new verdict that is not this one's to
 * change — and the row is approved, in one batch, held to the row as
 * shown. Anyone who reported the runner is told it stayed up, as an
 * Approve tells them.
 */
async function keep(
  db: Db,
  row: HandleRow,
  reviewerId: string,
): Promise<HandleReview> {
  const { queueId, userId } = row;
  const settled = { reviewerId, status: "approved", at: nowSeconds() } as const;
  const here = settledHere(queueId, settled);
  // Safety's own handle: its notices are typed to it.
  const told: BatchItem<"sqlite">[] = await reporterNotices(
    coreDb(),
    "profile",
    userId,
    "kept",
    here,
  );
  // The settle first, and the verdict only if it landed (SA-L11): a Keep
  // racing another decision on the row clears nothing once it lost.
  const cleared = db
    .update(userProfiles)
    .set({ usernameScreen: "clear", usernameScreenedAt: settled.at })
    .where(
      and(
        eq(userProfiles.userId, userId),
        eq(userProfiles.usernameScreen, "flagged"),
        here,
      ),
    );
  const [settle] = await db.batch([
    reviewResolution(
      db,
      queueId,
      reviewerId,
      settled.status,
      stillAsShown(row.shown),
      settled.at,
    ).returning({ id: reviewQueue.id }),
    cleared,
    ...told,
  ]);
  return { outcome: settle.length === 0 ? "already_resolved" : "resolved" };
}

/**
 * Rename: the moderator's force-rename of the handle the row showed, its
 * audit row and the queue row settled as removed, held to the row as
 * shown, in `forceRename`'s one batch.
 */
async function rename(
  db: Db,
  row: HandleRow,
  input: Readonly<{
    reviewerId: string;
    decision: Extract<HandleReviewValues, { action: "rename" }>;
  }>,
): Promise<HandleReview> {
  const { nameReason } = input.decision;
  const renamed = await forceRename(db, {
    userId: row.userId,
    shown: input.decision.handle,
    typed: placeholderHandle(),
    reason: nameReason,
    recordedAs: renameRecord(db, {
      userId: row.userId,
      actorId: input.reviewerId,
      reason: nameReason,
    }),
    also: (onlyIf) => [
      reviewResolution(
        db,
        row.queueId,
        input.reviewerId,
        "removed",
        and(onlyIf, stillAsShown(row.shown)),
      ),
    ],
  });
  // A rename that lost the race names the handle it lost to (round 38 #60).
  return renamed.kind === "moved"
    ? { outcome: "moved", username: renamed.username }
    : { outcome: RENAMED[renamed.kind] };
}

const RENAMED = {
  renamed: "resolved",
  taken: "taken",
  not_found: "not_found",
} as const satisfies Record<string, HandleReview["outcome"]>;

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
): Promise<HandleReview> {
  const { queueId, shown } = decision;
  const subject = await openReviewRow(queueId, shown);
  if (typeof subject === "string") return { outcome: subject };
  if (subject.subjectType !== "profile") return { outcome: "not_found" };
  const row = { queueId, userId: subject.subjectId, shown };
  return decision.action === "keep"
    ? keep(db, row, reviewerId)
    : rename(db, row, { reviewerId, decision });
}
