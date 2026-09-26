import { and, eq, gt, inArray, lt, or, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  cronCheckpoints,
  imports,
  products,
  runs,
  stravaRevocations,
} from "../../db/schema-core";
import { env } from "../../env";
import { chunked, IN_LIST_CHUNK } from "../../lib/chunked";
import { columnWhere } from "../../lib/keyed-read";
import { retryPendingWeather } from "../weather";
import { cronNameFor, type CronName } from "./crons";
import { checkOutboxBacklog, drainOutbox } from "./outbox";
import {
  captureException,
  sentryCronReporter,
  type CronReporter,
  type SentryReport,
} from "./sentry";
import {
  classifierFromEnv,
  pendingReviewCount,
  reconcileUnhiddenReports,
  releaseStaleClaims,
  retryPendingScreenings,
} from "../safety";

import { nowSeconds } from "../../lib/now";
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
 * digest flags stale ones — law: crons must be safely re-runnable), then
 * checks in with Sentry Crons around the work (OPS-3): `in_progress`, then
 * `ok` or `error`. The row says when a cron last ran to anyone reading the
 * database; the check-in says so to someone who is not, and is the only one
 * of the two that can notice a cron that stopped firing altogether.
 *
 * `reporter` is a parameter so a test can read the check-ins and digest
 * events a firing produced. Production passes nothing and gets Sentry.
 */
export async function handleScheduled(
  controller: ScheduledController,
  reporter: CronReporter = sentryCronReporter,
): Promise<ScheduledOutcome> {
  const db = drizzle(env.DIALED_CORE);
  const cronName = cronNameFor(controller.cron);
  await db
    .insert(cronCheckpoints)
    .values({ cronName: cronName ?? "unknown", lastRunAt: nowSeconds() })
    .onConflictDoUpdate({
      target: cronCheckpoints.cronName,
      set: { lastRunAt: nowSeconds() },
    });

  if (cronName === undefined) {
    // Config/code skew that the bindings-conformance test should have
    // caught in CI before it could reach a real schedule. No check-in: a
    // monitor named for a schedule nobody registered would be a second
    // thing to forget.
    captureException(new Error("unrecognized cron fired"), {
      cron: controller.cron,
    });
    return { cronName: "unknown", anomalies: [] };
  }

  const checkIn = reporter.checkIn({
    slug: cronName,
    schedule: controller.cron,
  });
  try {
    const anomalies = await runCron(cronName, reporter);
    checkIn.finish("ok");
    return { cronName, anomalies };
  } catch (error) {
    checkIn.finish("error");
    throw error;
  }
}

async function runCron(
  cronName: CronName,
  reporter: CronReporter,
): Promise<readonly string[]> {
  switch (cronName) {
    case "daily-digest": {
      return runDailyDigest(reporter);
    }
    case "weather-retry": {
      // docs/tasks/103-weather.md requirement 4/5: the hourly
      // pending-observation retry, claim-then-work at the module level.
      await retryPendingWeather();
      return [];
    }
    case "enrichment-retry": {
      const anomalies: string[] = [];
      await redispatchStalledEnrichments(anomalies);
      return anomalies;
    }
    case "screening-retry": {
      return runScreeningRetry();
    }
  }
}

