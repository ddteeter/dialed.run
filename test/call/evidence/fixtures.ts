/**
 * Hand-built `CallResult`s for the evidence tests: the scorer is another
 * lane's, so these stand in for what it answers.
 */
import type { UiGroup } from "../../../src/lib/contracts";
import type {
  CallResult,
  EvidenceFact,
  ScoredPiece,
} from "../../../src/modules/call/contract";

export function piece(
  pieceId: string,
  group: UiGroup,
  evidence: readonly EvidenceFact[] = [],
  score = 1,
): ScoredPiece {
  return { pieceId, group, score, evidence };
}

export function result(overrides: Partial<CallResult> = {}): CallResult {
  return {
    engineVersion: "test-1",
    hourStart: 1_790_000_000,
    bandFloorC: 5,
    precip: "damp",
    confidence: "confident",
    personalRunsInBand: 11,
    kit: [],
    ranking: [],
    ...overrides,
  };
}

export function names(
  entries: Record<string, string>,
): ReadonlyMap<string, string> {
  return new Map(Object.entries(entries));
}
