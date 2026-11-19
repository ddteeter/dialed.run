import { coreDb } from "../../../env";
import type { OutboxMessage } from "../../../lib/sql/outbox";
import { outboxInsert, oweOutbox } from "./outbox";

/**
 * An outbox row for a module's batch that `ops` imports, and so cannot be
 * imported by: the imports consumer's (task 126, the Strava
 * deauthorization's email) and safety's reports (design 136, the removal
 * alert). Handed in rather than imported there.
 */
export function oweInCore(message: OutboxMessage, notBefore?: number) {
  return outboxInsert(coreDb(), oweOutbox(message, notBefore));
}
