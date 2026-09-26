import { and, eq, inArray, or } from "drizzle-orm";
import type { Column } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Page } from "@playwright/test";

import {
  entryPhotos,
  entryTags,
  follows,
  notifications,
  outfitEntries,
  outfitEntryItems,
  runs,
  userProfiles,
  wardrobeItems,
} from "../../src/db/schema-core";
import { weatherObservations } from "../../src/db/schema-weather";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { withLocalDb } from "../support/local-db";
import { userIdOf } from "./logging-fixtures";

/**
 * What the feed lane's conformance specs share: who the signed-in runner
 * is, rows seeded for one spec and removed after it, and the two readings
 * the harness does not already take — a region's `data-part` order, and
 * one element's own fill.
 *
 * Every spec seeds with ids it generated and deletes exactly those, never
 * a bare table, because the local database is shared with every other
 * spec and demo in the run.
 */

/**
The `feed` demo account's user id — the runner these specs sign in as.
*/
export async function feedUserId(): Promise<string> {
  return userIdOf("feed");
}

/**
 * Leaves the runner following nobody and followed by nobody, which is what
 * "day one" and "no follows" mean — whatever an earlier spec or demo in
 * the same run left behind.
 */
export async function unfollowEveryone(userId: string): Promise<void> {
  await withLocalDb(async ({ core }) => {
    await core
      .delete(follows)
      .where(
        or(eq(follows.followerId, userId), eq(follows.followeeId, userId)),
      );
  });
}

/**
The ids one spec seeded, so it can remove exactly those.
*/
export interface Seeded {
  runners: string[];
  runs: string[];
  entries: string[];
  items: string[];
  photos: string[];
  observations: string[];
  notifications: string[];
}

export function seeded(): Seeded {
  return {
    runners: [],
    runs: [],
    entries: [],
    items: [],
    photos: [],
    observations: [],
    notifications: [],
  };
}

/**
A new id, remembered under the table it is about to be written to.
*/
function minted(ids: string[]): string {
  const id = newUlid();
  ids.push(id);
  return id;
}

/**
 * Deletes every row of `table` whose `column` is one of `ids` — the one
 * shape every teardown statement in `removeSeeded` shares. An empty `ids`
 * deletes nothing.
 */
async function deleteByIds(
  db: DrizzleD1Database,
  table: SQLiteTable,
  column: Column,
  ids: readonly string[],
): Promise<void> {
  await db.delete(table).where(inArray(column, ids));
}

export async function removeSeeded(rows: Seeded): Promise<void> {
  // Children before parents: each table, the column that names the seeded
  // rows, and which of the seeded id lists those are.
  const coreTeardown: readonly [SQLiteTable, Column, readonly string[]][] = [
    [entryPhotos, entryPhotos.id, rows.photos],
    [entryTags, entryTags.entryId, rows.entries],
    [outfitEntryItems, outfitEntryItems.entryId, rows.entries],
    [outfitEntries, outfitEntries.id, rows.entries],
    [runs, runs.id, rows.runs],
    [wardrobeItems, wardrobeItems.id, rows.items],
    [follows, follows.followeeId, rows.runners],
    [userProfiles, userProfiles.userId, rows.runners],
    [notifications, notifications.id, rows.notifications],
    // What the app wrote *about* a seeded entry: opening one's own sparse
    // entry records a `verdict_prompt` row (`recordVerdictPrompted`), and
    // left behind it sat unread among M's seeded rows, so M read three
    // rows as white where the board draws the third on the paper.
    [notifications, notifications.subjectId, rows.entries],
  ];
  await withLocalDb(async ({ core, weather }) => {
    for (const [table, column, ids] of coreTeardown) {
      await deleteByIds(core, table, column, ids);
    }
    await deleteByIds(
      weather,
      weatherObservations,
      weatherObservations.id,
      rows.observations,
    );
  });
}

/**
 * A reading at a place and hour, exactly as the attach path caches one.
 * `lat`/`lng` are taken as already rounded to the cache's two places.
 */
export async function seedObservation(
  rows: Seeded,
  place: { lat: number; lng: number },
  at: number,
  reading: { feelsLikeC: number; precipMm?: number; condition?: string },
  runId?: string,
): Promise<void> {
  const observation = {
    id: minted(rows.observations),
    runId,
    latR: place.lat,
    lngR: place.lng,
    hourBucket: Math.floor(at / 3600),
    tempC: reading.feelsLikeC + 1,
    feelsLikeC: reading.feelsLikeC,
    humidity: 60,
    windKph: 10,
    precipMm: reading.precipMm ?? 0,
    condition: reading.condition ?? "clear",
    source: "visualcrossing" as const,
    fetchedAt: nowSeconds(),
  };
  await withLocalDb(async ({ weather }) => {
    // A run killed mid-spec leaves its reading behind, and the cache key
    // is unique: take the cell back before claiming it.
    await weather
      .delete(weatherObservations)
      .where(
        and(
          eq(weatherObservations.latR, observation.latR),
          eq(weatherObservations.lngR, observation.lngR),
          eq(weatherObservations.hourBucket, observation.hourBucket),
        ),
      );
    await weather.insert(weatherObservations).values(observation);
  });
}

