/**
 * "Export your data" (task 126, ACC-10; D-79): everything a runner has put
 * in, read for the ZIP (`export-files.ts` shapes it, `export-build.ts`
 * writes it).
 *
 * **What it reads**: the account and profile, the closet (retired garments
 * too), every run with its conditions, every entry with its kit, tags and
 * photos, and every upload. **Derived conditions only** — the reading the
 * app shows for the run, never a raw Visual Crossing row (its licence,
 * §1.8): no cache key, no place, no fetch time.
 */
import { asc, eq, inArray } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { user } from "../../db/schema-auth";
import {
  entryPhotos,
  entryTags,
  imports,
  outfitEntries,
  outfitEntryItems,
  runs,
  userProfiles,
  wardrobeItems,
} from "../../db/schema-core";
import { chunked, readInChunks } from "../../lib/chunked";
import { ulidSchema, type Ulid } from "../../lib/ids";
import { firstRowWhere } from "../../lib/keyed-read";
import { manualReadingsForRuns, observationsForRuns } from "../weather";
import type { WeatherReading } from "../weather";

type Db = ReturnType<typeof drizzle>;

/**
 * How many runs one observation read may name. `observationsForRuns` binds
 * three parameters a run on the weather database (its place and hour), so
 * D1's hundred-parameter cap is 33 runs, not `IN_LIST_CHUNK`'s 80 — the
 * same arithmetic as runs' own `CELLS_PER_READ`.
 */
const RUNS_PER_OBSERVATION_READ = 30;

/**
 * Each run's conditions: the band the runner set, else the observation
 * at its place and hour. Two databases, so assembled here (CLAUDE.md's
 * one exception to "filter in SQL"), in chunks under D1's parameter cap.
 */
async function conditionsFor(
  runIds: readonly Ulid[],
): Promise<Map<string, WeatherReading>> {
  const bands = await manualReadingsForRuns(runIds);
  const readings = new Map<string, WeatherReading>();
  for (const chunk of chunked(runIds, RUNS_PER_OBSERVATION_READ)) {
    const observed = await observationsForRuns(chunk);
    for (const [runId, observation] of observed) {
      readings.set(runId, { ...observation, source: "visualcrossing" });
    }
  }
  for (const [runId, band] of bands) readings.set(runId, band);
  return readings;
}

/**
 * The runner's rows, as the ZIP needs them: each list in the order a
 * reader expects (oldest first), each entry's kit, tags and photos
 * grouped under it, and each run's reading beside it.
 */
export async function exportData(db: Db, userId: string) {
  const account = await firstRowWhere(db, user, eq(user.id, userId));
  const profile = await firstRowWhere(
    db,
    userProfiles,
    eq(userProfiles.userId, userId),
  );
  const [garments, runRows, entries, uploads] = await db.batch([
    db
      .select()
      .from(wardrobeItems)
      .where(eq(wardrobeItems.userId, userId))
      .orderBy(asc(wardrobeItems.createdAt)),
    db
      .select()
      .from(runs)
      .where(eq(runs.userId, userId))
      .orderBy(asc(runs.startedAt)),
    db
      .select()
      .from(outfitEntries)
      .where(eq(outfitEntries.userId, userId))
      .orderBy(asc(outfitEntries.createdAt)),
    db
      .select({
        id: imports.id,
        r2Key: imports.r2Key,
        status: imports.status,
        runId: imports.runId,
      })
      .from(imports)
      .where(eq(imports.userId, userId))
      .orderBy(asc(imports.createdAt)),
  ]);
  const entryIds = entries.map((entry) => entry.id);
  const [items, tags, photos] = await Promise.all([
    readInChunks(entryIds, (chunk) =>
      db
        .select()
        .from(outfitEntryItems)
        .where(inArray(outfitEntryItems.entryId, chunk)),
    ),
    readInChunks(entryIds, (chunk) =>
      db.select().from(entryTags).where(inArray(entryTags.entryId, chunk)),
    ),
    readInChunks(entryIds, (chunk) =>
      db
        .select()
        .from(entryPhotos)
        .where(inArray(entryPhotos.entryId, chunk))
        .orderBy(asc(entryPhotos.position)),
    ),
  ]);
  const conditions = await conditionsFor(
    runRows.map((run) => ulidSchema.parse(run.id)),
  );
  // Grouped, not filtered: every row read is an entry's, and belongs in
  // the ZIP.
  const kitOf = Map.groupBy(items, (item) => item.entryId);
  const tagsOf = Map.groupBy(tags, (tag) => tag.entryId);
  const photosOf = Map.groupBy(photos, (photo) => photo.entryId);
  return {
    account,
    profile,
    garments,
    runs: runRows.map((run) => ({
      ...run,
      conditions: conditions.get(run.id),
    })),
    entries: entries.map((entry) => ({
      ...entry,
      kit: kitOf.get(entry.id) ?? [],
      tags: (tagsOf.get(entry.id) ?? []).map((tag) => tag.tag),
      photos: photosOf.get(entry.id) ?? [],
    })),
    uploads,
  };
}

export type ExportData = Awaited<ReturnType<typeof exportData>>;
