import { and, eq, gt, isNotNull, lt, sql, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import {
  DEAD_LETTER_REASON,
  gaveUpUpsert,
  type GaveUpFact,
} from "../../db/gave-up";
import { products } from "../../db/schema-core";
import { nowSeconds } from "../../lib/now";
import { pageFailureReason } from "./bounds";

/**
 * How long the hourly sweep re-drives a `failed` product: its first day
 * (PR #72 review). Past it the product is *abandoned* — the sweep stops,
 * the digest reports it, and the Desk's Gave up lists it.
 *
 * Here, beside the sweep (`sweep.ts`), and not in it, because the consumer
 * reads it too: a failure inside the window is a try the sweep will make
 * again, not a job the system stopped retrying, and the Desk lists only
 * the second (Operator Screens D6; R-119).
 */
export const ENRICHMENT_RETRY_WINDOW_S = 24 * 60 * 60;

/**
 * How many failed tries the sweep re-drives inside that day: a model
 * outage worth waiting out is over in a few hours, and every try at a
 * page that refuses us may be a proxy credit. Past it the product waits
 * out its day `failed`, and is listed on Gave up as before.
 */
export const ENRICHMENT_SWEEP_TRIES = 6;

/**
 * `extraction_status = 'failed'`, written as the partial index
 * `products_extraction_failed` writes it (`schema-core.ts`), for every
 * sweep that reads failed products by age.
 *
 * **A literal, not `eq`.** SQLite uses a partial index only when the
 * query's WHERE implies the index's condition. drizzle's `eq` binds
 * `'failed'` as a parameter, and that reaches the index only because
 * SQLite re-prepares a statement once its parameters are bound and
 * compares the bound value (measured in workerd's D1); a plan made before
 * binding scans every product. The literal does not lean on that, and it
 * is the shape `user_profiles_username_screen_pending`'s callers had to
 * use, where `inArray` could not match at all. The query-plan test in
 * `test/enrichment/abandon.test.ts` holds it.
 *
 * A function rather than a constant so nothing is built at module scope
 * (CLAUDE.md: construct on first use).
 */
export function extractionFailed(): SQL {
  return sql`${products.extractionStatus} = 'failed'`;
}

/**
 * `extraction_status = 'pending'`, as `products_extraction_pending` writes
 * it, for the hourly re-drive of products stuck waiting on the queue. A
 * literal for the reason `extractionFailed` gives.
 */
export function extractionPending(): SQL {
  return sql`${products.extractionStatus} = 'pending'`;
}

/**
 * `extraction_status = 'done'`, as `products_extraction_done` writes it,
 * for the digest's extraction yield over the most recent enrichments. A
 * literal for the reason `extractionFailed` gives.
 */
export function extractionDone(): SQL {
  return sql`${products.extractionStatus} = 'done'`;
}

/**
The instant (epoch seconds) before which a `failed` product is abandoned.
*/
export function abandonedBefore(now = nowSeconds()): number {
  return now - ENRICHMENT_RETRY_WINDOW_S;
}

/**
 * Whether the hourly sweep still owes a `failed` product a retry: inside
 * its first day **and** under the try cap (#881). The closet's link line
 * says "retrying" by this, and the sweep claims by `sweepOwed`, its SQL
 * twin; `test/enrichment/sweep-owed.test.ts` holds the two to one answer
 * for every row it tries. `tries` is absent until something fails, and
 * again once the product has been listed on Gave up.
 */
export function isSweepOwed(
  product: Readonly<{ createdAt: number; tries: number | undefined }>,
  now = nowSeconds(),
): boolean {
  return (
    product.createdAt > abandonedBefore(now) &&
    (product.tries ?? 0) < ENRICHMENT_SWEEP_TRIES
  );
}

/**
`isSweepOwed` as a WHERE clause over `products`, for the sweep's claim.
*/
export function sweepOwed(now = nowSeconds()): SQL | undefined {
  return and(
    gt(products.createdAt, abandonedBefore(now)),
    // A few tries, not one an hour all day: a page that keeps failing has
    // answered, and each try may be a proxy credit.
    sql`coalesce(${products.extractionTries}, 0) < ${ENRICHMENT_SWEEP_TRIES}`,
  );
}

/**
 * The most products one firing lists, oldest first. An hour's abandonments
 * are a handful; any left over are listed by the next firing, so one
 * firing's read stays small whatever is parked.
 */
export const ABANDONED_PER_FIRING = 100;

/**
 * Put each product the sweep has stopped re-driving (up to
 * `ABANDONED_PER_FIRING`) on the Desk's Gave
 * up, from the failure facts it kept while it was still being retried
 * (R-119), and clear them in the same batch — so each is listed once, and
 * a product the operator drops does not come back the next hour.
 *
 * The listing's guard is `extraction_tries IS NOT NULL`: only a product
 * whose failure has not been listed yet. A failure after abandonment —
 * an operator's Retry that fails again — is listed by the consumer at
 * once and never parks facts here.
 */
export async function listAbandonedEnrichments(
  db: DrizzleD1Database,
  now = nowSeconds(),
): Promise<void> {
  const parked = and(
    extractionFailed(),
    lt(products.createdAt, abandonedBefore(now)),
    isNotNull(products.extractionTries),
  );
  const owed = await db
    .select({
      id: products.id,
      error: products.extractionError,
      tries: products.extractionTries,
    })
    .from(products)
    .where(parked)
    .orderBy(products.createdAt)
    .limit(ABANDONED_PER_FIRING);
  // One batch per product, each its pair: an hour's abandonments are the
  // pastes that failed a day ago, a handful, and a pair that stands alone
  // cannot be sunk by another product's.
  for (const product of owed) {
    await listOne(db, product, parked, now);
  }
}

/**
 * One abandoned product onto the Desk's Gave up, and its parked facts
 * cleared, in one batch. The clear re-checks the listing's guard, so a
 * product that changed since the read keeps what it has.
 */
async function listOne(
  db: DrizzleD1Database,
  product: { id: string; error: string | null; tries: number | null },
  parked: SQL | undefined,
  now: number,
): Promise<void> {
  const error = product.error ?? undefined;
  const fact: GaveUpFact = {
    kind: "enrichment",
    subjectId: product.id,
    reason: error === undefined ? DEAD_LETTER_REASON : pageFailureReason(error),
    rawError: error,
    tries: Number(product.tries),
  };
  const stillParked = and(eq(products.id, product.id), parked);
  await db.batch([
    gaveUpUpsert(db, fact, now),
    db
      .update(products)
      .set({ extractionError: sql`NULL`, extractionTries: sql`NULL` })
      .where(stillParked),
  ]);
}
