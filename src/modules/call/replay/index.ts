/**
 * The door of `call/replay`: the release check for every scorer version
 * (design 194, "Engine releases"), and the seeded histories it replays
 * over until real logged Calls exist.
 */
export {
  casesFrom,
  isCaseRun,
  type CaseOrigin,
  type ConditionRead,
  type ReplayCase,
  type ReplayHistory,
} from "./case";
export {
  noWorse,
  RELEASE_METRICS,
  sourceOf,
  type Comparison,
  type ReleaseOptions,
  type ReplaySource,
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
export { formatReport, type ReplayReport, type VersionMetrics } from "./report";
export { replay, type ReplayOutcome } from "./run";
export {
  dressFor,
  syntheticCloset,
  syntheticPersonas,
  type Persona,
} from "./synthetic";
