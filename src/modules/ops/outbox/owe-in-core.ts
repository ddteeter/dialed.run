import type { SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import { coreDb } from "../../../env";
import type { OutboxMessage } from "../../../lib/sql/outbox";
import type { PayloadOf } from "./handler";
import {
  outboxInsert,
  outboxInsertWhere,
  oweOutbox,
  settleOutbox,
} from "./outbox";
import { storageHandlers } from "./storage-handlers";

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

/**
 * A run file's deletion for the imports consumer's batch, and the fast
 * path that pays it once the batch has landed (D-116). A delete that
 * fails is reported and left owed, for the daily drain.
 */
export function oweImportFileDeleteInCore(
  payload: PayloadOf<"import_file_delete">,
) {
  const debt = oweOutbox({ kind: "import_file_delete", payload });
  return {
    write: outboxInsert(coreDb(), debt),
    settle: () => settleOutbox(coreDb(), debt, storageHandlers),
  };
}