export interface EntrySeed {
  userId: string;
  place: { lat: number; lng: number };
  startedAt: number;
  feelsLikeC?: number;
  verdict?: number;
  isPublic?: boolean;
  isIndoor?: boolean;
  caption?: string;
  category?: "top" | "bottom" | "gloves";
  itemName?: string;
  tags?: ("hands_cold" | "overheated_late" | "chafed")[];
}

/**
 * A runner's run and its entry, public by default, with one garment worn
 * and, when `feelsLikeC` is given, the reading at its start.
 */
export async function seedEntry(
  rows: Seeded,
  params: EntrySeed,
): Promise<{ runId: string; entryId: string }> {
  const runId = minted(rows.runs);
  const entryId = minted(rows.entries);
  const itemId = minted(rows.items);
  await withLocalDb(async ({ core }) => {
    await core.insert(wardrobeItems).values({
      id: itemId,
      userId: params.userId,
      name: params.itemName ?? "Long sleeve",
      category: params.category ?? "top",
      origin: "manual",
      createdAt: params.startedAt,
    });
    await core.insert(runs).values({
      id: runId,
      userId: params.userId,
      title: "Conformance",
      source: "manual",
      startedAt: params.startedAt,
      durationS: 2600,
      distanceM: 8047,
      lat: params.place.lat,
      lng: params.place.lng,
      indoor: params.isIndoor ?? false,
      weatherStatus: "attached",
    });
    await core.insert(outfitEntries).values({
      id: entryId,
      userId: params.userId,
      runId,
      verdict: params.verdict,
      isPublic: params.isPublic ?? true,
      caption: params.caption,
      createdAt: params.startedAt,
    });
    await core.insert(outfitEntryItems).values({ entryId, itemId });
    const tags = params.tags ?? [];
    for (const tag of tags) {
      await core.insert(entryTags).values({ entryId, tag });
    }
  });
  if (params.feelsLikeC !== undefined) {
    await seedObservation(
      rows,
      params.place,
      params.startedAt,
      { feelsLikeC: params.feelsLikeC },
      runId,
    );
  }
  return { runId, entryId };
}

/**
 * Inserts one row through Drizzle — the shape every seed helper below
 * shares once the minted id and the table-specific fields are set.
 */
async function insertRow<TTable extends SQLiteTable>(
  table: TTable,
  values: TTable["$inferInsert"],
): Promise<void> {
  await withLocalDb(({ core }) => core.insert(table).values(values));
}

/**
A photo on an entry, passed by the screen, so strangers see it too.
*/
export async function seedPhoto(rows: Seeded, entryId: string): Promise<void> {
  const id = minted(rows.photos);
  await insertRow(entryPhotos, {
    id,
    entryId,
    photoKey: `conformance/${id}.jpg`,
    position: 0,
    screenStatus: "pass",
  });
}

/**
A runner with a public profile and nothing else — no account, no session.
*/
export async function seedRunner(
  rows: Seeded,
  displayName: string,
): Promise<string> {
  const userId = minted(rows.runners);
  await insertRow(userProfiles, { userId, displayName });
  return userId;
}

/**
`followerId` follows `followeeId`, removed with the followee.
*/
export async function seedFollow(
  followerId: string,
  followeeId: string,
): Promise<void> {
  await insertRow(follows, {
    followerId,
    followeeId,
    createdAt: nowSeconds(),
  });
}

/**
 * The `data-part` names inside a region, in document order — the
 * composition question for a screen whose words are data: "is the photo
 * above the caption", not "does the caption say what the board's does".
 */
export async function partsIn(
  page: Page,
  selector: string,
): Promise<readonly string[]> {
  return page.$$eval(`${selector} [data-part]`, (elements) =>
    elements.map((element) => (element as HTMLElement).dataset.part ?? ""),
  );
}

/**
 * The board sets straight apostrophes; the app sets typographic ones. The
 * same word either way, so the comparison folds them.
 */
export function folded(cells: readonly string[]): string[] {
  return cells.map((cell) => cell.replaceAll("’", "'"));
}

/**
 * A route handler that never answers, for holding a screen in its waiting
 * state: the request stays in flight for as long as the spec looks.
 */
export function holdForever(): Promise<void> {
  return Promise.withResolvers<undefined>().promise;
}
