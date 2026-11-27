/**
 * Hand-built pieces for the replay tests. Seeded and synthetic: nothing
 * here is a real runner's data.
 */
import type { VerdictValue } from "../../../src/lib/contracts";
import type {
  CallRequest,
  CallResult,
  ClosetPiece,
  Confidence,
  PersonalRun,
  ScoredPiece,
  WornPiece,
} from "../../../src/modules/call/contract";
import type {
  ReplayCase,
  ReplayOutcome,
} from "../../../src/modules/call/replay";

export function personalRun(overrides: Partial<PersonalRun> = {}): PersonalRun {
  return {
    runId: "run",
    startedAt: 1_767_600_000,
    judgedFeelsLikeC: 8,
    precip: "dry",
    source: "visualcrossing",
    verdict: 0,
    worn: [],
    ...overrides,
  };
}

/**
 * A closet whose ranges are chosen by hand: warmest first within a group.
 */
export const CLOSET: readonly ClosetPiece[] = [
  { pieceId: "z-base", group: "tops", estimate: { lowC: -7, highC: 8 } },
  { pieceId: "m-long", group: "tops", estimate: { lowC: 4, highC: 15 } },
  { pieceId: "a-tee", group: "tops", estimate: { lowC: 13 } },
  { pieceId: "singlet", group: "tops", estimate: { lowC: 13 } },
  { pieceId: "tank", group: "tops", estimate: { lowC: 13, highC: 30 } },
  { pieceId: "parka", group: "outer", estimate: { highC: 2 } },
  { pieceId: "bivvy", group: "outer", estimate: { highC: 5 } },
  { pieceId: "cape", group: "outer", estimate: { highC: 2 } },
  { pieceId: "jacket", group: "outer", estimate: { lowC: -4, highC: 10 } },
  { pieceId: "vest", group: "outer", estimate: { lowC: -4, highC: 6 } },
  { pieceId: "shell", group: "outer", estimate: { lowC: 3, highC: 16 } },
  { pieceId: "anorak", group: "outer", estimate: { lowC: 3, highC: 16 } },
  { pieceId: "tights", group: "bottoms", estimate: { lowC: -2, highC: 12 } },
  { pieceId: "shorts", group: "bottoms", estimate: { lowC: 10 } },
  { pieceId: "shoes", group: "shoes" },
  { pieceId: "spikes", group: "shoes" },
];

export function worn(...ids: string[]): WornPiece[] {
  return ids.map((pieceId) => {
    const piece = CLOSET.find((p) => p.pieceId === pieceId);
    return { pieceId, group: piece?.group ?? "socks_extras" };
  });
}

export function scored(...ids: string[]): ScoredPiece[] {
  return worn(...ids).map((piece) => ({ ...piece, score: 1, evidence: [] }));
}

export function request(overrides: Partial<CallRequest> = {}): CallRequest {
  return {
    hourStart: 1_767_600_000,
    conditions: { kind: "none" },
    runner: {},
    history: [],
    closet: CLOSET,
    cohort: [],
    ...overrides,
  };
}

export function result(
  kit: readonly ScoredPiece[],
  confidence: Confidence = "probable",
): CallResult {
  return {
    engineVersion: "test",
    hourStart: 1_767_600_000,
    confidence,
    personalRunsInBand: 0,
    kit,
    ranking: kit,
  };
}

export function replayCase(
  wornIds: readonly string[],
  verdict: VerdictValue,
  overrides: Partial<ReplayCase> = {},
): ReplayCase {
  return {
    caseId: "case",
    runnerId: "runner",
    request: request(),
    worn: worn(...wornIds),
    verdict,
    ...overrides,
  };
}

export function outcome(
  wornIds: readonly string[],
  verdict: VerdictValue,
  kitIds: readonly string[],
  confidence: Confidence = "probable",
): ReplayOutcome {
  return {
    replayCase: replayCase(wornIds, verdict),
    result: result(scored(...kitIds), confidence),
  };
}
