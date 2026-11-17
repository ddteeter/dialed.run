/**
 * A column named with its table, `"table"."column"`, for a correlated
 * subquery. Drizzle may print a column bare, and inside a subquery over a
 * second table a bare name can bind to that table's column of the same
 * name: `subject_id = subject_id` is true of every row.
 */
import { sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

export function qualified(table: SQLiteTable, column: SQLiteColumn): SQL {
  return sql`${table}.${sql.identifier(column.name)}`;
}
