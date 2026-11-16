import { and, eq, isNotNull, lte, or, type SQL } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { products } from "../../db/schema-core";
import { nowSeconds } from "../../lib/now";
import { didClaim } from "../../lib/sql/claim";
import { abandonedBefore } from "./abandon";
import type { EnrichJob } from "./queue-messages";

type Db = ReturnType<typeof drizzle>;

export interface RequestDeps {
  /**
  The shape of `env.ENRICHMENT_QUEUE.send` and nothing more, so a test can
  hand in a spy without restating a queue's response type.
  */
  queue: { send: (message: EnrichJob) => Promise<unknown> };
  captureException: (error: unknown, context: Record<string, string>) => void;
}

/**
The work is now owed (`queued`), or nothing changed (`skipped`).
*/
export type RequestOutcome = "queued" | "skipped";

/**
 * Ask for a product to be enriched. Called from the paste path after the
 * product row exists.
 *
 * **Reconciliation, not a transaction** (law 8c). Nothing spans D1 and a
 * queue, so this is two steps in the order that fails safely: the row is
 * marked `pending` first — that column is the durable "this product owes an
 * extraction" — and the send is a fast path. A send that fails leaves a
 * `pending` row the hourly sweep re-dispatches; a send that succeeds
 * without the row having flipped is a message the consumer ignores. The
 * failure is reported and swallowed, because enrichment must never fail
 * the garment save that asked for it (law 5).
 *
 * The flip is the dedupe: only `none` and `failed` become `pending`, so a
 * second paste of the same URL while a job is in flight sends nothing, and
 * `done` is `reextract`'s business rather than a refetch.
 *
 * **A `failed` product only once its first day is over.** Inside the day
 * the hourly sweep owns its retry (`ENRICHMENT_RETRY_WINDOW_S`), so a
 * paste then would only fetch the same page again sooner. Past it, a paste
 * is what asks again. `isClaimable` is the same rule for a row in hand; a
 * test holds the two together. The Desk's Retry is `retryFailedEnrichment`.
 */
export async function requestEnrichment(
  db: Db,
  productId: string,
  deps: RequestDeps,
  now = nowSeconds(),
): Promise<RequestOutcome> {
  const neverTriedOrDayOver = or(
    eq(products.extractionStatus, "none"),
    lte(products.createdAt, abandonedBefore(now)),
  );
  return claimAndSend(db, productId, deps, neverTriedOrDayOver);
}

/**
 * The Desk's Retry (Operator Screens D6): an operator asked for this one,
 * so a `failed` product is claimed whatever its age.
 */
export async function retryFailedEnrichment(
  db: Db,
  productId: string,
  deps: RequestDeps,
): Promise<RequestOutcome> {
  return claimAndSend(db, productId, deps);
}

async function claimAndSend(
  db: Db,
  productId: string,
  deps: RequestDeps,
  also?: SQL,
): Promise<RequestOutcome> {
  const wasClaimed = await didClaim(
    db,
    products,
    { id: products.id, status: products.extractionStatus },
    productId,
    ["none", "failed"],
    { extractionStatus: "pending" },
    and(isNotNull(products.sourceUrl), also),
  );
  if (!wasClaimed) return "skipped";

  try {
    await deps.queue.send({ type: "enrich", productId });
  } catch (error) {
    deps.captureException(error, { surface: "enrichment-request", productId });
  }
  // Queued even when the send failed: the row is `pending`, which is the
  // durable half, and the hourly sweep sends what this could not.
  return "queued";
}

/**
 * Whether `requestEnrichment` would claim this product row: a link, and
 * either never tried or failed and past the sweep's day. For a caller
 * that must decide before claiming (the per-runner count is spent only on
 * a request that can go).
 */
export function isClaimable(
  product: Readonly<{
    sourceUrl: string | null;
    extractionStatus: string;
    createdAt: number;
  }>,
  now = nowSeconds(),
): boolean {
  if (product.sourceUrl === null) return false;
  if (product.extractionStatus === "none") return true;
  return (
    product.extractionStatus === "failed" &&
    product.createdAt <= abandonedBefore(now)
  );
}
