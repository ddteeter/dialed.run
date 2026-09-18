import { isNotNull } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { products } from "../../db/schema-core";
import { didClaim } from "../../lib/claim";
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
 */
export async function requestEnrichment(
  db: Db,
  productId: string,
  deps: RequestDeps,
): Promise<RequestOutcome> {
  const wasClaimed = await didClaim(
    db,
    products,
    { id: products.id, status: products.extractionStatus },
    productId,
    ["none", "failed"],
    { extractionStatus: "pending" },
    isNotNull(products.sourceUrl),
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