async function runScreeningRetry(): Promise<string[]> {
  // Task 106 §1: re-drive photos still marked `pending` (law 8c).
  // `pending` is the durable marker, so this is reconciliation and the
  // path needs no queue.
  const anomalies: string[] = [];
  await retryPendingScreenings(classifierFromEnv(), anomalies);
  // Two more reconciliations share this firing, both raised on PR #73
  // and both the same shape as the screening retry: a durable marker
  // exists, so something has to re-read it.
  //
  // The hide that `fileReport` does in a third statement, if the
  // worker died before reaching it — the reports are written, the
  // entry is still visible, and nothing else would ever notice.
  const reconciled = await reconcileUnhiddenReports();
  if (reconciled.hidden > 0) {
    anomalies.push(
      `${String(reconciled.hidden)} reported subjects were over the threshold and had not been hidden`,
    );
  }
  // And review claims whose reviewer never came back, which otherwise
  // hold a subject out of the queue permanently.
  const released = await releaseStaleClaims();
  if (released.released > 0) {
    anomalies.push(
      `${String(released.released)} review claims went stale and were returned to the queue`,
    );
  }
  return anomalies;
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
    queue: Pick<Queue, "send">;
    message: (row: TRow) => Parameters<Queue["send"]>[0];
    errorContext: (row: TRow) => Record<string, string>;
    describe: (count: number) => string;
  }>,
): Promise<void> {
  if (rows.length === 0) return;

  for (const row of rows) {
    try {
      await handlers.queue.send(handlers.message(row));
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

/**
 * Rows that have sat `pending` past a grace window — the reconciliation
 * query (law 8c), written once for every table that carries the marker.
 * The columns are passed rather than the table alone because each table
 * names its status column differently, and a union of the two column
 * types is what lets `eq` accept "pending" for both.
 */
async function stalledPending(
  marker: {
    table: typeof imports | typeof products;
    id: typeof imports.id | typeof products.id;
    status: typeof imports.status | typeof products.extractionStatus;
    createdAt: typeof imports.createdAt | typeof products.createdAt;
  },
  graceSeconds: number,
): Promise<{ id: string }[]> {
  const db = drizzle(env.DIALED_CORE);
  const staleBefore = secondsAgo(graceSeconds);
  return db
    .select({ id: marker.id })
    .from(marker.table)
    .where(and(eq(marker.status, "pending"), lt(marker.createdAt, staleBefore)))
    .limit(100);
}

async function redispatchStalledImports(anomalies: string[]): Promise<void> {
  const stalled = await stalledPending(
    {
      table: imports,
      id: imports.id,
      status: imports.status,
      createdAt: imports.createdAt,
    },
    IMPORT_STALL_GRACE_S,
  );
  // fallow-ignore-next-line code-duplication -- both callers of redispatchEach -- the shared body is already extracted, and what rhymes now is the call
  await redispatchEach(anomalies, stalled, {
    queue: env.IMPORTS_QUEUE,
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
    queue: env.IMPORTS_QUEUE,
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
 * Reconciliation for the enrichment path (law 8c), and the reason
 * `requestEnrichment` may lose a queue send without losing the work.
 *
 * `products.extraction_status = 'pending'` is the durable "owes an
 * extraction" marker; this re-drives it. The grace window is measured from
 * `created_at`, which is the row's creation and not the moment it went
 * pending — a product re-requested after a `failed` run is "stalled" on
 * the next firing. That costs at most one duplicate message an hour, which
 * the consumer answers from the snapshot it already has.
 *
 * Its own hourly cron rather than a line in the daily digest, so a dropped
 * send costs a runner an hour and not a day.
 */
const ENRICHMENT_STALL_GRACE_S = 15 * 60;

/**
 * `failed` is re-driven too, which `pending` alone would not cover — but
 * only for the product's first day.
 *
 * **Because composition now comes only from the model** (owner,
 * 2026-09-14), a job that exhausts its retries while OpenAI is
 * unreachable dead-letters and marks the product `failed` — and
 * `requestEnrichment` only claims `none` and `failed` on a *new paste*, so
 * nothing would ever look at it again. That is the right terminal state for
 * "this page states no composition" and the wrong one for "the model was
 * down for twenty minutes", and the row cannot tell us which it was.
 *
 * So both are re-driven, and the cost of getting it wrong is asymmetric: a
 * page that genuinely has nothing is re-fetched a few times and answers
 * nothing again, where a product wrongly abandoned stays wrong forever.
 *
 * **A few times, not forever** (PR #72 review). Unbounded, a page that
 * 404s — or 403s even through the proxy, at a credit a try — is re-fetched
 * every hour for the life of the row, and a Sentry event with it. A day
 * of hourly retries outlasts any model outage worth waiting out; past it
 * the row is *abandoned*, which the daily digest reports (law 6), and a
 * fresh paste of the same URL is what claims it again.
 *
 * **And the re-drive is a claim, not just a send.** The consumer treats
 * only `pending` as work, so re-dispatching a `failed` row without
 * flipping it was a message the consumer acked and ignored — the anomaly
 * line said "re-dispatched" and nothing happened. Flipped in SQL before the
 * send (law 2): a send that then fails leaves the row `pending`, which the
 * next sweep picks up on its own.
 */
const ENRICHMENT_RETRY_WINDOW_S = 24 * 60 * 60;

/**
The instant (epoch seconds) before which a `failed` product is abandoned.
*/
function abandonedBefore(): number {
  return nowSeconds() - ENRICHMENT_RETRY_WINDOW_S;
}

/**
 * `failed` past the grace window and inside the product's first day: the
 * rows the sweep still owes a retry.
 */
function failedAndOwed(): SQL | undefined {
  const staleBefore = nowSeconds() - ENRICHMENT_STALL_GRACE_S;
  return and(
    eq(products.extractionStatus, "failed"),
    lt(products.createdAt, staleBefore),
    gt(products.createdAt, abandonedBefore()),
  );
}

/**
 * How much is waiting on a person (task 106 §2).
 *
 * Reported at ANY depth rather than past a threshold, and that is the
 * difference between this and the other digest checks. The others watch
 * for a system misbehaving, where a small number is noise; this one is a
 * queue whose whole promise is "a person reads it within a day", and the
 * failure mode is a queue nobody opened rather than a queue that grew.
 * One waiting report is worth saying out loud; zero says nothing, so the
 * digest stays quiet on the ordinary day.
 *
 * The number is safety's `pendingReviewCount`, which the Desk's Today
 * reads too, so the digest and Today cannot disagree (Operator Screens
 * D5) — and the digest does not pay for Today's other reads to get it.
 */
async function checkReviewQueueDepth(anomalies: string[]): Promise<void> {
  const waiting = await pendingReviewCount();
  if (waiting === 0) return;
  anomalies.push(`${String(waiting)} item(s) awaiting moderation review`);
}

/**
 * The epoch-second cutoff `n` seconds ago.
 *
 * Written out at three call sites, which is what made two of the digest's
 * stale-window checks read as clones of each other. Naming it also makes
 * the direction hard to get wrong: every caller wants "older than this",
 * and a `+` where the `-` belongs would silently widen every window to
 * include the future.
 */
function secondsAgo(seconds: number): number {
  return nowSeconds() - seconds;
}

async function redispatchStalledEnrichments(
  anomalies: string[],
): Promise<void> {
  // Two reads rather than one with an OR. The `pending` half is exactly
  // the question `stalledPending` already asks, and the `failed` half has
  // a bound it does not — so each is asked of the helper that fits, and
  // the failed half goes unlimited, since a day's failed pastes is small
  // where a stuck-pending backlog is not.
  const db = drizzle(env.DIALED_CORE);
  const pending = await stalledPending(
    {
      table: products,
      id: products.id,
      status: products.extractionStatus,
      createdAt: products.createdAt,
    },
    ENRICHMENT_STALL_GRACE_S,
  );
  const failedIds = await columnWhere(
    db,
    products,
    products.id,
    failedAndOwed(),
  );
  // The claim (law 2), before the send: the consumer treats only `pending`
  // as work. Re-checked against the status rather than trusting the read,
  // so a row that finished in between is not un-finished.
  //
  // In chunks: a day's failures have no cap, and D1 refuses more than 100
  // parameters in one statement — which would fail the whole claim, and
  // with it the re-dispatch. Each row's claim stands alone (it re-checks
  // its own status), so the chunks need not land together.
  await Promise.all(
    chunked(failedIds, IN_LIST_CHUNK).map((chunk) =>
      db
        .update(products)
        .set({ extractionStatus: "pending" })
        .where(
          and(
            inArray(products.id, chunk),
            eq(products.extractionStatus, "failed"),
          ),
        ),
    ),
  );
  const stalled = [...pending, ...failedIds.map((id) => ({ id }))];
  // fallow-ignore-next-line code-duplication -- the third caller of redispatchEach, beside imports and revocations: the loop is extracted, and what rhymes is the call, which names a different table, queue and sentence
  await redispatchEach(anomalies, stalled, {
    queue: env.ENRICHMENT_QUEUE,
    message: (row) => ({ type: "enrich", productId: row.id }),
    errorContext: (row) => ({
      surface: "enrichment-redispatch",
      productId: row.id,
    }),
    describe: (count) =>
      `${String(count)} product(s) unfinished by enrichment and were re-dispatched`,
  });
}

/**
 * What the digest checks, one kind per line of the report.
 *
 * **The kind is what Sentry groups by** (OPS-2, audit finding 0.5). Every
 * digest used to be one `Error("daily digest anomalies")`, so every day
 * folded into the first day's issue, and Sentry's default alert — new
 * issues only — never fired again. Each kind now sends its own event,
 * fingerprinted by kind *and day*, so a new day is a new issue, and tagged
 * so an alert rule can match every digest event by tag whatever it groups
 * into. The rule itself is a deployment step (deployment plan §5).
 */
export const digestKinds = [
  "weather-backlog",
  "extraction-yield",
  "abandoned-enrichment",
  "strava-revocation",
  "outbox",
  "stalled-import",
  "review-queue",
] as const;

export type DigestKind = (typeof digestKinds)[number];

/**
 * The event for one kind on one day. The day is the digest's UTC date,
 * which is the unit a person reads it in: one issue per kind per morning.
 */
export function digestReport(
  kind: DigestKind,
  lines: readonly string[],
  day: string,
): SentryReport {
  return {
    context: { kind, anomalies: lines.join("; ") },
    tags: { digest: "daily", digest_kind: kind },
    fingerprint: ["daily-digest", kind, day],
  };
}

/**
 * Exception-based alerting: checks run, thresholds compare, and ONLY
 * anomalies get surfaced — one Sentry event per kind that found any.
 */
async function runDailyDigest(reporter: CronReporter): Promise<string[]> {
  const db = drizzle(env.DIALED_CORE);
  // The generic outbox rides the same firing as the Strava one: drain
  // first, so the backlog check counts only what is still owed.
  // Keyed by kind and walked in `digestKinds` order, so the table cannot
  // name a kind the list does not, nor leave one out: the compiler holds
  // the keys to the union, and a missing entry is a call to `undefined`.
  const checks: Readonly<
    Record<DigestKind, (anomalies: string[]) => Promise<void>>
  > = {
    "weather-backlog": checkWeatherBacklog,
    "extraction-yield": checkExtractionYield,
    "abandoned-enrichment": checkAbandonedEnrichments,
    "strava-revocation": redispatchStrandedRevocations,
    outbox: async (anomalies) => {
      await drainOutbox(db, anomalies);
      await checkOutboxBacklog(db, anomalies);
    },
    "stalled-import": redispatchStalledImports,
    "review-queue": checkReviewQueueDepth,
  };
  // Threshold checks fill in as their features land:
  // - failed-import rate (lane 102)
  // - stale cron_checkpoints rows
  const day = new Date(nowSeconds() * 1000).toISOString().slice(0, 10);
  const everything: string[] = [];
  for (const kind of digestKinds) {
    const lines: string[] = [];
    await checks[kind](lines);
    if (lines.length === 0) continue;
    reporter.report(
      new Error(`daily digest: ${kind}`),
      digestReport(kind, lines, day),
    );
    everything.push(...lines);
  }
  return everything;
}

/**
 * Products enrichment finished without a composition.
 *
 * **The outcome metric, and the only honest one available.** Composition
 * comes from a model reading a page, and there are three reasons it can
 * come back empty: the page genuinely states none (Smartwool's base layer
 * is client-rendered and says nothing in the HTML we fetch), the model was
 * shown the page but not the part with the answer (the prompt budget is a
 * cap, and Arc'teryx's Alpha SV sat past the old one), or the model read it
 * and missed. The row cannot tell those apart — and none of them is an
 * *error*, so nothing would otherwise be reported.
 *
 * What makes the count worth watching is its slope rather than its value.
 * Some proportion of pages will always state nothing. A jump means
 * something changed that nobody changed on purpose: a budget that stopped
 * reaching the spec, a model that got worse, a platform that moved its
 * markup.
 *
 * Reported as a share, because the absolute number grows with the
 * catalogue and would read as a problem when it is just use — and only
 * past a **deliberately loose** bound, because this digest surfaces
 * anomalies and nothing else. A line that appears every day is a metric,
 * and a metric in an alert channel is how an alert channel gets ignored.
 *
 * Half is not a tuned number and should not pretend to be: the true
 * baseline is unknown until production has some, and on the eval corpus it
 * would be about one page in twenty-two. What can be said without data is
 * that *most* products having no composition means something is broken,
 * because the same corpus says most pages state one. Tighten it when there
 * is a real baseline to tighten against.
 */
const EMPTY_COMPOSITION_ALERT = 50;

async function checkExtractionYield(anomalies: string[]): Promise<void> {
  const db = drizzle(env.DIALED_CORE);
  const done = await db
    .select({ composition: products.fabricComposition })
    .from(products)
    .where(eq(products.extractionStatus, "done"))
    .limit(1000);
  if (done.length === 0) return;

  const empty = done.filter((row) => row.composition === null).length;
  const share = Math.round((empty / done.length) * 100);
  if (share < EMPTY_COMPOSITION_ALERT) return;
  anomalies.push(
    `${String(empty)} of ${String(done.length)} enriched product(s) have no composition (${String(share)}%)`,
  );
}

/**
 * Products enrichment gave up on: `failed`, and past the day the hourly
 * sweep spends re-driving them (law 6 — a terminal failure lands somewhere
 * a human sees). Until there is an admin surface for dead-lettered work,
 * this line and the Sentry event behind it are that somewhere.
 */
async function checkAbandonedEnrichments(anomalies: string[]): Promise<void> {
  // `columnWhere` rather than the select chain the weather check writes
  // out: the ids are what the covering index carries, and the two checks
  // are different backlogs that should not read as one clone.
  const failedPastTheWindow = and(
    eq(products.extractionStatus, "failed"),
    lt(products.createdAt, abandonedBefore()),
  );
  const abandoned = await columnWhere(
    drizzle(env.DIALED_CORE),
    products,
    products.id,
    failedPastTheWindow,
  );
  if (abandoned.length === 0) return;
  anomalies.push(
    `${String(abandoned.length)} product(s) abandoned by enrichment: failed, and past the sweep's day of retries`,
  );
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
