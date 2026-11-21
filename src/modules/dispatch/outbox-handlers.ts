/**
 * The outbox's full registry, for the drains (design 256). Each kind's
 * handler lives with what it touches, and the dispatch is the one module
 * that may import all of them: nothing imports it but the Worker entry.
 * Typed as every kind's, so a kind added to the outbox and not given a
 * handler here does not compile.
 */
import { productLinkHandler, type ProductLinker } from "../closet";
import { storageHandlers, type OutboxHandlers } from "../ops/outbox";
import { owedEmailHandlers } from "../ops/owed-email";
import { manualConditionsHandler } from "../weather";

/**
 * Every kind's handler, with the product link bound to `link` (the
 * firing's own, `DailyUpkeep["linkProducts"]`).
 */
export function outboxHandlers(
  link: ProductLinker | undefined,
): OutboxHandlers {
  return {
    ...storageHandlers,
    // Task 126 (ACC-2) and design 232: a runner's email, and the operators'.
    ...owedEmailHandlers,
    // Design 133 (D-113 Q1): `closet`'s linker, run by the drains alone.
    product_link: productLinkHandler(link),
    // C1: a deleted run's band, in the weather database.
    manual_conditions_delete: manualConditionsHandler,
  };
}
