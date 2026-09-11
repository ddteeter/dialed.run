import { and, eq, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  cronCheckpoints,
  imports,
  runs,
  stravaRevocations,
} from "../../db/schema-core";
import { env } from "../../env";
import { retryPendingWeather } from "../weather";
import { cronNameFor } from "./crons";
import { captureException } from "./sentry";

const WEATHER_PENDING_STALE_SECONDS = 24 * 60 * 60;

/**
 * What a cron run found. `anomalies` is the digest's product — the things
 * a human should look at — and it is returned rather than only shipped to
 * Sentry so that "the digest found nothing" is a fact a caller and a test
 * can read. Every other cron returns an empty list.
 */
export interface ScheduledOutcome {
  readonly cronName: string;
  readonly anomalies: readonly string[];
}

/**
 * Cron entry (000 §10). Every cron writes its heartbeat row first (the
 * digest flags stale ones — law: crons must be safely re-runnable).
 */
export async function handleScheduled(
  controller: ScheduledController,
): Promise<ScheduledOutcome> {
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
      return { cronName, anomalies: await runDailyDigest() };
    }
    case "weather-retry": {
      // docs/tasks/103-weather.md requirement 4/5: the hourly
      // pending-observation retry, claim-then-work at the module level.
      await retryPendingWeather();
      return { cronName, anomalies: [] };
    }
    default: {
      // Config/code skew that the bindings-conformance test should have
      // caught in CI before it could reach a real schedule.
      captureException(new Error("unrecognized cron fired"), {
        cron: controller.cron,
      });
      return { cronName, anomalies: [] };
    }
  }
}


/**
 * Re-dispatch a batch of rows to the imports queue, one message each.
 *
 * Both re-dispatch paths below had written this out: the early return on
 * an empty batch, the per-row `send` in a `try` so one bad row cannot
 * abandon the rest, the Sentry capture, and the anomaly line at the end.
 * They differed in the message, the Sentry context and the sentence, which
 * is what the three callbacks are.
 *
 * **The `try` is inside the loop on purpose and must stay there.** A
 * failed send is reported and skipped, not fatal: these are reconciliation
 * passes, so a row that cannot be dispatched this hour is picked up the
 * next. Hoisting the `try` out would let one failure strand every row
 * behind it until someone noticed.
 *
 * The anomaly is pushed on the row count, not on the number of successful
 * sends, and that is also deliberate — the digest is reporting that a
 * backlog existed, which is true whether or not the re-dispatch landed.
 */
async function redispatchEach<TRow extends { id: string }>(
  anomalies: string[],
  rows: readonly TRow[],
  handlers: Readonly<{
    message: (row: TRow) => Parameters<typeof env.IMPORTS_QUEUE.send>[0];
    errorContext: (row: TRow) => Record<string, string>;
    describe: (count: number) => string;
  }>,
): Promise<void> {
  if (rows.length === 0) return;

  for (const row of rows) {
    try {
      await env.IMPORTS_QUEUE.send(handlers.message(row));
    } catch (error) {
      captureException(error, handlers.errorContext(row));
    }
  }
  anomalies.push(handlers.describe(rows.length));
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
  // fallow-ignore-next-line code-duplication -- two different backlogs: imports stalled past the grace window, and runs whose weather never resolved -- same shape, different tables and thresholds
  const staleBefore = Math.floor(Date.now() / 1000) - IMPORT_STALL_GRACE_S;
  const stalled = await db
    .select({ id: imports.id })
    .from(imports)
    .where(
      and(
        eq(imports.status, "pending"),
        lt(imports.createdAt, staleBefore),
      // fallow-ignore-next-line code-duplication -- both callers of redispatchEach -- the shared body is already extracted, and what rhymes now is the call
      ),
    )
    .limit(100);
  await redispatchEach(anomalies, stalled, {
    message: (row) => ({ type: "import", importId: row.id }),
    errorContext: (row) => ({
      surface: "import-redispatch",
      importId: row.id,
    }),
    describe: (count) =>
      `${String(count)} import(s) stalled pending and were re-dispatched`,
  });
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
  await redispatchEach(anomalies, stranded, {
    message: (row) => ({ type: "strava_revoke", revocationId: row.id }),
    errorContext: (row) => ({
      surface: "revocation-redispatch",
      revocationId: row.id,
    }),
    describe: (count) =>
      `${String(count)} Strava revocation(s) awaited re-dispatch`,
  });
}

/**
 * Exception-based alerting skeleton: checks run, thresholds compare, and
 * ONLY anomalies get surfaced. Notification transport (email) lands with
 * lane 102's notification plumbing; until then anomalies go to Sentry.
 */
async function runDailyDigest(): Promise<string[]> {
  const anomalies: string[] = [];
  await checkWeatherBacklog(anomalies);
  await redispatchStrandedRevocations(anomalies);
  await redispatchStalledImports(anomalies);
  // Threshold checks fill in as their features land:
  // - failed-import rate (lane 102)
  // - stale cron_checkpoints rows
  if (anomalies.length > 0) {
    captureException(new Error("daily digest anomalies"), {
      anomalies: anomalies.join("; "),
    });
  }
  return anomalies;
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
