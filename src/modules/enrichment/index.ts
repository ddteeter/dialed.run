/**
 * Public API for the enrichment module. The rungs, the ladder and the
 * fetch are internal; what other modules need is to ask for enrichment, to
 * consume the queue, and to re-run extraction over a stored page.
 */
export {
  abandonedBefore,
  ENRICHMENT_SWEEP_TRIES,
  extractionDone,
  extractionFailed,
  extractionPending,
  listAbandonedEnrichments,
} from "./abandon";
export {
  handleEnrichmentBatch,
  handleEnrichmentDlqBatch,
  reextract,
  type EnrichmentDeps,
} from "./consume";
export { enqueueEnrichment } from "./enqueue";
export { forgetRunnerEnrichmentLimit } from "./spend-limit";
export { extractionModelFromEnv } from "./model/from-env";
export { type EnrichJob } from "./queue-messages";
export {
  requestEnrichment,
  retryFailedEnrichment,
  type RequestDeps,
  type RequestOutcome,
} from "./request";
