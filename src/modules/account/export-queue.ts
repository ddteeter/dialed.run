/**
 * The `dialed-exports` queue (task 126, ACC-10; decision D-86): its wire
 * format, and the consumer and dead-letter consumer the Worker entry hands
 * to ops' queue router.
 *
 * Its own queue, not a variant on `dialed-imports`: one ZIP build is a
 * delivery of its own (`max_batch_size: 1`), and a long one never holds up
 * a run file's parse. Queue bodies are a trust boundary, so both consumers
 * parse with the schema below, never cast.
 */
import { z } from "zod";

import { consumeEach, deadLetterEach } from "../../lib/queue-batch";
import type { ExportConsumers } from "../ops";

type Report = (error: unknown, context: Record<string, string>) => void;

/**
 * Every job on `dialed-exports`. One variant today: a pointer to the
 * `data_exports` row, which holds everything else — the row is the claim
 * and the source of truth, so a duplicate delivery claims nothing and a
 * lost one is re-sent by the hourly sweep. A new job is a new variant
 * (law 9), never a reshape of this one.
 */
export const exportsQueueMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("account_export"),
    exportId: z.string().min(1),
  }),
]);

export type ExportJob = z.infer<typeof exportsQueueMessageSchema>;

/**
 * What an `account_export` job needs done: build the ZIP and email it, or
 * — from the DLQ, once retries are spent — mark the export failed so the
 * runner is told (law 6).
 */
export interface ExportWork {
  readonly build: (exportId: string) => Promise<void>;
  readonly fail: (exportId: string) => Promise<void>;
}

/**
Sentry's context for a job that threw: the export it was building.
*/
function jobContext(job: ExportJob): Record<string, string> {
  return { exportId: job.exportId };
}

/**
 * Both consumers over `work`: a job that throws is retried (law 3), a
 * body the schema rejects is acked and reported, and a dead letter marks
 * its export failed (`failExport` tells Sentry the ids) and is reported
 * with the queue and message.
 */
export function exportConsumers(
  work: ExportWork,
  report: Report,
): ExportConsumers {
  return {
    batch: (batch) =>
      consumeEach(batch, exportsQueueMessageSchema, {
        process: (job) => work.build(job.exportId),
        invalidMessage: "invalid exports queue message",
        context: jobContext,
        captureException: report,
      }),
    deadLetters: (batch) =>
      deadLetterEach(batch, exportsQueueMessageSchema, {
        onJob: (job) => work.fail(job.exportId),
        deadLettered: "dead-lettered dialed-exports message",
        captureException: report,
      }),
  };
}
