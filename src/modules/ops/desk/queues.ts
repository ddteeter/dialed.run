import { coreDb, env } from "../../../env";
import { extractionModelFromEnv } from "../../enrichment";
import { isDeniedOnLanding } from "../../safety";
import { captureException } from "../sentry";

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
Every queue name the dispatch's handler switches on, DLQs included.
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
    db: coreDb(),
    captureException,
    proxyApiKey: env.FIRECRAWL_API_KEY,
    model: extractionModelFromEnv(),
    isLandingDenied: isDeniedOnLanding,
  };
}
