import { drizzle } from "drizzle-orm/d1";

import { env } from "../../env";
import { handleImportsBatch, handleImportsDlqBatch } from "../runs";
import { captureException } from "./sentry";

/**
 * Queue consumer entry. Phase 0 stubs (000 §10): lane 102 owns the
 * dialed-imports consumer + DLQ user-notification; lane 107 owns
 * dialed-enrichment. Redelivery-safe by construction: stubs only log.
 */
export async function handleQueueBatch(
  batch: MessageBatch,
): Promise<void> {
  switch (batch.queue) {
    case "dialed-imports": {
      await handleImportsBatch(batch, {
        db: drizzle(env.DIALED_CORE),
        photos: env.PHOTOS,
        captureException,
      });
      break;
    }
    case "dialed-enrichment": {
      // Lane 107 replaces this stub with the extraction ladder consumer.
      console.warn("[queue-stub] dialed-enrichment not implemented; acking", {
        size: batch.messages.length,
      });
      break;
    }
    case "dialed-imports-dlq": {
      await handleImportsDlqBatch(batch, {
        db: drizzle(env.DIALED_CORE),
        photos: env.PHOTOS,
        captureException,
      });
      break;
    }
    case "dialed-enrichment-dlq": {
      // Law 6: a dead-lettered job must land where a human sees it.
      // Lane 107 adds the user-facing failure; Sentry covers system-side.
      for (const message of batch.messages) {
        captureException(new Error(`dead-lettered job on ${batch.queue}`), {
          queue: batch.queue,
          messageId: message.id,
        });
      }
      break;
    }
    default: {
      captureException(new Error("batch from unknown queue"), {
        queue: batch.queue,
      });
    }
  }
}
