import type { Conditions } from "./conditions";

/**
 * The temperature a run should be *judged* at — which is not always the one
 * it started at.
 *
 * A 9–11am run can begin at 4° and finish at 12°. The verdict covers the
 * whole run, so banding it at 4° teaches the call epic that 4° means
 * overdressed (D-5). Owner's call, 2026-09-11: **a run is judged at its
 * worst hour relative to its verdict.**
 *
 * - Felt cold (`verdict < 0`) → the coldest hour it reached. That is the
 *   hour the outfit failed in, and the one the runner is remembering.
 * - Felt warm (`verdict > 0`) → the warmest hour, for the same reason.
 * - **Dialed, or not yet rated** → the hour they dressed for. A dialed run
 *   has no worst hour — the outfit held across the whole span — and an
 *   unrated one has no verdict to be worst relative to. The starting hour
 *   is what the person actually stepped out into, and it is what every
 *   reader used before this lane, so nothing moves for them.
 *
 * The sign convention is `verdictScale`'s, and `judged-conditions.test.ts`
 * pins this against it rather than restating it: negative is cold, positive
 * is warm, and if that ever flips, the test fails instead of the bands
 * quietly inverting.
 *
 * Deliberately takes the verdict rather than reading it off an entry: the
 * four callers hold different row shapes, and the one thing they agree on
 * is a nullable number.
 */
export function judgedFeelsLikeC(
  conditions: Conditions,
  verdict: number | null,
): number {
  // Equivalent mutant, and it is equivalent *by design*: an unrated run
  // and a dialed one have the same answer, so deleting this guard lets
  // `null` fall through two comparisons it fails and reach the same
  // return. It stays because "no verdict yet" and "the outfit was right"
  // are different facts that happen to share a value, and a reader should
  // be told that rather than having to notice `null < 0` is false.
  //
  // The two comparisons below are NOT equivalent and carry no directive:
  // widening either one sends a dialed run to an end of the span, which
  // `judged-conditions.test.ts` catches.
  // Stryker disable next-line ConditionalExpression
  if (verdict === null) return conditions.feelsLikeC;
  if (verdict < 0) return conditions.span.minFeelsLikeC;
  if (verdict > 0) return conditions.span.maxFeelsLikeC;
  return conditions.feelsLikeC;
}
