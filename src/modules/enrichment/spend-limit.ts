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
 * - proxy calls for one product, one a day, counted before the shared
 *   count below, so a product's later tries that day go direct only and
 *   spend nothing shared (owner, 2026-11-21). A product whose call the
 *   shared count refuses is given its count back;
 * - proxy calls across everyone, 150 a day, counted before each one. Over
 *   either, a refused page is a failed fetch, as it is with no proxy key;
 * - model calls across everyone, 200 an hour, counted before each one the
 *   consumer makes (owner, 2026-11-21). Over it the job stays `pending`
 *   for the hourly sweep, as it does when fetches are spent. The Desk's
 *   "Re-run extraction" is the operator's own press and is not counted.
 *
 * Each count is one upsert (`isWithinRateLimit`), so two requests at
 * once cannot both read the last one free; the daily sweep and the purge
 * treat them as they treat the send limits.
 */
import type { drizzle } from "drizzle-orm/d1";

import {
  GLOBAL_SUBJECT,
  type RateLimitKind,
} from "../../lib/contracts/rate-limits";
import { nowSeconds } from "../../lib/now";
import { forgetRateLimit, isWithinRateLimit } from "../email";

type Db = ReturnType<typeof drizzle>;

const HOUR_S = 60 * 60;
const DAY_S = 24 * HOUR_S;

export const ENRICHMENT_REQUESTS_PER_RUNNER_PER_DAY = 50;
export const PAGE_FETCHES_PER_HOUR = 200;
export const PROXY_CALLS_PER_DAY = 150;
export const PROXY_CALLS_PER_PRODUCT_PER_DAY = 1;
export const MODEL_CALLS_PER_HOUR = 200;

/**
 * A count with a subject of its own (a runner, a product): one more spent
 * at `now`, answering whether it was within `limit` for the window.
 */
function perSubject(kind: RateLimitKind, limit: number, windowS: number) {
  return (db: Db, subject: string, now = nowSeconds()): Promise<boolean> =>
    isWithinRateLimit(db, kind, subject, limit, windowS, now);
}

/**
A count across everyone, under `GLOBAL_SUBJECT`.
*/
function acrossEveryone(kind: RateLimitKind, limit: number, windowS: number) {
  const isWithinForSubject = perSubject(kind, limit, windowS);
  return (db: Db, now = nowSeconds()): Promise<boolean> =>
    isWithinForSubject(db, GLOBAL_SUBJECT, now);
}

/**
One runner's enrichment request today, if they have one left.
*/
export const canSpendRunnerRequest = perSubject(
  "enrich-runner",
  ENRICHMENT_REQUESTS_PER_RUNNER_PER_DAY,
  DAY_S,
);

/**
One page fetch this hour, if any is left.
*/
export const canSpendPageFetch = acrossEveryone(
  "page-fetch",
  PAGE_FETCHES_PER_HOUR,
  HOUR_S,
);

/**
One proxy call today, if any is left.
*/
export const canSpendProxyCall = acrossEveryone(
  "proxy-call",
  PROXY_CALLS_PER_DAY,
  DAY_S,
);

/**
One proxy call today for this product, if it has not had one.
*/
export const canSpendProductProxyCall = perSubject(
  "proxy-product",
  PROXY_CALLS_PER_PRODUCT_PER_DAY,
  DAY_S,
);

/**
 * The product's proxy count, forgotten: one statement, for a call the
 * shared count refused, so the product has not had its call.
 */
export function forgetProductProxyCall(db: Db, productId: string) {
  return forgetRateLimit(db, "proxy-product", productId);
}

/**
One model call this hour, if any is left.
*/
export const canSpendModelCall = acrossEveryone(
  "model-call",
  MODEL_CALLS_PER_HOUR,
  HOUR_S,
);

/**
A deleted account's id is not kept as a subject: one statement, for the purge.
*/
export function forgetRunnerEnrichmentLimit(db: Db, userId: string) {
  return forgetRateLimit(db, "enrich-runner", userId);
}
