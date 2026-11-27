/**
 * What a scorer actually reads from the forecast, found by asking it: each
 * case is replayed once more with one field moved far out of its range,
 * and a field whose move changes any result is one the scorer reads. The
 * release check holds that against the scorer's declaration, so an
 * undeclared read cannot slip past the rebuilt-forecast guard.
 */
import type { Scorer } from "../contract";
import type { ConditionRead, ReplayCase } from "./case";

/**
 * Every forecast field, in the order a report names them. Pinned to
 * `PROBE`'s keys by a test.
 */
export const CONDITION_READS = [
  "tempC",
  "feelsLikeC",
  "precipMm",
  "windKph",
] as const satisfies readonly ConditionRead[];

/**
 * Where each field is moved to: outside anything a run sees, so a scorer
 * that reads the field answers differently. A record, so the compiler
 * fails here if the forecast gains or loses a field.
 */
export const PROBE: Readonly<Record<ConditionRead, number>> = {
  tempC: -40,
  feelsLikeC: -40,
  precipMm: 50,
  windKph: 120,
};

function doesProbeChange(
  scorer: Scorer,
  replayCase: ReplayCase,
  read: ConditionRead,
): boolean {
  const { request } = replayCase;
  const conditions = request.conditions;
  if (conditions.kind === "none") return false;
  const probed = scorer({
    ...request,
    conditions: { ...conditions, [read]: PROBE[read] },
  });
  return JSON.stringify(probed) !== JSON.stringify(scorer(request));
}

/**
 * The forecast fields whose move changed the scorer's answer on any case.
 */
export function observedReads(
  scorer: Scorer,
  cases: readonly ReplayCase[],
): ConditionRead[] {
  return CONDITION_READS.filter((read) =>
    cases.some((replayCase) => doesProbeChange(scorer, replayCase, read)),
  );
}
