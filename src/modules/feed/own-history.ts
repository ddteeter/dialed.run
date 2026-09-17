import { desc, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { outfitEntries } from "../../db/schema-core";

/**
 * A runner's own recent entries — the read behind every screen that
 * reasons over their history.
 *
 * Three call sites had written it out identically, down to the same
 * `HISTORY_LIMIT = 200` declared three times: the profile, the attach
 * prefill, and the Call tab's ladder. They differed only in which columns
 * they named, so this returns the superset — one extra column apiece, off
 * the same index, against three copies of a `LIMIT` that has to agree.
 *
 * **The `ORDER BY` is not decorative.** `LIMIT` without it makes "the 200
 * rows we looked at" depend on the query plan, so the same runner could
 * get a different 200 on two loads of the same screen.
 *
 * The cap exists because the band maths cannot move into SQL: conditions
 * live in `DIALED_WEATHER` and `DIALED_CORE` cannot join across databases
 * (CLAUDE.md §D1 query discipline), so the walk happens in code and its
 * cost is the row count.
 */
export const HISTORY_LIMIT = 200;

export interface OwnEntryRow {
  id: string;
  runId: string;
  verdict: number | null;
  createdAt: number;
}

export function recentOwnEntries(
  database: DrizzleD1Database,
  userId: string,
): Promise<OwnEntryRow[]> {
  return database
    .select({
      id: outfitEntries.id,
      runId: outfitEntries.runId,
      verdict: outfitEntries.verdict,
      createdAt: outfitEntries.createdAt,
    })
    .from(outfitEntries)
    .where(eq(outfitEntries.userId, userId))
    .orderBy(desc(outfitEntries.createdAt))
    .limit(HISTORY_LIMIT);
}
