import { and, eq, isNotNull, lt, sql, type SQL } from "drizzle-orm";
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
 * Here rather than in `ops`, which owns the sweep, because the consumer
 * reads it too: a failure inside the window is a try the sweep will make
 * again, not a job the system stopped retrying, and the Desk lists only
 * the second (Operator Screens D6; R-119).
 */
export const ENRICHMENT_RETRY_WINDOW_S = 24 * 60 * 60;

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
The instant (epoch seconds) before which a `failed` product is abandoned.
*/
export function abandonedBefore(now = nowSeconds()): number {
  return now - ENRICHMENT_RETRY_WINDOW_S;
}

/**
 * Put every product the sweep has stopped re-driving on the Desk's Gave
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
    .where(parked);
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
