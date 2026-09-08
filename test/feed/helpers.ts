/**
 * Shared fixtures for feed-lane tests. Better Auth's `users` table isn't
 * FK-enforced from app tables yet (schema-core.ts comment), so tests use
 * plain ULIDs as user ids without creating real auth users.
 */
import { drizzle } from "drizzle-orm/d1";

import {
  entryTags,
  follows,
  notifications,
  outfitEntries,
  outfitEntryItems,
  reactions,
  runs,
  userProfiles,
  wardrobeItems,
} from "../../src/db/schema-core";
import { weatherObservations } from "../../src/db/schema-weather";
import { env } from "../../src/env";
import { cacheKeyFor } from "../../src/modules/feed/conditions";
import { newUlid } from "../../src/lib/ids";

export const NOW = 1_757_000_000;

function coreDb() {
  return drizzle(env.DIALED_CORE);
}

function weatherDb() {
  return drizzle(env.DIALED_WEATHER);
}

export async function makeUser(overrides?: {
  displayName?: string;
  shareDefault?: 0 | 1;
}): Promise<string> {
  const userId = newUlid();
  await coreDb()
    .insert(userProfiles)
    .values({
      userId,
      displayName: overrides?.displayName ?? `runner-${userId.slice(-6)}`,
      shareDefault: overrides?.shareDefault ?? 1,
    });
  return userId;
}

export async function makeRun(params: {
  userId: string;
  lat?: number;
  lng?: number;
  startedAt?: number;
}): Promise<string> {
  const runId = newUlid();
  await coreDb()
    .insert(runs)
    .values({
      id: runId,
      userId: params.userId,
      source: "manual",
      startedAt: params.startedAt ?? NOW,
      durationS: 1800,
      distanceM: 5000,
      lat: params.lat ?? 44.98,
      lng: params.lng ?? -93.27,
      title: "Test run",
    });
  return runId;
}

export async function makeItem(params: {
  userId: string;
  name?: string;
  category?: "top" | "bottom" | "headwear" | "neckwear" | "gloves" | "socks" | "shoes" | "accessory";
  layer?: "base" | "mid" | "outer";
}): Promise<string> {
  const itemId = newUlid();
  await coreDb()
    .insert(wardrobeItems)
    .values({
      id: itemId,
      userId: params.userId,
      category: params.category ?? "top",
      layer: params.layer,
      name: params.name ?? "Test garment",
      origin: "manual",
      createdAt: NOW,
    });
  return itemId;
}

/**
 * Directly inserts an outfit_entries (+ items) row with a controllable
 * `createdAt` — read-path tests (feed windows, consensus windows) need
 * precise timestamps that the real `attachKit` (which stamps `Date.now()`)
 * can't give them.
 */
export async function makeEntry(params: {
  userId: string;
  runId: string;
  isPublic?: 0 | 1;
  verdict?: number;
  createdAt?: number;
  itemIds?: string[];
}): Promise<string> {
  const entryId = newUlid();
  await coreDb()
    .insert(outfitEntries)
    .values({
      id: entryId,
      runId: params.runId,
      userId: params.userId,
      verdict: params.verdict,
      isPublic: params.isPublic ?? 1,
      createdAt: params.createdAt ?? NOW,
    });
  const itemIds = params.itemIds ?? [];
  if (itemIds.length > 0) {
    await coreDb()
      .insert(outfitEntryItems)
      .values(itemIds.map((itemId) => ({ entryId, itemId })));
  }
  return entryId;
}

/**
 * Storage persists across `it()` blocks within one test file (only the
 * whole file is isolated) — tests whose assertions depend on a global,
 * unscoped scan (consensus's "N of M" counts) need a clean slate rather
 * than relying on per-test-unique fixture data to avoid collisions.
 */
export async function resetTables(): Promise<void> {
  const core = coreDb();
  await core.delete(outfitEntryItems);
  await core.delete(entryTags);
  await core.delete(notifications);
  await core.delete(reactions);
  await core.delete(outfitEntries);
  await core.delete(runs);
  await core.delete(wardrobeItems);
  await core.delete(follows);
  await core.delete(userProfiles);
  await weatherDb().delete(weatherObservations);
}

export async function makeObservation(params: {
  lat: number;
  lng: number;
  startedAt: number;
  tempC: number;
  feelsLikeC: number;
  precipMm?: number;
  source?: "visualcrossing" | "manual";
}): Promise<void> {
  const key = cacheKeyFor(params.lat, params.lng, params.startedAt);
  await weatherDb()
    .insert(weatherObservations)
    .values({
      id: newUlid(),
      latR: key.latR,
      lngR: key.lngR,
      hourBucket: key.hourBucket,
      tempC: params.tempC,
      feelsLikeC: params.feelsLikeC,
      humidity: 50,
      windKph: 10,
      precipMm: params.precipMm ?? 0,
      condition: "clear",
      source: params.source ?? "visualcrossing",
      fetchedAt: NOW,
    });
}
