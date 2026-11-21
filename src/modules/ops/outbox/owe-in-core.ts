import type { SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import { coreDb } from "../../../env";
import type { OutboxMessage } from "../../../lib/sql/outbox";
import { outboxInsert, outboxInsertWhere, oweOutbox } from "./outbox";

/**
 * An outbox row for a module's batch that `ops` imports, and so cannot be
 * imported by: the imports consumer's (task 126, the Strava
 * deauthorization's email) and safety's reports (design 136, the removal
 * alert). Handed in rather than imported there.
 */
export function oweInCore(message: OutboxMessage, notBefore?: number) {
  return outboxInsert(coreDb(), oweOutbox(message, notBefore));
}

/**
 * `oweInCore`, owed once for each row of `from.table` that `from.where`
 * matches as the statement runs (`outboxInsertWhere`): for safety's
 * removal requests, whose alerts and receipt land only as the request's
 * own row says.
 */
export function oweInCoreWhere(
  message: OutboxMessage,
  from: Readonly<{ table: SQLiteTable; where: SQL }>,
) {
  return outboxInsertWhere(coreDb(), oweOutbox(message), from);
}
