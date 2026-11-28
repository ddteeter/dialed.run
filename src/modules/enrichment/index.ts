/**
 * Public API for the enrichment module. The rungs, the ladder and the
 * fetch are internal; what other modules need is to ask for enrichment, to
 * consume the queue, and to re-run extraction over a stored page.
 */
export { isSweepOwed, listAbandonedEnrichments } from "./abandon";
export {
  handleEnrichmentBatch,
  handleEnrichmentDlqBatch,
  reextract,
} from "./consume";
export { enqueueEnrichment } from "./enqueue";
// The hourly sweep and the digest's two checks, which `dispatch` runs
// (design 258 proposal 5).
export {
  checkAbandonedEnrichments,
  checkExtractionYield,
  redispatchStalledEnrichments,
} from "./sweep";
export { extractionModelFromEnv } from "./model/from-env";
export { retryFailedEnrichment } from "./request";
