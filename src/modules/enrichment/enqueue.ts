import type { drizzle } from "drizzle-orm/d1";

import { env } from "../../env";
import { isClaimable, requestEnrichment, type RequestOutcome } from "./request";
import type { RequestDeps } from "./request";
import { canSpendRunnerRequest } from "./spend-limit";

/**
 * `requestEnrichment` with this Worker's bindings, and the promise that it
 * cannot fail the thing that called it.
 *
 * The queue binding stops here rather than at the call site so that a paste
 * path in another module does not have to know what a queue is — and so
 * `request.ts` itself stays importable by a test without them.
 *
 * **The reporter is the caller's**, which is not squeamishness about
 * bindings: `modules/ops` imports this module to route the queue batch, so
 * reaching back into it for `captureException` is a cycle
 * (`ops -> enrichment -> ops`) and dependency-cruiser says so. Every other
 * dependency in this lane is injected for testability; this one is injected
 * because the graph requires it.
 *
 * **Never throws** (law 5). `requestEnrichment` already swallows a failed
 * send, because the row is the durable half; this also swallows a failed
 * *claim*, which is the remaining way a D1 hiccup could take a garment save
 * down with it. A failed send leaves the row `pending` for the
 * `enrichment-retry` cron to find; a failed claim leaves it as it was,
 * which no cron reads, so the next save that links the product asks again.
 *
 * **Counted against the runner who asked** (`spend-limit.ts`): only a
 * request that could claim the product is counted, so re-saving a garment
 * whose product is done or in flight spends nothing. Over the day's count
 * nothing is asked; the garment saves all the same.
 */
export async function enqueueEnrichment(
  db: ReturnType<typeof drizzle>,
  product: Parameters<typeof isClaimable>[0] & Readonly<{ id: string }>,
  requestedBy: string,
  captureException: RequestDeps["captureException"],
): Promise<RequestOutcome> {
  const productId = product.id;
  try {
    // In this order: a request that could not go is never counted.
    if (
      !isClaimable(product) ||
      !(await canSpendRunnerRequest(db, requestedBy))
    ) {
      return "skipped";
    }
    return await requestEnrichment(db, productId, {
      queue: env.ENRICHMENT_QUEUE,
      captureException,
    });
  } catch (error) {
    captureException(error, { surface: "enrichment-enqueue", productId });
    return "skipped";
  }
}
