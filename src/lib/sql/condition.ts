import { sql, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

/**
Any handle on a D1 database, whatever schema it was typed with.
*/
type Handle = DrizzleD1Database<Record<string, unknown>>;

/**
 * Whether a condition holds, read on its own: for a condition a write
 * also carries, so a caller can refuse early with the same rule the write
 * enforces, rather than a second copy of it. One row when it holds, none
 * when it does not.
 */
export async function doesConditionHold(
  database: Handle,
  condition: SQL,
): Promise<boolean> {
  const rows = await database
    .select({ holds: sql`1` })
    .from(sql`(select 1)`)
    .where(condition);
  return rows.length > 0;
}
