import { and, eq, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  cronCheckpoints,
  imports,
  stravaRevocations,
} from "../../db/schema-core";
import { env } from "../../env";
import { cronNameFor } from "./crons";
import { captureException } from "./sentry";

/**
 * Cron entry (000 §10). Every cron writes its heartbeat row first (the
 * digest flags stale ones — law: crons must be safely re-runnable).
 */
export async function handleScheduled(
  controller: ScheduledController,
): Promise<void> {
  const db = drizzle(env.DIALED_CORE);
  const cronName = cronNameFor(controller.cron) ?? "unknown";
  await db
    .insert(cronCheckpoints)
    .values({ cronName, lastRunAt: Math.floor(Date.now() / 1000) })
    .onConflictDoUpdate({
      target: cronCheckpoints.cronName,
      set: { lastRunAt: Math.floor(Date.now() / 1000) },
    });

  if (cronName === "daily-digest") {
    await runDailyDigest();
  } else {
    // Config/code skew that the bindings-conformance test should have
    // caught in CI before it could reach a real schedule.
    captureException(new Error("unrecognized cron fired"), {
      cron: controller.cron,
    });
  }
}

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
 * consumer claims the row (`pending` -> `processing`) before working, so a
 * duplicate delivery loses the race and stops.
 *
 * Only imports older than the grace window, so this never races a normal
 * dispatch still in flight.
 */
const IMPORT_STALL_GRACE_S = 15 * 60;

async function redispatchStalledImports(anomalies: string[]): Promise<void> {
  const db = drizzle(env.DIALED_CORE);
  const staleBefore = Math.floor(Date.now() / 1000) - IMPORT_STALL_GRACE_S;
  const stalled = await db
    .select({ id: imports.id })
    .from(imports)
    .where(
      and(
        eq(imports.status, "pending"),
        lt(imports.createdAt, staleBefore),
      ),
    )
    .limit(100);
  if (stalled.length === 0) return;

  for (const row of stalled) {
    try {
      await env.IMPORTS_QUEUE.send({ type: "import", importId: row.id });
    } catch (error) {
      captureException(error, {
        surface: "import-redispatch",
        importId: row.id,
      });
    }
  }
  anomalies.push(
    `${String(stalled.length)} import(s) stalled pending and were re-dispatched`,
  );
}

/**
 * The durable half of the disconnect flow.
 *
 * Disconnecting writes a `strava_revocations` row in the same batch as the
 * delete, then dispatches to the queue as a fast path. If that dispatch
 * failed — or the message was lost — the row is still here, and nothing
 * else would ever look at it. This is what makes the outbox an actual
 * guarantee rather than a record of good intentions.
 *
 * Re-dispatch rather than revoke inline: the consumer already owns that
 * path, including deleting the row on success.
 */
async function redispatchStrandedRevocations(
  anomalies: string[],
): Promise<void> {
  const db = drizzle(env.DIALED_CORE);
  const stranded = await db
    .select({ id: stravaRevocations.id })
    .from(stravaRevocations)
    .limit(100);
  if (stranded.length === 0) return;

  for (const row of stranded) {
    try {
      await env.IMPORTS_QUEUE.send({
        type: "strava_revoke",
        revocationId: row.id,
      });
    } catch (error) {
      captureException(error, {
        surface: "revocation-redispatch",
        revocationId: row.id,
      });
    }
  }
  anomalies.push(
    `${String(stranded.length)} Strava revocation(s) awaited re-dispatch`,
  );
}

/**
 * Exception-based alerting skeleton: checks run, thresholds compare, and
 * ONLY anomalies get surfaced. Notification transport (email) lands with
 * lane 102's notification plumbing; until then anomalies go to Sentry.
 */
async function runDailyDigest(): Promise<void> {
  const anomalies: string[] = [];
  await redispatchStrandedRevocations(anomalies);
  await redispatchStalledImports(anomalies);
  // Threshold checks fill in as their features land:
  // - weather_pending > N for > 24h (lane 103)
  // - failed-import rate (lane 102)
  // - stale cron_checkpoints rows
  if (anomalies.length > 0) {
    captureException(new Error("daily digest anomalies"), {
      anomalies: anomalies.join("; "),
    });
  }
}
