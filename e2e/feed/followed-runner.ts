import { eq, inArray } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import { user } from "../../src/db/schema-auth";
import {
  entryTags,
  follows,
  outfitEntries,
  outfitEntryItems,
  runs,
  userProfiles,
  wardrobeItems,
} from "../../src/db/schema-core";
import { weatherObservations } from "../../src/db/schema-weather";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { seedEntry, seedFollow, seedRunner } from "../conformance/feed-support";
import type { Seeded } from "../conformance/feed-support";
import { withLocalDb } from "../support/local-db";

/**
 * The runner the feed journey finds, follows and reads: one public entry
 * (verdict, conditions, kit) and one private entry that must never
 * surface, in the follower's feed or on the runner's own profile.
 *
 * Scoped entirely to ids generated here, and removed by exactly those —
 * never a bare delete of these tables.
 */
export interface FollowedRunner {
  readonly userId: string;
  readonly username: string;
  readonly itemId: string;
  readonly publicRunId: string;
  readonly publicEntryId: string;
  readonly privateRunId: string;
  readonly privateEntryId: string;
  readonly observationIds: readonly string[];
}

/**
 * Where the runner ran, at the weather cache's two places: Portland.
 */
export const RUNNER_PLACE = { lat: 45.52, lng: -122.68 };

export async function seedFollowedRunner(): Promise<FollowedRunner> {
  const suffix = String(Date.now());
  const runner: FollowedRunner = {
    userId: newUlid(),
    username: `trail_${suffix.slice(-8)}`,
    itemId: newUlid(),
    publicRunId: newUlid(),
    publicEntryId: newUlid(),
    privateRunId: newUlid(),
    privateEntryId: newUlid(),
    observationIds: [newUlid(), newUlid(), newUlid()],
  };
  // Three hours back, so a two-hour run is entirely in the past.
  const startedAt = nowSeconds() - 3 * 3600;
  const { lat: latR, lng: lngR } = RUNNER_PLACE;
  const hourBucket = Math.floor(startedAt / 3600);

  await withLocalDb(async ({ core, weather }) => {
    // An account as sign-up and the confirm link leave it: search and H
    // show only runners whose address is confirmed (D-113 Q2).
    const joined = new Date(nowSeconds() * 1000);
    await core.insert(user).values({
      id: runner.userId,
      name: runner.username,
      email: `${runner.username}@example.com`,
      emailVerified: true,
      createdAt: joined,
      updatedAt: joined,
    });
    await core.insert(userProfiles).values({
      userId: runner.userId,
      username: runner.username,
      cityLabel: "Portland, OR",
    });

    await core.insert(wardrobeItems).values({
      id: runner.itemId,
      userId: runner.userId,
      category: "top",
      layer: "mid",
      brand: "Janji",
      name: "Rover Half-Zip",
      origin: "manual",
      createdAt: startedAt,
    });

    await core.insert(runs).values([
      {
        id: runner.publicRunId,
        userId: runner.userId,
        source: "manual",
        startedAt,
        // Two hours, so the run spans three hour buckets and the feed can
        // show what it actually covered rather than the hour it began in
        // (R-5). The caption is already written for a run that warms up.
        durationS: 2 * 3600,
        distanceM: 6437,
        lat: latR,
        lng: lngR,
        indoor: false,
        title: "Morning loop",
        weatherStatus: "attached",
      },
      {
        id: runner.privateRunId,
        userId: runner.userId,
        source: "manual",
        startedAt,
        durationS: 1500,
        distanceM: 5000,
        lat: latR,
        lng: lngR,
        indoor: false,
        title: "Private shakeout",
        weatherStatus: "attached",
      },
    ]);

    await core.insert(outfitEntries).values([
      {
        id: runner.publicEntryId,
        runId: runner.publicRunId,
        userId: runner.userId,
        verdict: 0,
        audience: "runners",
        createdAt: startedAt,
      },
      {
        id: runner.privateEntryId,
        runId: runner.privateRunId,
        userId: runner.userId,
        verdict: -1,
        audience: "private",
        createdAt: startedAt,
      },
    ]);

    await core
      .insert(outfitEntryItems)
      .values({ entryId: runner.publicEntryId, itemId: runner.itemId });
    await core
      .insert(entryTags)
      .values({ entryId: runner.publicEntryId, tag: "cold_first_mile" });

    // Weather is seeded, never stubbed: this cache-key row makes the feed
    // module hit cache and never call Visual Crossing, with the real code
    // path still running.
    // One row per hour the run spans — which is what `attach.ts` resolves
    // for a real run, and what the feed now reads back. Warming 6 -> 14
    // across the two hours: a chilly first mile that settles in.
    //
    // No row names the run: each is a shared cache cell, found by place
    // and hour, exactly as the attach path writes them.
    const readings = [
      {
        tempC: 6,
        feelsLikeC: 4,
        humidity: 70,
        windKph: 12,
        precipMm: 0.4,
        condition: "light rain",
      },
      {
        tempC: 10,
        feelsLikeC: 9,
        humidity: 65,
        windKph: 10,
        precipMm: 0,
        condition: "cloudy",
      },
      {
        tempC: 14,
        feelsLikeC: 13,
        humidity: 55,
        windKph: 8,
        precipMm: 0,
        condition: "clear",
      },
    ];
    await weather.insert(weatherObservations).values(
      readings.map((reading, hour) => ({
        ...reading,
        id: runner.observationIds[hour] ?? newUlid(),
        latR,
        lngR,
        hourBucket: hourBucket + hour,
        source: "visualcrossing" as const,
        fetchedAt: startedAt,
      })),
    );
  });
  return runner;
}

export async function removeFollowedRunner(
  runner: FollowedRunner,
): Promise<void> {
  const entryIds = [runner.publicEntryId, runner.privateEntryId];
  await withLocalDb(async ({ core, weather }) => {
    // Children first. Everything past the entries is the seeded runner's
    // own, so it goes by owner; the journey follows them, so the follow
    // goes too.
    const removeWhere = (table: SQLiteTable, condition: SQL) =>
      core.delete(table).where(condition);
    await core.batch([
      removeWhere(
        outfitEntryItems,
        inArray(outfitEntryItems.entryId, entryIds),
      ),
      removeWhere(entryTags, inArray(entryTags.entryId, entryIds)),
      removeWhere(outfitEntries, inArray(outfitEntries.id, entryIds)),
      removeWhere(follows, eq(follows.followeeId, runner.userId)),
      removeWhere(runs, eq(runs.userId, runner.userId)),
      removeWhere(wardrobeItems, eq(wardrobeItems.userId, runner.userId)),
      removeWhere(userProfiles, eq(userProfiles.userId, runner.userId)),
      removeWhere(user, eq(user.id, runner.userId)),
    ]);
    await weather
      .delete(weatherObservations)
      .where(inArray(weatherObservations.id, [...runner.observationIds]));
  });
}

/**
 * Someone the feed runner follows, with one shared entry: what makes the
 * feed open on Following with a post in it.
 */
export async function seedFollowedPost(
  rows: Seeded,
  viewerId: string,
): Promise<{ username: string; entryId: string }> {
  const username = `trail_${String(Date.now()).slice(-8)}`;
  const runnerId = await seedRunner(rows, username);
  const { entryId } = await seedEntry(rows, {
    userId: runnerId,
    place: RUNNER_PLACE,
    startedAt: nowSeconds() - 3 * 3600,
    verdict: 0,
  });
  await seedFollow(viewerId, runnerId);
  return { username, entryId };
}
