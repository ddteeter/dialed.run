import { drizzle } from "drizzle-orm/d1";

import { cronCheckpoints } from "../../db/schema-core";
import { env } from "../../env";
import { captureException } from "./sentry";

const DIGEST_CRON = "0 12 * * *";

/**
 * Cron entry (000 §10). Every cron writes its heartbeat row first (the
 * digest flags stale ones — law: crons must be safely re-runnable).
 */
export async function handleScheduled(
  controller: ScheduledController,
): Promise<void> {
  const db = drizzle(env.DIALED_CORE);
  const cronName = controller.cron === DIGEST_CRON ? "daily-digest" : "unknown";
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
    captureException(new Error("unrecognized cron fired"), {
      cron: controller.cron,
    });
  }
}

/**
 * Exception-based alerting skeleton: checks run, thresholds compare, and
 * ONLY anomalies get surfaced. Notification transport (email) lands with
 * lane 102's notification plumbing; until then anomalies go to Sentry.
 */
async function runDailyDigest(): Promise<void> {
  await Promise.resolve(); // real checks (each an awaited query) land with their lanes
  const anomalies: string[] = [];
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
