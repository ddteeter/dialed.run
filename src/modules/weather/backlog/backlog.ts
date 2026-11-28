import { and, eq, lt, or } from "drizzle-orm";

import { runs } from "../../../db/schema-core";
import { coreDb } from "../../../env";
import { nowSeconds } from "../../../lib/now";

const WEATHER_PENDING_STALE_SECONDS = 24 * 60 * 60;

/**
 * The epoch-second cutoff `n` seconds ago.
 *
 * One caller, the backlog check below. It once had three in the digest,
 * which is what made two of its stale-window checks read as clones of each
 * other. It stays named because the direction is easy to get wrong: the
 * caller wants "older than this", and a `+` where the `-` belongs would
 * silently widen the window to include the future.
 */
function secondsAgo(seconds: number): number {
  return nowSeconds() - seconds;
}

/**
 * Lane 103: `weather_failed` is always worth a look (it's a terminal,
 * capped-retry state); `weather_pending` only past a day is worth a look
 * (younger ones are still within the hourly retry cron's window). `runs`
 * has no "entered system" timestamp separate from `started_at`, so that's
 * the staleness proxy here — same approximation `retryPendingWeather` uses.
 *
 * The daily digest runs it (`dispatch`, design 258 proposal 6).
 */
export async function checkWeatherBacklog(anomalies: string[]): Promise<void> {
  const db = coreDb();
  const staleBefore = secondsAgo(WEATHER_PENDING_STALE_SECONDS);
  const stuckPending = and(
    eq(runs.weatherStatus, "pending"),
    lt(runs.startedAt, staleBefore),
  );
  const stuck = await db
    .select({ id: runs.id })
    .from(runs)
    .where(or(eq(runs.weatherStatus, "failed"), stuckPending));
  if (stuck.length > 0) {
    anomalies.push(
      `weather backlog: ${String(stuck.length)} run(s) failed/stuck pending`,
    );
  }
}
