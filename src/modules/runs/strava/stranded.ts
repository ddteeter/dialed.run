import { stravaRevocations } from "../../../db/schema-core";
import { redispatchEach, type Reporter } from "../../../lib/sql/queue-batch";
import { coreDb } from "../core-db";
import type { RevokeJob } from "../queue-messages";
import type { RevokeQueueProducer } from "./oauth";

/**
 * The durable half of the disconnect flow.
 *
 * Disconnecting writes a `strava_revocations` row in the same batch as the
 * delete, then dispatches to the queue as a fast path. If that dispatch
 * failed — or the message was lost — the row is still here, and nothing
 * else would ever look at it. This is what makes the outbox an actual
 * guarantee rather than a record of good intentions.
 *
 * Re-dispatch rather than revoke inline: the consumer already owns that
 * path, including deleting the row on success. The daily digest runs it
 * (`dispatch`, design 258 proposal 6).
 */
export async function redispatchStrandedRevocations(
  anomalies: string[],
  queue: RevokeQueueProducer,
  report: Reporter["captureException"],
): Promise<void> {
  const db = coreDb();
  const stranded = await db
    .select({ id: stravaRevocations.id })
    .from(stravaRevocations)
    .limit(100);
  await redispatchEach(anomalies, stranded, {
    queue,
    captureException: report,
    message: (row): RevokeJob => ({
      type: "strava_revoke",
      revocationId: row.id,
    }),
    errorContext: (row) => ({
      surface: "revocation-redispatch",
      revocationId: row.id,
    }),
    describe: (count) =>
      `${String(count)} Strava revocation(s) awaited re-dispatch`,
  });
}
