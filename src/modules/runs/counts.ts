import { count, inArray } from "drizzle-orm";

import { runs } from "../../db/schema-core";
import type { CoreDb } from "./core-db";

/**
 * How many runs each of these runners has logged (task 128 · D8, round 27
 * #22) — for the Desk, which lists at most a page of accounts and counts
 * through this rather than reading `runs` itself. A runner with none has
 * no row. `runs_user_started` serves it: the `IN` is a seek per runner.
 *
 * A builder, not a result, so the Desk can put it in one `db.batch()` with
 * its own reads.
 */
export function runCountsOf(db: CoreDb, userIds: readonly string[]) {
  return db
    .select({ userId: runs.userId, runs: count() })
    .from(runs)
    .where(inArray(runs.userId, [...userIds]))
    .groupBy(runs.userId);
}
