import type { SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

/**
 * The two reads a join table gets: "are these two rows related" and "which
 * rows relate to this one".
 *
 * `follows` and `reactions` had written both of them out twice each —
 * `isFollowing`/`hasReacted` and `followeeIdsOf`/`followerCount`/
 * `usefulCount` — differing only in the table and the column. That is the
 * copy-then-rename a clone detector in `semantic` mode sees and `mild`
 * does not.
 *
 * **The column stays an argument, and that is the whole design.** Every one
 * of these reads selects exactly one column on purpose: the one the
 * covering index carries, so SQLite answers from the index without
 * touching the row. D1 bills rows *scanned*, so a helper that picked the
 * column itself — `select 1`, or `select *` — would quietly turn five
 * index-only seeks into five table scans, and nothing in a test would say
 * so. Passing it makes the choice louder here than it was inline.
 */
export async function columnWhere<TColumn extends SQLiteColumn>(
  database: DrizzleD1Database,
  table: SQLiteTable,
  column: TColumn,
  where: SQL | undefined,
): Promise<TColumn["_"]["data"][]> {
  const rows = await database.select({ value: column }).from(table).where(where);
  return rows.map((row) => row.value);
}

/**
 * Whether any row matches — `LIMIT 1`, so it stops at the first.
 *
 * Separate from `columnWhere` rather than `(await columnWhere(…)).length >
 * 0`: without the limit this reads every matching row to answer a yes/no,
 * which on a popular entry is the difference between one row and all of
 * them.
 */
export async function hasRowWhere(
  database: DrizzleD1Database,
  table: SQLiteTable,
  column: SQLiteColumn,
  where: SQL | undefined,
): Promise<boolean> {
  const rows = await database
    .select({ value: column })
    .from(table)
    .where(where)
    .limit(1);
  return rows.length > 0;
}
