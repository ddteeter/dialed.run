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
  wardrobeItems,
} from "../../db/schema-core";
import { env } from "../../env";
import { bandFloorC, bandLabel } from "../../lib/temperature";
import { observationsForRuns } from "./conditions";
import { followerCount, followingCount } from "./follows";

function db() {
  return drizzle(env.DIALED_CORE);
}

const RECENT_LIMIT = 20;
const HISTORY_LIMIT = 200;

interface CoverageBand {
  bandFloorC: number;
  label: string;
  cold: number;
  dialed: number;
  warm: number;
}

export interface OwnProfile {
  userId: string;
  displayName: string | undefined;
  cityLabel: string | undefined;
  thermalLevel: number | undefined;
  followerCount: number;
  followingCount: number;
  entryCount: number;
  coverage: CoverageBand[];
  mostWornItems: { itemId: string; name: string; wearCount: number }[];
  recentEntries: { entryId: string; createdAt: number; verdict: number | null }[];
}

const BAND_STEP_C = 5;

/**
 * Bands ascending by floor. The caller tracks the min/max floor it saw
 * while building `bands` so this never needs to iterate the map's keys to
 * sort them (no in-memory `.sort()`, per house lint rule).
 */
function bandsAscending(
  bands: ReadonlyMap<number, CoverageBand>,
  range: { min: number; max: number } | undefined,
): CoverageBand[] {
  if (!range) return [];
  const ordered: CoverageBand[] = [];
  for (let floor = range.min; floor <= range.max; floor += BAND_STEP_C) {
    const band = bands.get(floor);
    if (band) ordered.push(band);
  }
  return ordered;
}

/**
Top `n` entries by count, without an in-memory `.sort()` (house lint rule).
*/
function topEntriesByCount(
  counts: ReadonlyMap<string, number>,
  n: number,
): [string, number][] {
  const remaining = [...counts];
  const top: [string, number][] = [];
  for (let picked = 0; picked < n && remaining.length > 0; picked += 1) {
    let bestIndex = 0;
    for (let index = 1; index < remaining.length; index += 1) {
      const current = remaining[index];
      const best = remaining[bestIndex];
      if (current && best && current[1] > best[1]) bestIndex = index;
    }
    const [winner] = remaining.splice(bestIndex, 1);
    if (winner) top.push(winner);
  }
  return top;
}

export async function ownProfile(userId: string): Promise<OwnProfile> {
  const database = db();
  const [profile] = await database
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  const profileEntries = await database
    .select({
      id: outfitEntries.id,
      runId: outfitEntries.runId,
      verdict: outfitEntries.verdict,
      createdAt: outfitEntries.createdAt,
    })
    .from(outfitEntries)
    .where(eq(outfitEntries.userId, userId))
    .orderBy(desc(outfitEntries.createdAt))
    .limit(HISTORY_LIMIT);

  const profileRuns =
    profileEntries.length === 0
      ? []
      : await database
          .select({ id: runs.id, lat: runs.lat, lng: runs.lng, startedAt: runs.startedAt })
          .from(runs)
          .where(
            inArray(
              runs.id,
              profileEntries.map((e) => e.runId),
            ),
          );
  const observations = await observationsForRuns(profileRuns);

  const bands = new Map<number, CoverageBand>();
  let bandRange: { min: number; max: number } | undefined;
  for (const entry of profileEntries) {
    if (entry.verdict === null) continue;
    const observation = observations.get(entry.runId);
    if (!observation) continue;
    const floor = bandFloorC(observation.feelsLikeC);
    const band = bands.get(floor) ?? {
      bandFloorC: floor,
      label: bandLabel(floor, "f"),
      cold: 0,
      dialed: 0,
      warm: 0,
    };
    if (entry.verdict < 0) band.cold += 1;
    else if (entry.verdict > 0) band.warm += 1;
    else band.dialed += 1;
    bands.set(floor, band);
    bandRange = bandRange
      ? { min: Math.min(bandRange.min, floor), max: Math.max(bandRange.max, floor) }
      : { min: floor, max: floor };
  }

  const entryIds = profileEntries.map((e) => e.id);
  const itemRows =
    entryIds.length === 0
      ? []
      : await database
          .select({ itemId: outfitEntryItems.itemId })
          .from(outfitEntryItems)
          .where(inArray(outfitEntryItems.entryId, entryIds));
  const wearCounts = new Map<string, number>();
  for (const row of itemRows) {
    wearCounts.set(row.itemId, (wearCounts.get(row.itemId) ?? 0) + 1);
  }
  const topItemIds = topEntriesByCount(wearCounts, 5).map(([itemId]) => itemId);
  const topGarments =
    topItemIds.length === 0
      ? []
      : await database
          .select({ id: wardrobeItems.id, name: wardrobeItems.name })
          .from(wardrobeItems)
          .where(inArray(wardrobeItems.id, topItemIds));
  const nameById = new Map(topGarments.map((g) => [g.id, g.name]));

  const [followers, following] = await Promise.all([
    followerCount(userId),
    followingCount(userId),
  ]);

  return {
    userId,
    displayName: profile?.displayName ?? undefined,
    cityLabel: profile?.cityLabel ?? undefined,
    thermalLevel: profile?.thermalLevel ?? undefined,
    followerCount: followers,
    followingCount: following,
    entryCount: profileEntries.length,
    coverage: bandsAscending(bands, bandRange),
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
export async function otherProfile(userId: string): Promise<OtherProfile | undefined> {
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
    .where(and(eq(outfitEntries.userId, userId), eq(outfitEntries.isPublic, true)))
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
