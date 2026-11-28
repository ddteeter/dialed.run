/**
 * The writes every job that can give up makes to `gave_up` (design 261,
 * B12): record that it gave up, forget it once a later try succeeds, and
 * wire a dead-letter queue to both. A floor unit, so any module may import
 * it; it imports no feature module.
 */
export {
  DEAD_LETTER_REASON,
  dlqBatchHandler,
  gaveUpClear,
  gaveUpClearBefore,
  gaveUpClearPrefix,
  gaveUpUpsert,
  shortRawError,
  type GaveUpFact,
} from "./gave-up";
