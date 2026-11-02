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
 * Index-backed: the profile by its primary key (`conditionsHomeStatement`),
 * the observation by the weather cache's key, and the entries on
 * `entries_shared_created` (`test/feed/consensus.test.ts` holds the
 * profile's plan and the entries').
 */
import { captureException } from "../ops";
import { consensusAt, type ConsensusResult } from "./consensus";
import { conditionsHome, type ConditionsHome } from "./home";

export type CompactConditions = Extract<ConsensusResult, { status: "matched" }>;

/**
 * The line, or none. **Degrades rather than fails** (law 5): the count
 * reads the weather cache — another database — in the Following feed's
 * loader, so a weather read that throws would otherwise take the whole
 * feed down with it. The failure goes to Sentry with the runner, and the
 * feed draws no line, which is what an absent line already says.
 * `consensus` and `report` are parameters so a test can make the read
 * fail and see the report.
 */
export async function compactConditions(
  userId: string,
  coords: ConditionsHome["coords"],
  nowEpochSeconds: number,
  consensus: typeof consensusAt = consensusAt,
  report: typeof captureException = captureException,
): Promise<CompactConditions | undefined> {
  if (coords === undefined) return undefined;
  try {
    const result = await consensus(
      coords.lat,
      coords.lng,
      nowEpochSeconds,
      userId,
    );
    return result?.status === "matched" ? result : undefined;
  } catch (error) {
    report(error, { userId, surface: "compact-conditions" });
    return undefined;
  }
}

/**
 * What the Following feed's loader needs of the viewer's place: where the
 * Conditions tab looks, and E1's line from the same place — one profile
 * read for both.
 */
export async function feedConditions(
  userId: string,
  nowEpochSeconds: number,
): Promise<{
  home: ConditionsHome;
  compact: CompactConditions | undefined;
}> {
  const home = await conditionsHome(userId);
  return {
    home,
    compact: await compactConditions(userId, home.coords, nowEpochSeconds),
  };
}
