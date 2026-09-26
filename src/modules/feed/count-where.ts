import { count } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

/**
 * How many rows match — `COUNT(*)`, one row back.
 *
 * The profile's run count and the follow and Useful counts used to read
 * every matching id and take `.length` (PR #102 review): the same index
 * seek, but every id shipped over the wire to be thrown away, and a
 * runner with a few thousand runs paid for all of them on each view of G.
 * The `where` is the caller's, over an index that leads with its column,
 * so SQLite counts from the index without touching a row.
 */
export async function countWhere(
  database: DrizzleD1Database<Record<string, unknown>>,
  table: SQLiteTable,
  where: SQL | undefined,
): Promise<number> {
  return countOf(
    await database.select({ n: count() }).from(table).where(where),
  );
}

/**
 * What a `count()` answered. It always answers with one row; summing them
 * says so without a fallback for a row that cannot be missing.
 */
export function countOf(rows: readonly { n: number }[]): number {
  return rows.reduce((total, row) => total + row.n, 0);
}
