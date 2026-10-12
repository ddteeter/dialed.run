/**
 * What the Desk took off a runner's run, for the band where it was (round
 * 27 #20, R-140): a Remove or a takedown of the run's entry or of one of
 * its photos.
 *
 * **Read from the audit row, because the thing itself is gone.** A Remove
 * deletes (`feed/moderation.ts`), so only `moderation_actions` still knows
 * it happened; its `run_id`, read before the delete, says which run. Rows
 * written before that column have none and match no run: they are not
 * shown, and nothing else changes for them.
 *
 * Keyed by `moderation_actions_run`, and scoped in SQL to the run's
 * author, so a runner never reads someone else's removals. A quarantine
 * is silent (D-70) and a profile action is no thing on a run, so neither
 * is read.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { moderationActions } from "../../db/schema-core";
import {
  removalReasons,
  removalStatements,
  type RemovalReason,
} from "./contracts";

type Db = ReturnType<typeof drizzle>;

export interface RunRemoval {
  readonly id: string;
  readonly subjectType: "entry" | "photo";
  readonly action: "remove" | "takedown";
  readonly reason: RemovalReason;
}

/**
 * The read, un-awaited — exported so its plan can be asked of SQLite.
 *
 * The two narrowed columns are typed by the WHERE below them: the rows it
 * lets through are only those values, so the select says so rather than
 * re-checking in memory what SQL already decided.
 */
export function runRemovalsQuery(db: Db, ownerId: string, runId: string) {
  return db
    .select({
      id: moderationActions.id,
      subjectType: sql<
        RunRemoval["subjectType"]
      >`${moderationActions.subjectType}`,
      action: sql<RunRemoval["action"]>`${moderationActions.action}`,
      reason: moderationActions.reason,
    })
    .from(moderationActions)
    .where(
      and(
        eq(moderationActions.runId, runId),
        // Unary `+` keeps SQLite off `moderation_actions_owner` for this
        // term (its documented way to disqualify an index): without it the
        // planner picks the owner index, since it also serves the ORDER
        // BY, and reads every removal the runner ever had to find one
        // run's. Keyed by run, it reads that run's few rows and sorts them.
        sql`+${moderationActions.subjectOwnerId} = ${ownerId}`,
        inArray(moderationActions.action, ["remove", "takedown"]),
        inArray(moderationActions.subjectType, ["entry", "photo"]),
      ),
    )
    .orderBy(desc(moderationActions.createdAt));
}

/**
 * The stored words back to the reason they are the statement of. The
 * audit row keeps the statement, word for word, and a takedown appends
 * its notice after " — " (`moderateContent`); anything else is no reason
 * this build knows, and its row is not shown.
 */
function reasonOf(stored: string): RemovalReason | undefined {
  return removalReasons.find(
    (reason) =>
      stored === removalStatements[reason] ||
      stored.startsWith(`${removalStatements[reason]} — `),
  );
}

/**
The run's removals, newest first, each with the reason its band states.
*/
export async function removalsOnRun(
  db: Db,
  ownerId: string,
  runId: string,
): Promise<RunRemoval[]> {
  const rows = await runRemovalsQuery(db, ownerId, runId);
  return rows.flatMap((row) => {
    const reason = reasonOf(row.reason);
    return reason === undefined ? [] : [{ ...row, reason }];
  });
}
