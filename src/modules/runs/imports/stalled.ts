import { eq } from "drizzle-orm";

import { imports } from "../../../db/schema-core";
import { stalledPending } from "../../../lib/sql/keyed-read";
import { redispatchEach, type Reporter } from "../../../lib/sql/queue-batch";
import { coreDb } from "../core-db";
import { importJob } from "../queue-messages";
import type { ImportsQueueProducer } from "./imports";

/**
 * Reconciliation for the upload path.
 *
 * `startImport` writes to three systems in sequence — R2, then the row,
 * then the queue — and nothing spans them. A queue send that fails after
 * the row is written leaves an import stuck `pending` with nothing to pick
 * it up: the user's file silently never processes, and the UI eventually
 * stops polling and says it is taking a while.
 *
 * `imports.status` is already the durable "not finished" marker, so this
 * is reconciliation rather than an outbox (law 8c) — no new table, just
 * something that re-drives the marker. Re-enqueueing is safe because the
 * consumer claims the row (`pending` -> `processing`) before working, and
 * each message is its own claimant (`importJob`): a second message for an
 * import finds the row claimed, or concluded, and stops.
 *
 * Only imports older than the grace window, so this never races a normal
 * dispatch still in flight.
 */
const IMPORT_STALL_GRACE_S = 15 * 60;

/**
The daily digest's re-drive of stalled imports (design 258 proposal 6): `dispatch` runs it.
*/
export async function redispatchStalledImports(
  anomalies: string[],
  queue: ImportsQueueProducer,
  report: Reporter["captureException"],
): Promise<void> {
  const stalled = await stalledPending(
    coreDb(),
    {
      table: imports,
      id: imports.id,
      pending: eq(imports.status, "pending"),
      createdAt: imports.createdAt,
      order: imports.createdAt,
    },
    IMPORT_STALL_GRACE_S,
  );
  await redispatchEach(anomalies, stalled, {
    queue,
    captureException: report,
    message: (row) => importJob(row.id),
    errorContext: (row) => ({
      surface: "import-redispatch",
      importId: row.id,
    }),
    describe: (count) =>
      `${String(count)} import(s) stalled pending and were re-dispatched`,
  });
}
