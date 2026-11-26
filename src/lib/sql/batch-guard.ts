import { sql } from "drizzle-orm";
import type { BatchItem, BatchResponse } from "drizzle-orm/batch";
import type { drizzle } from "drizzle-orm/d1";

import { isWriteStatement } from "./d1-session";

type Db = ReturnType<typeof drizzle>;

/**
 * A guarded statement: a write that aborts its whole `db.batch()` when it
 * changes no rows (design 277 §2).
 *
 * A batch runs in order, as one transaction, and a guard that misses
 * (an `UPDATE … WHERE status = 'pending'` that matches nothing) is not an
 * error: the statements after it still run and commit. When they depend
 * on it, wrap it here instead, and a miss rolls the batch back.
 *
 * Prefer folding the condition into each dependent statement's own WHERE
 * (`.claude/rules/server.md` §D1 discipline): then the batch is right
 * either way and nothing has to fail. Use this when a miss must stop
 * everything, or must be reported. Never on a guard that may miss on its
 * own (a cleanup that found nothing, an independent claim), because that
 * turns a correct no-op into a failure.
 *
 * How it aborts: SQLite's `changes()` is the row count of the last
 * completed INSERT, UPDATE or DELETE on the connection, and in a D1 batch
 * that is the statement just before. The guard selects
 * `json_extract('{}', <path>)` only when that count is 0, and a path that
 * is not one fails the statement, and so the batch, with the path in the
 * message. No table and no trigger: a CHECK constraint or a `RAISE` would
 * need both. Because `changes()` belongs to the connection, the guard must
 * sit directly after its statement, so `guarded` hands back the pair and
 * nothing goes between them.
 */

/**
 * A label names the guard in the error and in `runGuarded`'s answer:
 * lower-case words and digits joined by `-`, so it cannot close the quote
 * SQLite wraps the path in.
 */
const LABEL = /^[a-z0-9-]+$/u;

/**
 * The start of every guard's path. Not a JSON path (those start with
 * `$`), so the extract always fails when it runs.
 */
const PATH_PREFIX = "batch guard missed: ";

/**
 * SQLite's wording when the guard fires, as D1 reports it:
 * `D1_ERROR: bad JSON path: 'batch guard missed: <label>': SQLITE_ERROR`.
 * Wording, not an API, so `test/lib/batch-guard.test.ts` pins it.
 */
const MISSED = /bad JSON path: 'batch guard missed: ([a-z0-9-]+)'/u;

/**
 * A write builder: drizzle's insert, update and delete builders all carry
 * `toSQL()`, which is how `guarded` checks it is not a select.
 */
type Write = BatchItem<"sqlite"> & { toSQL: () => { sql: string } };

/**
 * `write`, then the guard that aborts the batch if `write` changed no
 * rows. Spread it into the batch: `db.batch([...guarded(db, claim,
 * "claim"), notice])`. The guard is one more statement, so every result
 * after it moves along by one.
 */
export function guarded<W extends Write>(db: Db, write: W, label: string) {
  if (!LABEL.test(label)) {
    throw new Error(`a guard label is lower-case words and digits: ${label}`);
  }
  if (!isWriteStatement(write.toSQL().sql)) {
    throw new Error(`guard "${label}" wraps a select, which changes no rows`);
  }
  const guard = db
    .select({
      missed: sql<null>`CASE WHEN changes() = 0 THEN json_extract('{}', ${PATH_PREFIX + label}) END`,
    })
    .from(sql`(SELECT 1)`);
  return [write, guard] as const;
}

/**
 * The label of the guard that aborted a batch, or `undefined` for any
 * other error.
 */
function missedLabel(error: unknown): string | undefined {
  // `String` of an Error is its name and message, so one match reads an
  // Error and anything else that was thrown, with no branch between them.
  return MISSED.exec(String(error))?.[1];
}

type Batch = Readonly<[BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]>;

export type GuardedResult<T extends Batch> =
  | { readonly ok: true; readonly results: BatchResponse<T> }
  | { readonly ok: false; readonly missed: string };

/**
 * Run a batch that holds `guarded` statements. A guard that fired comes
 * back as `{ ok: false, missed }`, nothing written; any other error is
 * thrown as it came. What a miss means is the caller's: a conflict answer
 * in a request; in a queue consumer usually "someone else got there
 * first", since throwing would retry it to the dead-letter queue.
 */
export async function runGuarded<T extends Batch>(
  db: Db,
  items: T,
): Promise<GuardedResult<T>> {
  try {
    const results = await db.batch<T[number], T>(items);
    return { ok: true, results };
  } catch (error) {
    const missed = missedLabel(error);
    if (missed === undefined) throw error;
    return { ok: false, missed };
  }
}
