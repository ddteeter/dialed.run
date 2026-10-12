/**
 * E1's compact line (FEED-9; round 25, "Elsewhere": *"E1's compact line
 * becomes '18 runners logged 44° and damp in the last 3 days.'"*): how many
 * runners logged the viewer's conditions, read in the Following feed's
 * loader so the line is in the first paint.
 *
 * The same match as Your conditions — the one consensus, not a second
 * count — from the place the profile saved. E1 never asks for a location:
 * a runner with no saved place, no fresh observation there, or too few
 * runners gets no line, which is what an absent line already says.
 *
 * Index-backed: the profile by its primary key, the observation by the
 * weather cache's key, and the entries on `entries_audience_created`
 * (`test/feed/compact-conditions.test.ts` holds the plans).
 */
import { consensusAt, type ConsensusResult } from "./consensus";
import { conditionsHome } from "./home";

export type CompactConditions = Extract<ConsensusResult, { status: "matched" }>;

export async function compactConditions(
  userId: string,
  nowEpochSeconds: number,
): Promise<CompactConditions | undefined> {
  const { coords } = await conditionsHome(userId);
  if (coords === undefined) return undefined;
  const result = await consensusAt(
    coords.lat,
    coords.lng,
    nowEpochSeconds,
    userId,
  );
  return result?.status === "matched" ? result : undefined;
}
