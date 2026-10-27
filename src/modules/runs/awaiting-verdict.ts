import { and, asc, eq, isNull, or } from "drizzle-orm";

import { outfitEntries, runs } from "../../db/schema-core";
import type { CoreDb } from "./core-db";

/**
 * Runs as a screen about attaching a kit reads them: what the run was,
 * where, and the id of the entry it already has, if any. A run has at most
 * one entry (UNIQUE `entries_run`), so the LEFT JOIN never multiplies a
 * row; the probe is that index. The caller adds the `WHERE`.
 */
export function runsWithEntry(db: CoreDb) {
  return db
    .select({
      id: runs.id,
      // fallow-ignore-next-line code-duplication -- fallow 3.34 matches drizzle's select/from/join/where grammar across tables; runsWithEntry is the one projection of a run with its entry, shared by the attach screen and the verdict backlog
      startedAt: runs.startedAt,
      durationS: runs.durationS,
      distanceM: runs.distanceM,
      lat: runs.lat,
      lng: runs.lng,
      entryId: outfitEntries.id,
    })
    .from(runs)
    .leftJoin(outfitEntries, eq(outfitEntries.runId, runs.id));
}

/**
 * **The one definition of "runs awaiting a verdict"** (owner's ruling on
 * round 22's item 18: DS2's backlog and the bell's number are the same
 * set). A run awaits a verdict when it has **no outfit entry**, or an
 * entry whose **verdict is null**, and it does so **at any age**: DS2 is
 * the surface built to clear a backlog, and a window would hide runs from
 * the one place a runner goes to clear them. A surface that wants fewer —
 * a bell that only mentions the last fortnight — caps what it *shows*; it
 * does not define a different set.
 *
 * Oldest first, capped in SQL so the LIMIT is not a `.slice()` over rows D1
 * has already scanned and billed for. A LEFT JOIN rather than a
 * `NOT IN (SELECT …)`: the scan is `runs_user_started`, the probe is the
 * UNIQUE `entries_run`, and a run has at most one entry, so the join never
 * multiplies a row.
 *
 * `entryId` is the entry a run already has, when it has one — a kit without
 * a verdict is still waiting, and a caller can tell that row from a bare one.
 */
export async function runsAwaitingVerdict(
  db: CoreDb,
  userId: string,
  limit: number,
) {
  const verdictMissing = or(
    isNull(outfitEntries.id),
    isNull(outfitEntries.verdict),
  );
  return runsWithEntry(db)
    .where(and(eq(runs.userId, userId), verdictMissing))
    .orderBy(asc(runs.startedAt))
    .limit(limit);
}
