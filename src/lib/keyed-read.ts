import { and, inArray } from "drizzle-orm";
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
  const rows = await database
    .select({ value: column })
    .from(table)
    .where(where);
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

/**
 * The first matching row's value for `column`, or `undefined` when nothing
 * matches — `LIMIT 1`, like `hasRowWhere`, but it answers *with* the value
 * rather than with whether one exists.
 *
 * This is the read law 8b's idempotency check makes: "have we already
 * stored this submission, and if so what did it produce". `feed/photos`
 * and `runs/imports` had written it out identically around their own
 * UNIQUE index — a twelve-line select whose only variable parts were the
 * table, the column and the two `eq`s.
 *
 * Separate from `hasRowWhere` rather than derived from it, for the same
 * reason that one is separate from `columnWhere`: a caller that needs the
 * value cannot get it from a boolean, and a caller that needs only the
 * boolean should not be handed a value it might read a `NULL` out of.
 *
 * The column is the caller's, as everywhere else in this file — these
 * reads are matched by a UNIQUE index and answer from it, and a helper
 * that picked `select *` would turn each into a row read (see
 * `columnWhere`).
 */
export async function firstColumnWhere<TColumn extends SQLiteColumn>(
  database: DrizzleD1Database,
  table: SQLiteTable,
  column: TColumn,
  where: SQL | undefined,
): Promise<TColumn["_"]["data"] | undefined> {
  const [row] = await database
    .select({ value: column })
    .from(table)
    .where(where)
    .limit(1);
  return row?.value;
}

/**
 * The first matching row, whole, or `undefined` — `LIMIT 1` like the two
 * above, but this one reads the row rather than a column, and that is not
 * a lapse in the doctrine above. It is for the read a queue job opens with:
 * "the row this job points at", by primary key. There is no covering index
 * to answer from because the caller needs every column, and a lookup by
 * primary key is one row read whichever way it is written. Two consumers
 * had written it out identically.
 */
export async function firstRowWhere<TTable extends SQLiteTable>(
  database: DrizzleD1Database,
  table: TTable,
  where: SQL | undefined,
): Promise<TTable["$inferSelect"] | undefined> {
  const [row] = await database.select().from(table).where(where).limit(1);
  return row;
}

/**
 * The candidates-filtered-to-membership shape: which of these ids are in
 * this table, subject to a further predicate.
 *
 * **The `inArray` is built here, and that is the whole reason this takes a
 * column instead of a finished `where`.** The first version took the
 * predicate whole and used `candidateIds` only for an empty-list guard —
 * which meant a caller could pass a `where` that forgot the membership
 * clause, and get back every row in the table instead of the ones asked
 * about. That is not hypothetical: it happened to `blockedAmong` while
 * this helper was being written, and nothing failed, because "a superset
 * of the right answer" passes any test that only checks the expected ids
 * are present. Making the clause impossible to omit is worth the extra
 * parameter.
 *
 * **There is deliberately no empty-candidates short-circuit.** One was
 * written, and mutation testing showed it unobservable: an empty `inArray`
 * matches nothing, so every caller gets the same empty Set either way and
 * no input distinguishes the two. What a guard would buy is skipping the
 * query on a page with nobody on it. `src/modules/feed/conditions.ts`
 * keeps exactly that guard under an owner-approved grant, so the trade is
 * a live question rather than a settled one — but a guard no test can
 * reach does not belong in a file held at 100%, and adding one back is a
 * grant plus a comment rather than a silent line.
 */
export async function columnSetAmong<TColumn extends SQLiteColumn>(
  database: DrizzleD1Database,
  table: SQLiteTable,
  column: TColumn,
  membershipColumn: SQLiteColumn,
  candidateIds: readonly string[],
  extraWhere: SQL,
): Promise<Set<TColumn["_"]["data"]>> {
  const matches = await columnWhere(
    database,
    table,
    column,
    and(inArray(membershipColumn, [...candidateIds]), extraWhere),
  );
  return new Set(matches);
}
