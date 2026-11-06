import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import {
  outfitEntries,
  outfitEntryItems,
  runs,
  wardrobeItems,
} from "../../db/schema-core";
import { coreDb } from "../../env";
import { monthDayLabel } from "../../lib/dates";
import { ulidSchema } from "../../lib/ids";
import { verdictedEntriesInBand } from "./entries";
import type { InBandEntry } from "./entries";
import { runDayOf } from "./public-kit";

/**
 * The band history on A2's and A3's desk rails (round 25): the runner's
 * last runs in this band, each with its day, its conditions, its verdict
 * and what was worn. On A2 it is *"the evidence behind MOST LIKELY"*
 * (`LAST 3 IN 38–46° DAMP`); on A3 the same rows sit under the kit being
 * judged (`BEFORE, IN 38–46° DAMP`).
 *
 * **The same band as A3's history line and its chips**: the rows are
 * `verdictedEntriesInBand`'s, newest first, so the rail, the line beneath
 * the verdict row and the chips can never disagree about what "this band"
 * holds. The board's own rows mix DAMP and RAIN under one heading, so the
 * band is the temperature band alone, as everywhere else.
 *
 * Read-only, and only the runner's own: the walk is scoped to `userId` in
 * SQL, and the kit rows are read only for the entries it returned.
 */
export const BAND_RUNS_SHOWN = 3;

export const bandRunsInput = z.object({
  bandFloorC: z.number(),
  /**
  A3's entry, kept out of its own history; A2 has no entry yet.
  */
  excludeEntryId: ulidSchema.optional(),
});

export interface BandRun extends InBandEntry {
  /**
  "Aug 14", in the run's own zone (R-96).
  */
  day: string;
  /**
  The pieces worn, by their own names, oldest-added first.
  */
  pieces: string[];
}

export async function recentRunsInBand(
  userId: string,
  bandFloorC: number,
  excludeEntryId?: string,
): Promise<BandRun[]> {
  const inBand = await verdictedEntriesInBand(
    userId,
    bandFloorC,
    excludeEntryId,
  );
  const shown = inBand.slice(0, BAND_RUNS_SHOWN);
  const rows = await shownRunsAndKits(shown.map((entry) => entry.id));
  // Every entry has its run, so every shown entry has a row here: a kit
  // of no pieces still joins its run, with no garment beside it.
  const startedAt = new Map(rows.map((row) => [row.entryId, row.startedAt]));
  return shown.map((entry) => ({
    ...entry,
    day: runDayOf(
      startedAt.get(entry.id) ?? 0,
      entry.conditions,
      undefined,
      monthDayLabel,
    ),
    pieces: rows
      .filter((row) => row.entryId === entry.id)
      .map((row) => row.name)
      // The LEFT join's empty row, for a kit of no pieces.
      .filter((name) => name !== null),
  }));
}

/**
 * Each shown entry's run start and its pieces' names, in one read: the
 * entry to its run by primary key, then out to its kit and the garments,
 * LEFT so an entry with no pieces still answers with its run.
 */
function shownRunsAndKits(entryIds: string[]) {
  return coreDb()
    .select({
      // fallow-ignore-next-line code-duplication -- fallow 3.34 matches drizzle's select/from/join/where grammar across tables; shownRunsAndKits reads each shown band run's start and its pieces' names for the A2/A3 desk rails
      entryId: outfitEntries.id,
      startedAt: runs.startedAt,
      name: wardrobeItems.name,
    })
    .from(outfitEntries)
    .innerJoin(runs, eq(runs.id, outfitEntries.runId))
    .leftJoin(outfitEntryItems, eq(outfitEntryItems.entryId, outfitEntries.id))
    .leftJoin(wardrobeItems, eq(wardrobeItems.id, outfitEntryItems.itemId))
    .where(inArray(outfitEntries.id, entryIds))
    .orderBy(asc(outfitEntryItems.itemId));
}
