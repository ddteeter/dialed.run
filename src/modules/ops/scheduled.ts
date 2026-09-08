import { drizzle } from "drizzle-orm/d1";

import {
  cronCheckpoints,
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
