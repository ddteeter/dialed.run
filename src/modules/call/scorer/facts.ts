import { itemFlagSchema } from "../../../lib/contracts";
import type { CohortCell, EvidenceFact } from "../contract";
import type { BandCount, CallScope, PieceCount } from "./personal";
import type { EstimateAtFeel } from "./shrinkage";

/**
 * The counted facts behind a piece's score, and only those: each is a
 * number the blend read. The evidence lines are templates over them
 * (design 194, "LLM": none in the Call's path).
 */
export interface PieceFacts {
  pieceId: string;
  /**
  The Call's band and class; absent with no forecast.
  */
  scope: CallScope | undefined;
  /**
  The runner's verdicts in the Call's band and class.
  */
  band: BandCount;
  /**
  The piece's own record, by band (`pieceCounts`).
  */
  counts: readonly PieceCount[];
  /**
  The cohort cell read for the piece's group, if any.
  */
  cell: CohortCell | undefined;
  /**
  The estimate the prior read, if any.
  */
  estimate: EstimateAtFeel | undefined;
}

function bandFacts(facts: PieceFacts): EvidenceFact[] {
  if (facts.scope === undefined) return [];
  return [
    {
      kind: "personal-band",
      bandFloorC: facts.scope.bandFloorC,
      cold: facts.band.cold,
      dialed: facts.band.dialed,
      warm: facts.band.warm,
    },
  ];
}

function pieceFacts(facts: PieceFacts): EvidenceFact[] {
  return facts.counts.map((count) => ({
    kind: "personal-piece",
    pieceId: facts.pieceId,
    bandFloorC: count.bandFloorC,
    dialed: count.dialed,
    of: count.worn,
  }));
}

function flagFacts(facts: PieceFacts): EvidenceFact[] {
  return facts.counts.flatMap((count) =>
    itemFlagSchema.options
      .filter((flag) => count.flags[flag] > 0)
      .map((flag) => ({
        kind: "personal-flag",
        pieceId: facts.pieceId,
        bandFloorC: count.bandFloorC,
        flag,
        times: count.flags[flag],
      })),
  );
}

function cohortFacts(cell: CohortCell | undefined): EvidenceFact[] {
  if (cell === undefined) return [];
  return [
    {
      kind: "cohort-share",
      group: cell.group,
      rung: cell.rung,
      climateZone: cell.climateZone,
      bandFloorC: cell.bandFloorC,
      groupRunners: cell.groupRunners,
      bandRunners: cell.bandRunners,
    },
  ];
}

function estimateFacts(facts: PieceFacts): EvidenceFact[] {
  if (facts.estimate === undefined) return [];
  return [
    { kind: "estimate", pieceId: facts.pieceId, range: facts.estimate.range },
  ];
}

/**
 * A piece's evidence, in a fixed order: the runner's band, the piece's
 * record band by band (coldest first), its flags the same way (in
 * `itemFlagSchema`'s order within a band), the cohort's share, the
 * estimate.
 *
 * The band's fact is on every piece of a Call that has a band, zeros
 * included: "none of your runs here" is itself a counted fact. With no
 * forecast there is no band, and a piece's own facts name theirs.
 */
export function evidenceFor(facts: PieceFacts): EvidenceFact[] {
  return [
    ...bandFacts(facts),
    ...pieceFacts(facts),
    ...flagFacts(facts),
    ...cohortFacts(facts.cell),
    ...estimateFacts(facts),
  ];
}
