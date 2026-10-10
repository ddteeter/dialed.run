import { drizzle } from "drizzle-orm/d1";

import { env } from "../../env";
import type { OutboxMessage } from "../../lib/sql/outbox";
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
import { outboxInsert, oweOutbox } from "./outbox";
import { captureException } from "./sentry";

/**
 * Work queues this worker consumes, and the dead-letter queue each one
 * retires to. Same contract as the cron registry: test/crons.test.ts
 * asserts these against wrangler.jsonc, because a consumer the config
 * never binds is a queue that silently fills up and is never drained.
 */
export const queueRegistry = [
  {
    queue: "dialed-imports",
    deadLetterQueue: "dialed-imports-dlq",
    maxRetries: 3,
  },
  {
    queue: "dialed-enrichment",
    deadLetterQueue: "dialed-enrichment-dlq",
    maxRetries: 3,
  },
  // Task 126's data export (ACC-10; decision D-86): one ZIP a delivery,
  // on its own queue so a long build never holds up a run file's parse.
  {
    queue: "dialed-exports",
    deadLetterQueue: "dialed-exports-dlq",
    maxRetries: 3,
  },
] as const;

/**
 * How many times a queue delivered a job before dead-lettering it: the
 * first delivery and its `max_retries` (Cloudflare: "retry delivery three
 * times before marking the delivery as failed"). The Desk's Gave up row
 * shows it as the job's tries.
 */
function deliveries(entry: { readonly maxRetries: number }): number {
  return entry.maxRetries + 1;
}

const [IMPORTS, ENRICHMENT] = queueRegistry;

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
export function enrichmentDeps() {
  return {
    db: drizzle(env.DIALED_CORE),
    captureException,
    proxyApiKey: env.FIRECRAWL_API_KEY,
    model: extractionModelFromEnv(),
  };
}

/**
 * An outbox row for the imports consumer's batches (task 126: the Strava
 * deauthorization's email). Handed in rather than imported there: `runs`
 * is imported by this module, so it cannot import `ops` back.
 */
function oweInCore(message: OutboxMessage, notBefore?: number) {
  return outboxInsert(drizzle(env.DIALED_CORE), oweOutbox(message, notBefore));
}

/**
 * The `dialed-exports` consumer and its DLQ's (task 126, ACC-10). Both are
 * `account`'s, which `ops` cannot import without a cycle, so the Worker
 * entry hands them in, as it hands the purge to `handleScheduled`.
 */
export interface ExportConsumers {
  readonly batch: (batch: MessageBatch) => Promise<void>;
  readonly deadLetters: (batch: MessageBatch) => Promise<void>;
}

/**
 * The export consumers the Worker entry handed in, or a loud failure: a
 * batch retried is reported and redelivered, and a wiring slip dead-letters
 * where a human sees it rather than acking a runner's export into nothing.
 */
function exportConsumers(exports: ExportConsumers | undefined) {
  if (exports === undefined) {
    throw new Error("dialed-exports batch with no export consumers wired");
  }
  return exports;
}

/**
 * Queue consumer entry (000 §10): lane 102 owns the dialed-imports consumer
 * + DLQ user-notification; lane 107 owns dialed-enrichment; lane 126 owns
 * dialed-exports, handed in as `exports`. Every consumer acks or retries
 * per message, so one bad message never blocks a batch.
 */
export async function handleQueueBatch(
  batch: MessageBatch,
  exports?: ExportConsumers,
): Promise<void> {
  switch (batch.queue) {
    case "dialed-imports": {
      await handleImportsBatch(batch, {
        db: drizzle(env.DIALED_CORE),
        importBucket: env.IMPORTS,
        captureException,
        stravaApi: stravaApiFromEnv(),
        owe: oweInCore,
      });
      break;
    }
    case "dialed-enrichment": {
      await handleEnrichmentBatch(batch, enrichmentDeps());
      break;
    }
    case "dialed-imports-dlq": {
      await handleImportsDlqBatch(
        batch,
        {
          db: drizzle(env.DIALED_CORE),
          importBucket: env.IMPORTS,
          captureException,
          owe: oweInCore,
        },
        deliveries(IMPORTS),
      );
      break;
    }
    case "dialed-enrichment-dlq": {
      await handleEnrichmentDlqBatch(
        batch,
        enrichmentDeps(),
        deliveries(ENRICHMENT),
      );
      break;
    }
    case "dialed-exports": {
      await exportConsumers(exports).batch(batch);
      break;
    }
    case "dialed-exports-dlq": {
      await exportConsumers(exports).deadLetters(batch);
      break;
    }
    default: {
      captureException(new Error("batch from unknown queue"), {
        queue: batch.queue,
      });
    }
  }
}
