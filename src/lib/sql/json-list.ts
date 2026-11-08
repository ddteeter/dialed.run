/**
 * A list of values bound as **one** parameter and read back with SQLite's
 * `json_each` (design 188): what lets a read take a page of subjects in
 * one statement. D1 refuses a statement with more than 100 bound
 * parameters, which is why an `IN (…)` list is chunked
 * (`lib/chunked.ts`); a JSON list binds one, however long it is, and the
 * statement's text stays the same size.
 *
 * Each value is bound, never spelt into the SQL, so nothing in it needs
 * parsing first.
 */
import { sql, type SQL } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

type Db = ReturnType<typeof drizzle>;

/**
 * The list as a table-valued source: one row per item, its value under
 * `value`. An item that is an object comes back as JSON text, which
 * `json_extract(value, '$.field')` reads a field of.
 */
export function jsonEach(items: readonly unknown[]): SQL {
  return sql`json_each(${JSON.stringify(items)})`;
}

/**
 * `column IN` the list, as SQL. An empty list matches nothing, as an
 * empty `IN ()` would.
 */
export function inJsonList(
  column: SQLiteColumn,
  values: readonly string[],
): SQL {
  return sql`${column} in (select value from ${jsonEach(values)})`;
}

/**
 * A field of each item, read from `json_each`'s `value`. The path is bound
 * like any value: one parameter a field, a handful a statement.
 */
export function jsonField<T>(field: string): SQL<T> {
  const path = ["$", field].join(".");
  return sql<T>`json_extract(value, ${path})`;
}

/**
 * The list as a named table a read joins (a `WITH`): one row an item, its
 * fields as `columns` selects them, each a `jsonField` under an alias.
 *
 * **Alias every field apart from every column the read touches.** A
 * CTE's field is spelt unqualified, so a subquery over a table with a
 * column of the same name resolves to that column first, silently.
 */
export function jsonTable<TColumns extends Record<string, SQL.Aliased>>(
  db: Db,
  name: string,
  items: readonly unknown[],
  columns: TColumns,
) {
  return db.$with(name).as(db.select(columns).from(jsonEach(items)));
}
