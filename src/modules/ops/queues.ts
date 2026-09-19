import { drizzle } from "drizzle-orm/d1";

import { env } from "../../env";
import {
  extractionModelFromEnv,
  handleEnrichmentBatch,
  handleEnrichmentDlqBatch,
} from "../enrichment";
import {
  handleImportsBatch,
  handleImportsDlqBatch,
  stravaApiFromEnv,
} from "../runs";
import { captureException } from "./sentry";

/**
 * Work queues this worker consumes, and the dead-letter queue each one
 * retires to. Same contract as the cron registry: test/crons.test.ts
 * asserts these against wrangler.jsonc, because a consumer the config
 * never binds is a queue that silently fills up and is never drained.
 */
export const queueRegistry = [
  { queue: "dialed-imports", deadLetterQueue: "dialed-imports-dlq" },
  { queue: "dialed-enrichment", deadLetterQueue: "dialed-enrichment-dlq" },
] as const;

/**
Every queue name the handler below switches on, DLQs included.
*/
export const consumedQueueNames: readonly string[] = queueRegistry.flatMap(
  (entry) => [entry.queue, entry.deadLetterQueue],
);

/**
The enrichment consumer's dependencies, read from bindings here and nowhere
inside the module — which is what keeps the module importable by a test.
*/
function enrichmentDeps() {
  return {
    db: drizzle(env.DIALED_CORE),
    captureException,
    proxyApiKey: env.FIRECRAWL_API_KEY,
    model: extractionModelFromEnv(),
  };
}

/**
 * Queue consumer entry (000 §10): lane 102 owns the dialed-imports consumer
 * + DLQ user-notification; lane 107 owns dialed-enrichment. Every consumer
 * acks or retries per message, so one bad message never blocks a batch.
 */
export async function handleQueueBatch(batch: MessageBatch): Promise<void> {
  switch (batch.queue) {
    case "dialed-imports": {
      await handleImportsBatch(batch, {
        db: drizzle(env.DIALED_CORE),
        importBucket: env.IMPORTS,
        captureException,
        stravaApi: stravaApiFromEnv(),
      });
      break;
    }
    case "dialed-enrichment": {
      await handleEnrichmentBatch(batch, enrichmentDeps());
      break;
    }
    case "dialed-imports-dlq": {
      await handleImportsDlqBatch(batch, {
        db: drizzle(env.DIALED_CORE),
        importBucket: env.IMPORTS,
        captureException,
      });
      break;
    }
    case "dialed-enrichment-dlq": {
      await handleEnrichmentDlqBatch(batch, enrichmentDeps());
      break;
    }
    default: {
      captureException(new Error("batch from unknown queue"), {
        queue: batch.queue,
      });
    }
  }
}
