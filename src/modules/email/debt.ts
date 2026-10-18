import type { EmailPayload } from "../../lib/contracts/email";
import type { OutboxMessage, ReminderEmailRef } from "../../lib/sql/outbox";

/**
 * An email owed, as an outbox message (law 8c): pass it to ops'
 * `oweOutbox`, put `outboxInsert` in the same `db.batch()` as the event it
 * tells someone about, and — unless it is held back — `settleOutbox` it
 * afterwards as the fast path. The drain retries whatever that misses.
 *
 * `dedupeKey` names "the same email": a second debt with it is the same
 * outbox row rather than a second send (a reminder per runner per day,
 * say). It takes the row over — its id and when it is due — and the
 * first debt's payload stays.
 * To hold it back, pass `notBefore` to `oweOutbox` alongside it.
 * `reminder` marks a Strava reminder's email (design 140), checked and
 * marked when it is sent.
 */
export function emailDebt(
  payload: EmailPayload,
  options: Readonly<{ dedupeKey: string; reminder?: ReminderEmailRef }>,
): OutboxMessage {
  return {
    kind: "email",
    payload: {
      dedupeKey: options.dedupeKey,
      email: payload,
      ...(options.reminder !== undefined && { reminder: options.reminder }),
    },
  };
}
