/**
 * The plumbing the audit's two database writers share (design 205): chunked
 * `batch()` calls, one insert per row of a table map, and the deletes that
 * clear what an earlier seed left. Glue only; every row comes from the pure,
 * tested planners.
 */
import { sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

/**
Statements per `batch()`: one round trip each, well under D1's limits.
*/
const BATCH = 40;

export async function inBatches(
  db: DrizzleD1Database,
  statements: readonly BatchItem<"sqlite">[],
): Promise<void> {
  for (let index = 0; index < statements.length; index += BATCH) {
    const [first, ...rest] = statements.slice(index, index + BATCH);
    if (first !== undefined) await db.batch([first, ...rest]);
  }
}

/**
One insert per row, tables in the order `tables` lists them (parents first,
for foreign keys). `rows` is keyed like `tables`; a table with no rows adds
nothing.
*/
export function insertsFor(
  db: DrizzleD1Database,
  tables: Readonly<Record<string, SQLiteTable>>,
  rows: Readonly<Record<string, readonly Record<string, unknown>[]>>,
): BatchItem<"sqlite">[] {
  const byName = new Map(Object.entries(rows));
  return Object.entries(tables).flatMap(([name, table]) =>
    (byName.get(name) ?? []).map((row) => db.insert(table).values(row)),
  );
}

/**
 * `delete from <table> where <column> like <pattern>`, once per table.
 *
 * Every part is inlined, never bound: drizzle's D1 `batch()` cannot bind a
 * raw `run()` statement's parameters (its `SQLiteRaw` has no prepared
 * statement, so it throws reading `bind`). So each part must be a plain
 * name or pattern, which these callers' constants are.
 */
export function deleteWhereLike(
  db: DrizzleD1Database,
  column: string,
  tables: readonly string[],
  pattern: string,
): BatchItem<"sqlite">[] {
  for (const part of [column, pattern, ...tables]) {
    if (!/^[\w%-]+$/u.test(part)) throw new Error(`not a plain name: ${part}`);
  }
  return tables.map((name) =>
    db.run(
      sql.raw(`delete from "${name}" where "${column}" like '${pattern}'`),
    ),
  );
}
