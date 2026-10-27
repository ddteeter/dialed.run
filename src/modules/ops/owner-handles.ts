import { eq, inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { AnySQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

import { userProfiles } from "../../db/schema-core";

/**
 * The handle of whoever owns each listed row, keyed by the row's id: the
 * lookup a Gave up sentence about an import or a Strava connection needs,
 * one batchable query per table. LEFT, so a row whose owner has no profile
 * still comes back, with a null handle.
 */
export function ownerHandles(
  db: DrizzleD1Database,
  table: SQLiteTable,
  id: AnySQLiteColumn<{ data: string; notNull: true }>,
  userId: AnySQLiteColumn<{ data: string }>,
  ids: readonly string[],
) {
  return db
    .select({ id, handle: userProfiles.username })
    .from(table)
    .leftJoin(userProfiles, eq(userProfiles.userId, userId))
    .where(inArray(id, ids));
}
