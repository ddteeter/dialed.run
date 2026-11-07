/**
 * An account flagged for an operator after an upheld intimate-image
 * removal (D-161 1; R-147). Nothing closes the account by itself: one
 * upheld report can be a mistake or a dispute, so a person decides, and
 * the terms' serious-breach clause stays the operator's call.
 *
 * **Derived, not stored.** The flag is what `moderation_actions` already
 * records: a Remove or takedown of the runner's kit, photo or garment
 * photo with the `intimate` statement, and no decision on their account
 * since. A decision is a Close account, a Reopen, or a Keep account
 * (`keep`, written here). A later intimate removal flags the account
 * again. A flag column would be a second copy of a fact the audit rows
 * already hold.
 *
 * The removal's `reason` holds the statement word for word, with the
 * Desk's notice after it when one was given (`feed/moderation.ts`), so
 * the read matches the statement as a prefix.
 */
import { and, inArray, sql } from "drizzle-orm";
import type { SQL, SQLWrapper } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { alias } from "drizzle-orm/sqlite-core";

import { moderationActions } from "../../db/schema-core";

import { removalStatements } from "./contracts";
import { moderationActionInsert } from "./moderation-actions";

type Db = ReturnType<typeof drizzle<Record<string, never>>>;

const INTIMATE = removalStatements.intimate;

/**
The actions that remove a thing, and the ones that decide an account.
*/
const removing = ["remove", "takedown"] as const;
const deciding = ["ban", "unban", "keep"] as const;

/**
The same table again, for the decision a removal is checked against.
*/
const DECISION = "account_decision";
const decision = alias(moderationActions, DECISION);

/**
 * The removals that flag their owner: intimate, and with no decision on
 * the owner's account at or after them. Over `moderationActions` as the
 * outer table.
 */
function unreviewedIntimateRemoval(): SQL {
  const removal = inArray(moderationActions.action, [...removing]);
  const intimate = sql`substr(${moderationActions.reason}, 1, ${INTIMATE.length}) = ${INTIMATE}`;
  const decided = sql`EXISTS (SELECT 1 FROM ${moderationActions} AS ${sql.identifier(DECISION)} WHERE ${decision.subjectType} = 'profile' AND ${decision.subjectId} = ${moderationActions.subjectOwnerId} AND ${inArray(decision.action, [...deciding])} AND ${decision.createdAt} >= ${moderationActions.createdAt})`;
  return sql`${removal} AND ${intimate} AND NOT ${decided}`;
}

/**
 * D8's Flagged filter as a condition on the account's id, for
 * `listAccounts`' `only` (`runners.ts`).
 */
export function flaggedWhere(userId: SQLWrapper): SQL {
  return sql`EXISTS (SELECT 1 FROM ${moderationActions} WHERE ${moderationActions.subjectOwnerId} = ${userId} AND ${unreviewedIntimateRemoval()})`;
}

/**
 * When each of these accounts was last flagged, by account; an account
 * not flagged has no entry. Reads `moderation_actions_owner`.
 */
export async function flaggedAtOf(
  db: Db,
  userIds: readonly string[],
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      userId: sql<string>`${moderationActions.subjectOwnerId}`,
      // Never null: a group exists only for a row that matched.
      at: sql<number>`max(${moderationActions.createdAt})`,
    })
    .from(moderationActions)
    .where(
      and(
        inArray(moderationActions.subjectOwnerId, [...userIds]),
        unreviewedIntimateRemoval(),
      ),
    )
    .groupBy(moderationActions.subjectOwnerId);
  return new Map(rows.map(({ userId, at }) => [userId, at]));
}

/**
 * How many accounts are flagged now, for Desk Today. A scan of
 * `moderation_actions`, read once a day by the digest and when an
 * operator opens the Desk.
 */
export function flaggedCountOf(db: Db) {
  return db
    .select({
      rows: sql<number>`count(DISTINCT ${moderationActions.subjectOwnerId})`,
    })
    .from(moderationActions)
    .where(unreviewedIntimateRemoval());
}

/**
 * Keep account (D-161 1): the operator looked and the account stays. Its
 * audit row is the decision that clears the flag.
 */
export async function keepAccount(
  db: Db,
  userId: string,
  actorId: string,
): Promise<void> {
  await moderationActionInsert(db, {
    actorId,
    action: "keep",
    subjectType: "profile",
    subjectId: userId,
    subjectOwnerId: userId,
    reason: "Kept after an intimate-image removal",
  });
}

export { eq as _unused } from "drizzle-orm";
