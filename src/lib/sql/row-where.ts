import { getTableColumns, is, sql, SQL } from "drizzle-orm";
import type {
  SQLiteColumn,
  SQLiteInsertValue,
  SQLiteTable,
} from "drizzle-orm/sqlite-core";

/**
 * One row of `table` as a one-row `SELECT … WHERE onlyIf`, for
 * `insert(table).select(…)`: the row lands only if `onlyIf` holds when the
 * statement runs (design 278). A batch cannot branch on its own results,
 * so this is how a write lands exactly when the change it depends on did.
 *
 * Drizzle's insert-select names every column but a generated one of the table, in
 * the table's order, so this gives each one: the row's value, else the
 * column's default, else NULL. Read from the table, never listed by hand,
 * so a column added to it needs nothing here. No `FROM`: the condition is
 * the whole of the `WHERE`.
 */
export function rowWhere<TTable extends SQLiteTable>(
  table: TTable,
  row: SQLiteInsertValue<TTable>,
  onlyIf: SQL,
): SQL {
  const given = new Map<string, unknown>(Object.entries(row));
  const columns: Record<string, SQLiteColumn> = getTableColumns(table);
  const values = Object.entries(columns)
    // A generated column takes no value, as drizzle's own insert skips it.
    .filter(([, column]) => column.generated === undefined)
    .map(([key, column]) => valueFor(column, given.get(key)));
  return sql`select ${sql.join(values, COMMA)} where ${onlyIf}`;
}

const COMMA = sql`, `;

/**
The value a column takes: the one given, else its default, else NULL.
*/
function valueFor(column: SQLiteColumn, value: unknown): SQL {
  if (value !== undefined) return toSql(column, value);
  if (column.default !== undefined) return toSql(column, column.default);
  if (column.defaultFn !== undefined) return toSql(column, column.defaultFn());
  return sql`null`;
}

/**
A value as SQL: an expression as itself, anything else bound as the column's.
*/
function toSql(column: SQLiteColumn, value: unknown): SQL {
  return is(value, SQL) ? value : sql`${sql.param(value, column)}`;
}
