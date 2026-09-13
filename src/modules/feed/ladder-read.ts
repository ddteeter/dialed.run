import { drizzle } from "drizzle-orm/d1";

import { env } from "../../env";
import { bandLabel } from "../../lib/temperature";
import { observationsForEntries } from "./conditions";
import { bandsAscendingWithGaps, tallyCoverage } from "./coverage";
import type { CoverageBand } from "./coverage";
import { recentOwnEntries } from "./own-history";
import { unitsFor } from "./units";

/**
 * The coverage ladder for one runner, gaps included.
 *
 * Its own read rather than a call to `ownProfile`, which also fetches
 * most-worn items and recent entries — six queries the Call tab has no use
 * for, on a screen a runner opens to check progress. The *counting* is
 * shared (`tallyCoverage`), which is the part that could drift; only the
 * reads differ, and they differ because the screens need different things.
 */
export async function coverageLadder(
  userId: string,
): Promise<CoverageBand[]> {
  const database = drizzle(env.DIALED_CORE);
  const entries = await recentOwnEntries(database, userId);
  // Equivalent mutant: with no entries the walk answers an empty ladder
  // anyway — `observationsForEntries` guards its own empty case, and a
  // tally with no range spans no floors. What the return saves is two
  // cross-database reads on every Call-tab open by a runner who has logged
  // nothing, which is every runner's first visit.
  // Stryker disable next-line ConditionalExpression
  if (entries.length === 0) return [];

  const observations = await observationsForEntries(database, entries);
  const units = await unitsFor(database, userId);

  return bandsAscendingWithGaps(
    tallyCoverage(entries, observations, (floor) =>
      bandLabel(floor, units.temp),
    ),
    (floor) => bandLabel(floor, units.temp),
  );
}
