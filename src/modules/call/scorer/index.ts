/**
 * The door of `call/scorer`: the Call's pure core (design 194; design
 * sprint-a1). A route's loader, the call log and the replay harness reach
 * the scorer through these names and no others.
 */
export { COHORT_MIN_RUNNERS } from "./floor";
export { SCORER_READS } from "./reads";
export { score } from "./score";
export { ENGINE_VERSION } from "./version";
export { workedRange } from "./worked-range";
