/**
 * What replay measures (design 194, "Engine releases"). Every measure is a
 * count of hits over a count of cases it could judge, so two versions are
 * compared on the same footing and an empty measure is visibly empty.
 */
import type { UiGroup } from "../../../lib/contracts";
import type { TempRange } from "../../../lib/contracts/thermal";
import type { Confidence, ScoredPiece, WornPiece } from "../contract";
import type { ReplayOutcome } from "./run";

export interface Share {
  hits: number;
  of: number;
}

/**
 * Direction on misses. `noCall` counts the cases it could not judge: the
 * Call offered no kit, or no piece on either side carried an estimate.
 * They are kept apart from misses, so they sit outside `of`.
 */
export interface DirectionShare extends Share {
  noCall: number;
}

export interface ConfidenceSplit {
  dialedAgreement: Share;
  direction: DirectionShare;
}

export interface ConfidenceRow extends ConfidenceSplit {
  confidence: Confidence;
}

export interface ReplayMetrics extends ConfidenceSplit {
  cases: number;
  /**
   * Cases whose confidence is not `below-threshold`.
   */
  coverage: Share;
  /**
   * The two kit measures again for each confidence the results used,
   * narrowest knowledge first, so "confident" can be checked to beat
   * "probable".
   */
  byConfidence: readonly ConfidenceRow[];
}

/**
 * Narrowest knowledge first. A record, so the compiler fails here if the
 * contract's `Confidence` gains or loses a value.
 */
const CONFIDENCE_RANK: Readonly<Record<Confidence, number>> = {
  "below-threshold": 0,
  "best-guess": 1,
  borrowed: 2,
  probable: 3,
  confident: 4,
};

export function byRank(a: Confidence, b: Confidence): number {
  return CONFIDENCE_RANK[a] - CONFIDENCE_RANK[b];
}

/**
 * The share as a fraction, or undefined when nothing was judged.
 */
export function rate(share: Share): number | undefined {
  return share.of === 0 ? undefined : share.hits / share.of;
}

function hasKit(outcome: ReplayOutcome): boolean {
  return outcome.result.confidence !== "below-threshold";
}

/**
 * On a dialed run, of the distinct groups worn, how many the kit filled
 * with a piece that was worn. Undefined for any other run.
 */
function agreementOf(outcome: ReplayOutcome): Share | undefined {
  const { worn, verdict } = outcome.replayCase;
  if (verdict !== 0 || !hasKit(outcome)) return undefined;
  const wornIds = new Set(worn.map((piece) => piece.pieceId));
  const groups = [...new Set(worn.map((piece) => piece.group))];
  const hits = groups.filter((group) =>
    outcome.result.kit.some(
      (pick) => pick.group === group && wornIds.has(pick.pieceId),
    ),
  ).length;
  return { hits, of: groups.length };
}

type Step = "warmer" | "cooler" | "same";

function order(a: number, b: number): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * How the kit's piece stands to a worn one. A lower floor works colder, so
 * it is warmer; an open floor is the lowest. On equal floors the lower
 * ceiling is the warmer piece; an open ceiling is the highest.
 */
function stepBetween(kit: TempRange, worn: TempRange): Step {
  const byFloor = order(kit.lowC ?? -Infinity, worn.lowC ?? -Infinity);
  const byBoth =
    byFloor === 0
      ? order(kit.highC ?? Infinity, worn.highC ?? Infinity)
      : byFloor;
  if (byBoth < 0) return "warmer";
  return byBoth > 0 ? "cooler" : "same";
}

type Estimates = ReadonlyMap<string, TempRange | undefined>;

/**
 * The steps one group contributes. A worn piece the kit keeps is "same"; a
 * group the kit adds is warmer and one it drops is cooler. A piece with no
 * estimate, or one the closet no longer holds, cannot be compared.
 */
function groupSteps(
  pick: ScoredPiece | undefined,
  worn: readonly WornPiece[],
  estimates: Estimates,
): Step[] {
  if (pick !== undefined && worn.some((p) => p.pieceId === pick.pieceId)) {
    return ["same"];
  }
  const kitRange = pick === undefined ? undefined : estimates.get(pick.pieceId);
  const wornRanges = worn.flatMap((p) => {
    const range = estimates.get(p.pieceId);
    return range === undefined ? [] : [range];
  });
  if (pick === undefined) return wornRanges.map(() => "cooler");
  if (kitRange === undefined) return [];
  if (worn.length === 0) return ["warmer"];
  return wornRanges.map((range) => stepBetween(kitRange, range));
}

type Direction = Step | "mixed";

/**
 * The kit against what was worn, over every group either side has.
 * Undefined when no group could be compared.
 */
function directionOf(outcome: ReplayOutcome): Direction | undefined {
  const { request, worn } = outcome.replayCase;
  const kit = outcome.result.kit;
  const estimates: Estimates = new Map(
    request.closet.map((piece) => [piece.pieceId, piece.estimate]),
  );
  const groups = new Set<UiGroup>([
    ...kit.map((pick) => pick.group),
    ...worn.map((piece) => piece.group),
  ]);
  const steps = [...groups].flatMap((group) =>
    groupSteps(
      kit.find((pick) => pick.group === group),
      worn.filter((piece) => piece.group === group),
      estimates,
    ),
  );
  if (steps.length === 0) return undefined;
  const isWarmer = steps.includes("warmer");
  const isCooler = steps.includes("cooler");
  if (isWarmer && isCooler) return "mixed";
  if (isWarmer) return "warmer";
  return isCooler ? "cooler" : "same";
}

type Judgement = "hit" | "miss" | "no-call";

/**
 * On a cold verdict the kit should be warmer than what was worn; on a warm
 * one, cooler. Undefined on a dialed run, which this measure does not judge.
 */
function judgeMiss(outcome: ReplayOutcome): Judgement | undefined {
  const verdict = outcome.replayCase.verdict;
  if (verdict === 0) return undefined;
  const direction = hasKit(outcome) ? directionOf(outcome) : undefined;
  if (direction === undefined) return "no-call";
  const wanted: Step = verdict < 0 ? "warmer" : "cooler";
  return direction === wanted ? "hit" : "miss";
}

function splitOf(outcomes: readonly ReplayOutcome[]): ConfidenceSplit {
  const dialedAgreement: Share = { hits: 0, of: 0 };
  const direction: DirectionShare = { hits: 0, of: 0, noCall: 0 };
  for (const outcome of outcomes) {
    const agreement = agreementOf(outcome);
    if (agreement !== undefined) {
      dialedAgreement.hits += agreement.hits;
      dialedAgreement.of += agreement.of;
    }
    const judgement = judgeMiss(outcome);
    if (judgement === "no-call") {
      direction.noCall += 1;
    } else if (judgement !== undefined) {
      direction.of += 1;
      if (judgement === "hit") direction.hits += 1;
    }
  }
  return { dialedAgreement, direction };
}

export function measure(outcomes: readonly ReplayOutcome[]): ReplayMetrics {
  const confidences = [
    ...new Set(outcomes.map((o) => o.result.confidence)),
  ].toSorted(byRank);
  const byConfidence = confidences.map((confidence) => ({
    confidence,
    ...splitOf(outcomes.filter((o) => o.result.confidence === confidence)),
  }));
  return {
    cases: outcomes.length,
    ...splitOf(outcomes),
    coverage: {
      hits: outcomes.filter((o) => hasKit(o)).length,
      of: outcomes.length,
    },
    byConfidence,
  };
}
