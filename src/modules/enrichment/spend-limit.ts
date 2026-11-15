/**
 * The bounds on what enrichment spends: a page fetch, a proxy credit, a
 * model call and a stored snapshot are each paid for, so each has a
 * fixed-window count in `rate_limits` (owner, 2026-11-15):
 *
 * - one runner's enrichment requests, 50 a day, counted where a garment
 *   save asks for one (`closet`'s `productLinkFor`). Over it the garment
 *   still saves and links to its product, unenriched (law 5);
 * - page fetches across everyone, 200 an hour, counted in the consumer
 *   before a fetch. Over it the job stays `pending` for the hourly sweep;
 * - proxy calls across everyone, 150 a day, counted before each one. Over
 *   it a refused page is a failed fetch, as it is with no proxy key.
 *
 * Each count is one upsert (`isWithinRateLimit`), so two requests at
 * once cannot both read the last one free; the daily sweep and the purge
 * treat them as they treat the send limits.
 */
import type { drizzle } from "drizzle-orm/d1";

import { GLOBAL_SUBJECT } from "../../lib/contracts/rate-limits";
import { nowSeconds } from "../../lib/now";
import { forgetRateLimit, isWithinRateLimit } from "../email";

type Db = ReturnType<typeof drizzle>;

const HOUR_S = 60 * 60;
const DAY_S = 24 * HOUR_S;

export const ENRICHMENT_REQUESTS_PER_RUNNER_PER_DAY = 50;
export const PAGE_FETCHES_PER_HOUR = 200;
export const PROXY_CALLS_PER_DAY = 150;

/**
One runner's enrichment request today, if they have one left.
*/
export function canSpendRunnerRequest(
  db: Db,
  userId: string,
  now = nowSeconds(),
): Promise<boolean> {
  return isWithinRateLimit(
    db,
    "enrich-runner",
    userId,
    ENRICHMENT_REQUESTS_PER_RUNNER_PER_DAY,
    DAY_S,
    now,
  );
}

/**
One page fetch this hour, if any is left.
*/
export function canSpendPageFetch(
  db: Db,
  now = nowSeconds(),
): Promise<boolean> {
  return isWithinRateLimit(
    db,
    "page-fetch",
    GLOBAL_SUBJECT,
    PAGE_FETCHES_PER_HOUR,
    HOUR_S,
    now,
  );
}

/**
One proxy call today, if any is left.
*/
export function canSpendProxyCall(
  db: Db,
  now = nowSeconds(),
): Promise<boolean> {
  return isWithinRateLimit(
    db,
    "proxy-call",
    GLOBAL_SUBJECT,
    PROXY_CALLS_PER_DAY,
    DAY_S,
    now,
  );
}

/**
A deleted account's id is not kept as a subject: one statement, for the purge.
*/
export function forgetRunnerEnrichmentLimit(db: Db, userId: string) {
  return forgetRateLimit(db, "enrich-runner", userId);
}
