import { and, eq, inArray, type Column, type SQL } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import type {
  SQLiteTable,
  SQLiteUpdateSetSource,
} from "drizzle-orm/sqlite-core";

type Db = ReturnType<typeof drizzle>;

/**
 * Claim, then work (law 2): move one row's status forward, and learn
 * whether this caller was the one who moved it.
 *
 * Every status column here is a small state machine, and every consumer
 * and request path starts by trying to advance it — `pending` →
 * `processing` before an import is parsed, `none` → `pending` before an
 * enrichment is queued. The `UPDATE … WHERE status IN (…)` is what makes
 * two callers racing on one row converge: exactly one sees a row change,
 * and only that one does the work. Two modules had written it out
 * identically; the idiom now has a name.
 *
 * The write itself is the caller's, typed by its own table — this only
 * builds the guard — so a state machine's transitions stay spelled out
 * where the machine lives.
 */
export async function didClaim<TTable extends SQLiteTable>(
  db: Db,
  table: TTable,
  key: { id: Column; status: Column },
  id: string,
  from: readonly string[],
  set: SQLiteUpdateSetSource<TTable>,
  also?: SQL,
): Promise<boolean> {
  const rows = await db
    .update(table)
    .set(set)
    .where(and(eq(key.id, id), inArray(key.status, from), also))
    .returning();
  return rows.length > 0;
}
