import type { EmailPayload } from "../../lib/email";
import type { OutboxMessage } from "../../lib/outbox";

/**
 * An email owed, as an outbox message (law 8c): pass it to ops'
 * `oweOutbox`, put `outboxInsert` in the same `db.batch()` as the event it
 * tells someone about, and — unless it is held back — `settleOutbox` it
 * afterwards as the fast path. The drain retries whatever that misses.
 *
 * `dedupeKey` names "the same email": a second debt with it replaces the
 * first rather than sending twice (a reminder per runner per day, say).
 * `notBefore` holds it until then, in epoch seconds.
 */
export function emailDebt(
  payload: EmailPayload,
  options: Readonly<{ dedupeKey: string; notBefore?: number | undefined }>,
): OutboxMessage {
  return {
    kind: "email",
    payload: {
      dedupeKey: options.dedupeKey,
      ...(options.notBefore !== undefined && { notBefore: options.notBefore }),
      email: payload,
    },
  };
}
