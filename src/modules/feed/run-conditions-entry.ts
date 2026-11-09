/**
 * Feed's half of `run_conditions` (D-175, design 189): the entry's verdict,
 * when it was logged and whether it is shared, beside the copy of its
 * run's conditions that weather writes. The consensus seeks the copy by
 * band and window, so these are what put an entry in or out of the index.
 *
 * Read from the entry row itself, in SQL, rather than passed in: placed
 * after the entry's own write in the same batch, it copies the row as that
 * write left it, so the copy cannot disagree with what was just saved.
 */
import { eq, inArray, sql } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import {
  outfitEntries,
  runConditions,
  sharedAudience,
} from "../../db/schema-core";

type CoreDb = DrizzleD1Database<Record<string, unknown>>;

/**
 * Upserts the entry's half of its run's copy. Touches only this half, so
 * the row is the same whichever half was written first, and writing it
 * twice is writing it once (law 1).
 *
 * Every write of `outfit_entries.audience` or `verdict` puts this in its
 * batch (`test/architecture/run-conditions-writers.test.ts`): a stale
 * `entry_shared` of 0 would leave a shared kit out of the consensus with
 * nothing to tell.
 */
export function entryHalfStatement(db: CoreDb, entryId: string) {
  const into = runConditions;
  const excluded = (column: { name: string }) =>
    sql`excluded.${sql.identifier(column.name)}`;
  // A select written as SQL, in the table's column order: drizzle's typed
  // insert-from-select wants the generated columns too, which SQLite
  // refuses a value for, and its column list leaves them out. Weather's
  // half is NULL for a row this inserts; the conflict below leaves an
  // existing row's as it was.
  const fromEntry = sql`select ${outfitEntries.runId}, ${outfitEntries.userId},
    null, null, null, null, null,
    ${outfitEntries.verdict}, ${outfitEntries.createdAt},
    ${sharedAudience(outfitEntries.audience)}
    from ${outfitEntries} where ${eq(outfitEntries.id, entryId)}`;
  return db
    .insert(into)
    .select(fromEntry)
    .onConflictDoUpdate({
      target: into.runId,
      set: {
        verdict: excluded(into.verdict),
        entryCreatedAt: excluded(into.entryCreatedAt),
        entryShared: excluded(into.entryShared),
      },
    });
}

/**
 * Clears the entry half of the copies of these entries' runs, for entries
 * that are going while their runs stay. A run keeps its weather half; with
 * no shared entry, the band index no longer offers it. `entries` selects
 * entry ids, and this goes in the batch before the entries' delete, which
 * is how their runs are found.
 */
export function clearEntryHalves(db: CoreDb, entries: SQLWrapper) {
  const theirRuns = db
    .select({ runId: outfitEntries.runId })
    .from(outfitEntries)
    .where(inArray(outfitEntries.id, entries));
  return db
    .update(runConditions)
    .set({ verdict: sql`NULL`, entryCreatedAt: sql`NULL`, entryShared: false })
    .where(inArray(runConditions.runId, theirRuns));
}

/**
Deletes the copies of these runs, in the batch that deletes the runs; `runs` selects run ids.
*/
export function deleteRunCopies(db: CoreDb, runs: SQLWrapper) {
  return db.delete(runConditions).where(inArray(runConditions.runId, runs));
}
