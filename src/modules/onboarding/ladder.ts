import {
  BAND_COVERED_VERDICTS,
  CALL_VERDICT_THRESHOLD,
} from "../../lib/contracts";
import type { CoverageBand } from "../feed";

/**
 * How well the app knows one band. O6's three colours: pink covered, teal
 * partial, grey unknown.
 */
export type BandCoverage = "covered" | "partial" | "unknown";

/**
 * Where a runner is on the ladder, by total verdicts. O6's three states,
 * and its own copy:
 *
 * - 0–4 **guessing** — "Best guess — I don't know you yet."
 * - 5–14 **learning** — names its own gaps by temperature band.
 * - 15+ **dialed** — "No caveat. Just the call."
 */
export type LadderState = "guessing" | "learning" | "dialed";

const LEARNING_FROM_VERDICTS = 5;

export interface Ladder {
  bands: { band: CoverageBand; coverage: BandCoverage }[];
  verdictTotal: number;
  state: LadderState;
  /**
  How many more before the call unlocks; 0 once it has.
  */
  verdictsUntilCall: number;
  /**
   * The band worth logging next, or nothing when there is no history to
   * reason from yet.
   */
  thinnestBand: CoverageBand | undefined;
}

export function bandCoverage(band: CoverageBand): BandCoverage {
  const verdicts = verdictsIn(band);
  if (verdicts >= BAND_COVERED_VERDICTS) return "covered";
  return verdicts > 0 ? "partial" : "unknown";
}

export function verdictsIn(band: CoverageBand): number {
  return band.cold + band.dialed + band.warm;
}

/**
 * The ladder, from the bands a runner has logged in.
 *
 * **The thinnest band is chosen from within their own range**, gaps
 * included, because that is the honest ask: O6's point is that "a runner
 * with 40 verdicts all at 50° is still guessing in January", and the gap
 * at the cold end of *their* year is a gap. Bands outside the range are
 * not gaps — they are weather they do not get.
 *
 * Ties go to the coldest, because underdressing is the failure that ends a
 * run early.
 */
export function ladderFrom(bands: readonly CoverageBand[]): Ladder {
  let verdictTotal = 0;
  let thinnest: CoverageBand | undefined;
  for (const band of bands) {
    verdictTotal += verdictsIn(band);
    // Strictly fewer, so a tie keeps the band already held — and the list
    // arrives coldest-first, which is how ties land on the colder band.
    if (thinnest === undefined || verdictsIn(band) < verdictsIn(thinnest)) {
      thinnest = band;
    }
  }
  return {
    bands: bands.map((band) => ({ band, coverage: bandCoverage(band) })),
    verdictTotal,
    state: ladderState(verdictTotal),
    verdictsUntilCall: Math.max(CALL_VERDICT_THRESHOLD - verdictTotal, 0),
    thinnestBand: thinnest,
  };
}

function ladderState(verdictTotal: number): LadderState {
  if (verdictTotal >= CALL_VERDICT_THRESHOLD) return "dialed";
  return verdictTotal >= LEARNING_FROM_VERDICTS ? "learning" : "guessing";
}
