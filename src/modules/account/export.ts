/**
 * "Export your data" (task 126, ACC-10; D-40): everything a runner has
 * put in, as one JSON file they download from Settings › Account.
 *
 * **What it holds**: the profile, the closet (retired garments too), every
 * run with its conditions, every entry with its items, tags and verdict,
 * and links to every photo. **Derived conditions only** — the reading the
 * app shows for the run, never a raw Visual Crossing row (its licence,
 * §1.8): no cache key, no place, no fetch time.
 *
 * **Photos are links to the app's own photo routes**, which serve a runner
 * their own photos — private or shared, entry or garment — while they are
 * signed in (D-69: no signed links). The file says so in its `notes`.
 * Uploaded run files are listed, not included.
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
import { photoUrlFor } from "../closet";
import { manualReadingsForRuns, observationsForRuns } from "../weather";
import type { WeatherReading } from "../weather";

type Db = ReturnType<typeof drizzle>;

/**
Seconds since the epoch, as the file says a moment: ISO 8601, UTC.
*/
function iso(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

/**
 * The file's own words about itself, so a runner reading it — or anyone
 * they hand it to — knows what the links are and what is missing.
 */
export const EXPORT_NOTES = {
  photos:
    "Photo links open while you are logged in to dialed.run as this account; they show your photos, shared or not.",
  conditions:
    "Conditions are the reading dialed.run showed for each run: from Visual Crossing, or the band you set yourself.",
  runFiles:
    "Uploaded run files (GPX, FIT, TCX) are listed by when you uploaded them; the files themselves are not in this export.",
} as const;

/**
The reading a run showed, with nothing of the provider's own record.
*/
function conditionsOf(reading: WeatherReading | undefined) {
  if (reading === undefined) return;
  return {
    source: reading.source,
    tempC: reading.tempC,
    feelsLikeC: reading.feelsLikeC,
    humidity: reading.humidity,
    windKph: reading.windKph,
    precipMm: reading.precipMm,
    condition: reading.condition,
    sky: reading.sky,
  };
}

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

export async function accountExport(
  db: Db,
  userId: string,
  origin: string,
  now: number,
) {
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
        status: imports.status,
        runId: imports.runId,
        createdAt: imports.createdAt,
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
  // the file.
  const kitOf = Map.groupBy(items, (item) => item.entryId);
  const tagsOf = Map.groupBy(tags, (tag) => tag.entryId);
  const photosOf = Map.groupBy(photos, (photo) => photo.entryId);
  return {
    exportedAt: iso(now),
    notes: EXPORT_NOTES,
    account: {
      email: account?.email,
      joinedAt:
        account === undefined
          ? undefined
          : iso(Math.floor(account.createdAt.getTime() / 1000)),
    },
    profile: {
      username: profile?.username ?? undefined,
      place: profile?.cityLabel ?? undefined,
      thermalLevel: profile?.thermalLevel ?? undefined,
      tempUnit: profile?.tempUnit ?? undefined,
      distanceUnit: profile?.distanceUnit ?? undefined,
      shareNewRuns: profile?.shareDefault,
    },
    closet: garments.map((garment) => ({
      id: garment.id,
      category: garment.category,
      type: garment.type ?? undefined,
      brand: garment.brand ?? undefined,
      name: garment.name,
      size: garment.size ?? undefined,
      color: garment.color ?? undefined,
      colorName: garment.colorName ?? undefined,
      colorHex: garment.colorHex ?? undefined,
      layer: garment.layer ?? undefined,
      weight: garment.weight ?? undefined,
      fabric: garment.fabric ?? undefined,
      windResistant: garment.windResistant ?? undefined,
      waterResistant: garment.waterResistant ?? undefined,
      visibility: garment.visibilityLevel ?? undefined,
      productUrl: garment.productUrl ?? undefined,
      retired: garment.retired,
      addedAt: iso(garment.createdAt),
      photo: withOrigin(origin, photoUrlFor(garment)),
    })),
    runs: runRows.map((run) => ({
      id: run.id,
      title: run.title,
      startedAt: iso(run.startedAt),
      durationSeconds: run.durationS,
      distanceMeters: run.distanceM,
      indoor: run.indoor,
      effort: run.effort ?? undefined,
      from: run.source,
      conditions: conditionsOf(conditions.get(run.id)),
    })),
    entries: entries.map((entry) => ({
      id: entry.id,
      runId: entry.runId,
      verdict: entry.verdict ?? undefined,
      shared: entry.isPublic,
      caption: entry.caption ?? undefined,
      createdAt: iso(entry.createdAt),
      kit: (kitOf.get(entry.id) ?? []).map((item) => ({
        garmentId: item.itemId,
        flag: item.flag ?? undefined,
        note: item.note ?? undefined,
      })),
      tags: (tagsOf.get(entry.id) ?? []).map((tag) => tag.tag),
      photos: (photosOf.get(entry.id) ?? []).map(
        (photo) => `${origin}/feed/photo/${photo.photoKey}`,
      ),
    })),
    runFiles: uploads.map((upload) => ({
      uploadedAt: iso(upload.createdAt),
      status: upload.status,
      runId: upload.runId ?? undefined,
    })),
  };
}

export type AccountExport = Awaited<ReturnType<typeof accountExport>>;

function withOrigin(origin: string, path: string | undefined) {
  return path === undefined ? undefined : `${origin}${path}`;
}

/**
 * The download: the runner's export as an attachment named for the day,
 * never cached anywhere on the way.
 */
export function exportResponse(data: AccountExport): Response {
  const day = data.exportedAt.slice(0, 10);
  return new Response(JSON.stringify(data, undefined, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="dialed-run-export-${day}.json"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * `GET /account/export`: the signed-in runner's own file, or a refusal —
 * the route is glue, and this is everything it decides. `origin` is the
 * deployment's, which every link in the file starts with.
 */
export async function exportDownload(
  userId: string | undefined,
  db: Db,
  origin: string,
  now: number,
): Promise<Response> {
  if (userId === undefined) {
    return new Response("Log in to export your data.", { status: 401 });
  }
  return exportResponse(await accountExport(db, userId, origin, now));
}
