import { coreDb, env } from "../../env";
import { handleEnrichmentBatch, handleEnrichmentDlqBatch } from "../enrichment";
import { runnerTimeZone } from "../onboarding";
import {
  handleImportsBatch,
  handleImportsDlqBatch,
  stravaApiFromEnv,
} from "../runs";
import { attachObservation } from "../weather";
import {
  enrichmentDeps,
  queueRegistry,
  type ExportConsumers,
} from "../ops/desk";
import { oweInCore } from "../ops/outbox";
import { captureException } from "../ops/sentry";

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
        db: coreDb(),
        importBucket: env.IMPORTS,
        captureException,
        stravaApi: stravaApiFromEnv(),
        owe: oweInCore,
        runnerTimeZone: (userId) => runnerTimeZone(coreDb(), userId),
        attachObservation,
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
          db: coreDb(),
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
