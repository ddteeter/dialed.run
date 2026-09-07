import { and, eq, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { cronCheckpoints, runs } from "../../db/schema-core";
import { env } from "../../env";
import { retryPendingWeather } from "../weather";
import { cronNameFor } from "./crons";
import { captureException } from "./sentry";

const WEATHER_PENDING_STALE_SECONDS = 24 * 60 * 60;

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

  switch (cronName) {
    case "daily-digest": {
      await runDailyDigest();
      break;
    }
    case "weather-retry": {
      // docs/tasks/103-weather.md requirement 4/5: the hourly
      // pending-observation retry, claim-then-work at the module level.
      await retryPendingWeather();
      break;
    }
    default: {
      // Config/code skew that the bindings-conformance test should have
      // caught in CI before it could reach a real schedule.
      captureException(new Error("unrecognized cron fired"), {
        cron: controller.cron,
      });
    }
  }
}


/**
 * Exception-based alerting skeleton: checks run, thresholds compare, and
 * ONLY anomalies get surfaced. Notification transport (email) lands with
 * lane 102's notification plumbing; until then anomalies go to Sentry.
 */
async function runDailyDigest(): Promise<void> {
  const anomalies: string[] = [];
  await checkWeatherBacklog(anomalies);
  // Threshold checks fill in as their features land:
  // - failed-import rate (lane 102)
  // - stale cron_checkpoints rows
  if (anomalies.length > 0) {
    captureException(new Error("daily digest anomalies"), {
      anomalies: anomalies.join("; "),
    });
  }
}

/**
 * Lane 103: `weather_failed` is always worth a look (it's a terminal,
 * capped-retry state); `weather_pending` only past a day is worth a look
 * (younger ones are still within the hourly retry cron's window). `runs`
 * has no "entered system" timestamp separate from `started_at`, so that's
 * the staleness proxy here — same approximation `retryPendingWeather` uses.
 */
async function checkWeatherBacklog(anomalies: string[]): Promise<void> {
  const db = drizzle(env.DIALED_CORE);
  const staleBefore = Math.floor(Date.now() / 1000) - WEATHER_PENDING_STALE_SECONDS;
  const stuckPending = and(
    eq(runs.weatherStatus, "pending"),
    lt(runs.startedAt, staleBefore),
  );
  const stuck = await db
    .select({ id: runs.id })
    .from(runs)
    .where(or(eq(runs.weatherStatus, "failed"), stuckPending));
  if (stuck.length > 0) {
    anomalies.push(`weather backlog: ${String(stuck.length)} run(s) failed/stuck pending`);
  }
}
