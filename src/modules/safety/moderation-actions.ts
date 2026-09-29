/**
 * The audit of what the Desk did to someone's content or account (task
 * 128 · SAF-5, SAF-6): `moderation_actions`, append-only.
 *
 * Every Desk action writes its row **in the same batch** as the change it
 * records — a removal with no record of who or why is exactly what a DMCA
 * takedown and the DSA's statement of reasons cannot have, and a record of
 * a removal that did not happen is worse.
 */
import { and, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { moderationActions } from "../../db/schema-core";
import { newUlid } from "../../lib/ids";
import { hasRowWhere } from "../../lib/keyed-read";
import { nowSeconds } from "../../lib/now";

type Db = ReturnType<typeof drizzle>;

export type ModerationAction =
  (typeof moderationActions.$inferInsert)["action"];

export interface ModerationRecord {
  /**
  Its id, when another row in the batch names it; minted otherwise.
  */
  id?: string | undefined;
  actorId: string;
  action: ModerationAction;
  subjectType: (typeof moderationActions.$inferInsert)["subjectType"];
  subjectId: string;
  subjectOwnerId: string;
  /**
  The operator's words, word for word.
  */
  reason: string;
  /**
  Where a quarantined object was moved to; absent for everything else.
  */
  preservedKey?: string | undefined;
}

/**
 * The row, as a statement for the caller's batch — never awaited here,
 * because on its own it would record an action nothing took.
 */
export function moderationActionInsert(db: Db, record: ModerationRecord) {
  return db.insert(moderationActions).values({
    ...record,
    id: record.id ?? newUlid(),
    createdAt: nowSeconds(),
  });
}

/**
 * Whether the Desk has already acted on this subject — so a second
 * takedown of something already gone answers "already removed" rather
 * than "not found" (`moderation_actions_subject`).
 */
export async function wasModerated(
  db: Db,
  subjectType: ModerationRecord["subjectType"],
  subjectId: string,
): Promise<boolean> {
  return hasRowWhere(
    db,
    moderationActions,
    moderationActions.id,
    and(
      eq(moderationActions.subjectType, subjectType),
      eq(moderationActions.subjectId, subjectId),
    ),
  );
}
