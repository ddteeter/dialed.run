/**
 * The door of `call/replay`: the release check for every scorer version
 * (design 194, "Engine releases"), and the seeded histories it replays
 * over until real logged Calls exist.
 */
export {
  casesFrom,
  isReplayable,
  type ReplayCase,
  type ReplayHistory,
} from "./case";
export {
  noWorse,
  RELEASE_METRICS,
  type Comparison,
  type MetricComparison,
  type MetricVerdict,
  type ReleaseMetric,
} from "./compare";
export {
  measure,
  rate,
  type ConfidenceRow,
  type ConfidenceSplit,
  type DirectionShare,
  type ReplayMetrics,
  type Share,
} from "./metrics";
export { formatReport, type VersionMetrics } from "./report";
export { replay, type ReplayOutcome } from "./run";
export {
  dressFor,
  syntheticCloset,
  syntheticPersonas,
  type Persona,
} from "./synthetic";
