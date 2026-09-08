import { and, eq } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

/**
 * "This row, and it belongs to this user" — the predicate behind every
 * owner-scoped read and write.
 *
 * It was written out inline in three modules over three tables
 * (`wardrobe_items`, `imports`, `runs`), and the closet had already
 * extracted a table-specific version of it locally for the same reason.
 * Dropping the second clause is a cross-account read or write that
 * typechecks, passes tests that only ever use one account, and looks
 * correct in review — so it is worth having exactly one of.
 *
 * Takes the table rather than two loose columns, and an object rather than
 * two positional strings: `id` and `userId` are both `string`, so a
 * four-argument version can be called with them swapped and still compile.
 */
export function ownedBy(
  table: Readonly<{ id: SQLiteColumn; userId: SQLiteColumn }>,
  row: Readonly<{ id: string; userId: string }>,
): SQL | undefined {
  return and(eq(table.id, row.id), eq(table.userId, row.userId));
}

/**
 * The whole owner-scoped single-row read: predicate, limit, first row.
 *
 * `getRun` and `getImportStatus` were the same nine lines over different
 * tables, and any table with `id` + `user_id` will want the same. Generic
 * over the table so the row type stays exact at the call site — the return
 * is concrete per call, which is what lets this typecheck where a generic
 * wrapper over `createServerFn` does not.
 *
 * Returns `undefined` rather than throwing: callers differ on whether a
 * missing row is an error, and that is a decision for them.
 */
export async function selectOwnedRow<
  TTable extends SQLiteTable & { id: SQLiteColumn; userId: SQLiteColumn },
>(
  db: DrizzleD1Database,
  table: TTable,
  row: Readonly<{ id: string; userId: string }>,
): Promise<TTable["$inferSelect"] | undefined> {
  const rows = await db
    .select()
    .from(table)
    .where(ownedBy(table, row))
    .limit(1);
  return rows[0];
}
