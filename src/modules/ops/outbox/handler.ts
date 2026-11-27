/**
 * What a handler is: the work one outbox kind owes, run when it is
 * drained or as a fast path straight after the write that owed it.
 * Each kind's handler lives with what it touches (design 256); the
 * dispatch assembles the full registry for the drains.
 *
 * Every handler is idempotent (law 1): a row is at-least-once, so a run
 * that half-finished, or finished and failed to delete its row, is simply
 * run again.
 */
import type { drizzle } from "drizzle-orm/d1";

import type {
  OutboxHandlers,
  OutboxKind,
  PayloadOf,
} from "../../../lib/sql/outbox";

export type {
  OutboxHandler,
  OutboxHandlers,
  PayloadOf,
} from "../../../lib/sql/outbox";

type Db = ReturnType<typeof drizzle>;

/**
 * What a handler's run answers when it did part of the work and owes the
 * rest (design 232). Anything else it resolves to means done. A symbol,
 * so no other value a handler resolves to can be mistaken for it.
 */
export const OWED_AGAIN: unique symbol = Symbol();

/**
 * What a handler's run answers when the far side refused the work for a
 * reason this row carries with it, so no retry of the same row is likely
 * to go differently (SA-L22, design 244): an email whose address the
 * sender will not send to. The row is not settled and nothing failed in
 * the app; the drain decides how long such a row is kept. `reason` is the
 * far side's own code, never anything of the payload's (law 7).
 */
export class Refused {
  constructor(readonly reason: string) {}
}

/**
A message's work, bound to the handler that does it.
*/
export interface BoundHandler {
  readonly run: (db: Db, rowId: string) => Promise<unknown>;
  readonly context: () => Record<string, string>;
}

/**
 * One message, bound to its kind's handler in `handlers`: the full
 * registry for a drain, or a fast path's map of the kinds it owes.
 *
 * Generic over the kind so the compiler can see that a message's payload
 * is its own handler's: indexing the map with a message of the whole
 * union reads every handler's payload type at once, and no payload is all
 * of them.
 */
export function boundHandler<K extends OutboxKind>(
  handlers: Pick<OutboxHandlers, K>,
  message: { readonly kind: K; readonly payload: PayloadOf<K> },
): BoundHandler {
  const handler = handlers[message.kind];
  return {
    run: (db, rowId) => handler.run(db, message.payload, rowId),
    context: () => handler.context(message.payload),
  };
}
