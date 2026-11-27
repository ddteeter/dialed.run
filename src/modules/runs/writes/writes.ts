/**
 * `runs`' own writes that another module asks for (design 275, design 258
 * proposal 7): the Desk's two retries and a kit's pick of effort. Each
 * keeps its batch whole, so the caller hands in what rides with it: the
 * Desk's row to settle (`gave_up` is not `runs`'), or the verdict's other
 * statements around the effort's.
 */
import { and, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { imports, outbox, runs } from "../../../db/schema-core";
import { firstColumnWhere, firstRowWhere } from "../../../lib/sql/keyed-read";
import { dedupeKeyFor } from "../../../lib/sql/outbox";
import { importJob, type ImportJob } from "../queue-messages";

type Db = DrizzleD1Database;

/**
 * The Desk's row for the job being retried, as a statement: put in the
 * retry's batch when there is something to retry, sent alone when there
 * is not.
 */
type Settle = () => BatchItem<"sqlite">;

/**
What a retry did: sent the job back, or found nothing left to retry.
*/
type Retried = "retried" | "gone";

export interface ImportRetryDeps {
  readonly settle: Settle;
  readonly queue: { send: (message: ImportJob) => Promise<unknown> };
  /**
  Whether an import's run file is still in the bucket.
  */
  readonly importFileExists: (key: string) => Promise<boolean>;
  readonly report: (error: unknown, context: Record<string, string>) => void;
}

/**
 * An import goes back to `pending`, its owed file deletion is cancelled —
 * the file is to be read again, and reading it owes its deletion (D-116) — and
 * `import` is sent. A send that fails leaves the import `pending`, which
 * the stalled-import sweep re-dispatches, so the send's failure is
 * reported rather than thrown. A retry that fails again re-owes the
 * deletion, as every failure does.
 */
export async function retryFailedImport(
  db: Db,
  importId: string,
  deps: ImportRetryDeps,
): Promise<Retried> {
  const importRow = await firstRowWhere(db, imports, eq(imports.id, importId));
  // An import whose file has gone — its 30-day expiry paid, or the
  // account purged — cannot be read again: re-sending it would fail at
  // once and send its runner a second, misleading failure notice. So the
  // row goes, and nothing is sent.
  if (
    importRow === undefined ||
    !(await deps.importFileExists(importRow.r2Key))
  ) {
    await db.batch([deps.settle()]);
    return "gone";
  }
  const expiry = dedupeKeyFor({
    kind: "import_file_expire",
    payload: { userId: importRow.userId, key: importRow.r2Key },
  });
  const stillFailed = and(
    eq(imports.id, importRow.id),
    eq(imports.status, "failed"),
  );
  const owedExpiry = and(
    eq(outbox.kind, "import_file_expire"),
    eq(outbox.dedupeKey, expiry),
  );
  await db.batch([
    db
      .update(imports)
      .set({ status: "pending", failureReason: sql`NULL` })
      .where(stillFailed),
    db.delete(outbox).where(owedExpiry),
    deps.settle(),
  ]);
  try {
    await deps.queue.send(importJob(importRow.id));
  } catch (error) {
    deps.report(error, {
      surface: "desk-retry-import",
      importId: importRow.id,
    });
  }
  return "retried";
}

/**
 * Weather goes back to `pending`, which is the hourly cron's own marker
 * (law 8c, reconciliation): no message to send, and nothing lost if the
 * Desk's request dies after the batch.
 */
export async function retryFailedWeather(
  db: Db,
  runId: string,
  settle: Settle,
): Promise<Retried> {
  const run = await firstColumnWhere(db, runs, runs.id, eq(runs.id, runId));
  const stillFailed = and(eq(runs.id, runId), eq(runs.weatherStatus, "failed"));
  await db.batch([
    db.update(runs).set({ weatherStatus: "pending" }).where(stillFailed),
    settle(),
  ]);
  return run === undefined ? "gone" : "retried";
}

/**
 * The runner's own pick of effort (G5), for the verdict's batch because
 * it is the same Log it. It replaces a watch's prefill for good, and only
 * on their own run.
 */
export function runEffortStatement(
  db: Db,
  run: { readonly runId: string; readonly userId: string },
  effort: NonNullable<(typeof runs.$inferInsert)["effort"]>,
) {
  return db
    .update(runs)
    .set({ effort, effortSource: "runner" })
    .where(and(eq(runs.id, run.runId), eq(runs.userId, run.userId)));
}
