/**
 * Profiles (G own / H someone else's). Public at MVP — a documented
 * privacy decision (design doc "Open questions"), not an oversight: the
 * other-profile query strips everything but display info + recent public
 * entries (no aggregates, no offset translation).
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  outfitEntries,
  outfitEntryItems,
  runs,
  userProfiles,
} from "../../db/schema-core";
import { env } from "../../env";
import { garmentNamesByIds } from "./garment-names";
import { readInChunks } from "../../lib/chunked";
import { bandLabel } from "../../lib/temperature";
import { topByCount } from "../../lib/top-by-count";
import { observationsForEntries } from "./conditions";
import { recentOwnEntries } from "./own-history";
import { bandsAscending, tallyCoverage } from "./coverage";
import type { CoverageBand } from "./coverage";
import { unitsFor } from "./units";
import { countWhere } from "./count-where";
import { followerCount, followingCount } from "./follows";
import { publiclyVisibleEntry } from "../safety";

function db() {
  return drizzle(env.DIALED_CORE);
}

const RECENT_LIMIT = 20;

export interface OwnProfile {
  userId: string;
  displayName: string | undefined;
  cityLabel: string | undefined;
  thermalLevel: number | undefined;
  followerCount: number;
  followingCount: number;
  entryCount: number;
  /**
  Every run logged, entry or not — G's first count (round 22, "G New
  account"), and what decides whether G is on day one.
  */
  runCount: number;
  coverage: CoverageBand[];
  mostWornItems: { itemId: string; name: string; wearCount: number }[];
  recentEntries: {
    entryId: string;
    createdAt: number;
    verdict: number | null;
  }[];
}

/**
 * Bands ascending by floor. The caller tracks the min/max floor it saw
 * while building `bands` so this never needs to iterate the map's keys to
 * sort them (no in-memory `.sort()`, per house lint rule).
 */

export async function ownProfile(userId: string): Promise<OwnProfile> {
  const database = db();
  const [profile] = await database
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  const profileEntries = await recentOwnEntries(database, userId);
  const observations = await observationsForEntries(database, profileEntries);
  const units = await unitsFor(database, userId);

  const tally = tallyCoverage(profileEntries, observations, (floor) =>
    bandLabel(floor, units.temp),
  );

  const entryIds = profileEntries.map((e) => e.id);
  // In chunks: the history is up to 200 entries, past D1's 100-parameter
  // cap for one statement.
  const itemRows = await readInChunks(entryIds, (chunk) =>
    database
      .select({ itemId: outfitEntryItems.itemId })
      .from(outfitEntryItems)
      .where(inArray(outfitEntryItems.entryId, chunk)),
  );
  const wearCounts = new Map<string, number>();
  for (const row of itemRows) {
    wearCounts.set(row.itemId, (wearCounts.get(row.itemId) ?? 0) + 1);
  }
  const topItemIds = topByCount(wearCounts, 5).map(([itemId]) => itemId);
  const nameById = await garmentNamesByIds(database, topItemIds);

  const [followers, following, runCount] = await Promise.all([
    followerCount(userId),
    followingCount(userId),
    // `runs_user_started` leads with the user, so this counts from the
    // index alone — the same shape the follow counts take.
    countWhere(database, runs, eq(runs.userId, userId)),
  ]);

  return {
    userId,
    displayName: profile?.displayName ?? undefined,
    cityLabel: profile?.cityLabel ?? undefined,
    thermalLevel: profile?.thermalLevel ?? undefined,
    followerCount: followers,
    followingCount: following,
    entryCount: profileEntries.length,
    runCount,
    coverage: bandsAscending(tally),
    mostWornItems: topItemIds.map((itemId) => ({
      itemId,
      name: nameById.get(itemId) ?? "[removed item]",
      wearCount: wearCounts.get(itemId) ?? 0,
    })),
    recentEntries: profileEntries.slice(0, RECENT_LIMIT).map((e) => ({
      entryId: e.id,
      createdAt: e.createdAt,
      verdict: e.verdict,
    })),
  };
}

export interface OtherProfile {
  userId: string;
  displayName: string | null;
  cityLabel: string | null;
  recentPublicEntries: {
    entryId: string;
    createdAt: number;
    verdict: number | null;
    caption: string | null;
  }[];
}

/**
H v1: public info + recent PUBLIC entries only — no aggregates.
*/
export async function otherProfile(
  userId: string,
): Promise<OtherProfile | undefined> {
  const database = db();
  const [profile] = await database
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  if (!profile) return undefined;

  const entries = await database
    .select({
      id: outfitEntries.id,
      createdAt: outfitEntries.createdAt,
      verdict: outfitEntries.verdict,
      caption: outfitEntries.caption,
    })
    .from(outfitEntries)
    .where(and(eq(outfitEntries.userId, userId), publiclyVisibleEntry()))
    .orderBy(desc(outfitEntries.createdAt))
    .limit(RECENT_LIMIT);

  return {
    userId,
    displayName: profile.displayName,
    cityLabel: profile.cityLabel,
    recentPublicEntries: entries.map((e) => ({
      entryId: e.id,
      createdAt: e.createdAt,
      verdict: e.verdict,
      caption: e.caption,
    })),
  };
}
