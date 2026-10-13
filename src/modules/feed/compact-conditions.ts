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
import { captureException } from "../ops";
import { consensusAt, type ConsensusResult } from "./consensus";
import { conditionsHome } from "./home";

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
  nowEpochSeconds: number,
  consensus: typeof consensusAt = consensusAt,
  report: typeof captureException = captureException,
): Promise<CompactConditions | undefined> {
  const { coords } = await conditionsHome(userId);
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
