/**
 * The enrichment sweep (design 258 proposal 5): the hourly re-drive of
 * products enrichment has not finished, and the two digest checks on what
 * it finished and what it gave up on. `dispatch` decides when each runs
 * and hands in the queue and the reporter; what each does is this
 * module's, since it is the one that writes a product's extraction
 * columns.
 */
import { and, desc, eq, inArray, lt, sql, type SQL } from "drizzle-orm";

import { products } from "../../db/schema-core";
import { coreDb } from "../../env";
import { chunked, IN_LIST_CHUNK } from "../../lib/chunked";
import { nowSeconds } from "../../lib/now";
import { columnWhere, stalledPending } from "../../lib/sql/keyed-read";
import { redispatchEach } from "../../lib/sql/queue-batch";
import {
  abandonedBefore,
  extractionDone,
  extractionFailed,
  extractionPending,
  sweepOwed,
} from "./abandon";
import type { EnrichJob } from "./queue-messages";
import type { RequestDeps } from "./request";

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
 * the row is *abandoned*, which the daily digest reports and the Desk's
 * Gave up lists (law 6), and a
 * fresh paste of the same URL is what claims it again.
 *
 * **And the re-drive is a claim, not just a send.** The consumer treats
 * only `pending` as work, so re-dispatching a `failed` row without
 * flipping it was a message the consumer acked and ignored — the anomaly
 * line said "re-dispatched" and nothing happened. Flipped in SQL before the
 * send (law 2): a send that then fails leaves the row `pending`, which the
 * next sweep picks up on its own.
 *
 * So: `failed` past the grace window, and owed a retry (`sweepOwed`:
 * inside the product's first day and under the try cap), the rule the
 * closet's link line reads too (#881). The day itself is
 * `abandonedBefore`, because the consumer reads it too, to know whether a
 * failure is one the sweep will retry or one to list on the Desk's Gave up
 * (R-119).
 */
function failedAndOwed(): SQL | undefined {
  const staleBefore = nowSeconds() - ENRICHMENT_STALL_GRACE_S;
  return and(
    extractionFailed(),
    lt(products.createdAt, staleBefore),
    sweepOwed(),
  );
}

/**
The hourly re-drive: stalled `pending` products, and `failed` ones still owed a try.
*/
export async function redispatchStalledEnrichments(
  anomalies: string[],
  queue: RequestDeps["queue"],
  report: RequestDeps["captureException"],
): Promise<void> {
  // Two reads rather than one with an OR. The `pending` half is exactly
  // the question `stalledPending` already asks, and the `failed` half has
  // a bound it does not — so each is asked of the helper that fits, and
  // the failed half goes unlimited, since a day's failed pastes is small
  // where a stuck-pending backlog is not.
  const db = coreDb();
  const pending = await stalledPending(
    db,
    {
      table: products,
      id: products.id,
      pending: extractionPending(),
      createdAt: products.createdAt,
      // Drawn at random, so past a hundred waiting each firing takes a
      // random hundred, and a product may wait more than one firing.
      order: sql`random()`,
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
  // fallow-ignore-next-line code-duplication -- the third caller of redispatchEach, beside imports and revocations: the loop is extracted, and what rhymes is the call, which names a different table, queue and sentence
  const stalled = [...pending, ...failedIds.map((id) => ({ id }))];
  await redispatchEach(anomalies, stalled, {
    queue,
    captureException: report,
    message: (row): EnrichJob => ({ type: "enrich", productId: row.id }),
    errorContext: (row) => ({
      surface: "enrichment-redispatch",
      productId: row.id,
    }),
    describe: (count) =>
      `${String(count)} product(s) unfinished by enrichment and were re-dispatched`,
  });
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
 * So it measures **the most recent 1000** enriched products, by
 * `created_at`, newest first. Without the order it read whichever 1000
 * came back first, which was the oldest, and once the catalogue passed
 * 1000 the share stopped moving at all. The partial index
 * `products_extraction_done` serves the order, so the read walks about
 * 1000 index entries rather than scanning and sorting the table.
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

export async function checkExtractionYield(anomalies: string[]): Promise<void> {
  const db = coreDb();
  const done = await db
    .select({ composition: products.fabricComposition })
    .from(products)
    .where(extractionDone())
    .orderBy(desc(products.createdAt))
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
export async function checkAbandonedEnrichments(
  anomalies: string[],
): Promise<void> {
  // `columnWhere` rather than a select chain written out: the ids are
  // what the covering index carries, and this and the weather backlog
  // check are different backlogs that should not read as one clone.
  const failedPastTheWindow = and(
    extractionFailed(),
    lt(products.createdAt, abandonedBefore()),
  );
  const abandoned = await columnWhere(
    coreDb(),
    products,
    products.id,
    failedPastTheWindow,
  );
  if (abandoned.length === 0) return;
  anomalies.push(
    `${String(abandoned.length)} product(s) abandoned by enrichment: failed, and past the sweep's day of retries`,
  );
}
