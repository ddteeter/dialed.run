import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

/**
 * A fixed-window counter's upsert, as the two `SET` expressions it needs:
 * a window `windowS` old starts over at one, anything younger counts one
 * more. Shared by the email send limit and the limit on tries at the
 * current password, which count different things in different tables and
 * must still start and end a window the same way.
 *
 * In one statement with the insert, so two requests at once cannot both
 * read four: the row as it is when the upsert lands decides.
 */
export function windowedCountSet(
  columns: Readonly<{ startedAt: SQLiteColumn; count: SQLiteColumn }>,
  now: number,
  windowS: number,
): { startedAt: SQL; count: SQL } {
  const windowOver = sql`${columns.startedAt} <= ${now - windowS}`;
  return {
    startedAt: sql`CASE WHEN ${windowOver} THEN ${now} ELSE ${columns.startedAt} END`,
    count: sql`CASE WHEN ${windowOver} THEN 1 ELSE ${columns.count} + 1 END`,
  };
}

/**
 * When the window the upsert returned ends, if its count is over `limit`;
 * `undefined` while it is not. An upsert returns exactly its one row.
 */
export function windowedCountUntil(
  rows: readonly Readonly<{ startedAt: number; count: number }>[],
  limit: number,
  windowS: number,
): number | undefined {
  const over = rows.find((row) => row.count > limit);
  return over === undefined ? undefined : over.startedAt + windowS;
}

/**
 * `windowedCountUntil`'s verdict as SQL — true while `count` is within
 * `limit`, the complement of its `count > limit` — for a write that must
 * land in the same batch as the upsert only if it was allowed. A test
 * pins the two against each other at the boundary.
 */
export function windowedCountWithin(count: SQLiteColumn, limit: number): SQL {
  return sql`${count} <= ${limit}`;
}
