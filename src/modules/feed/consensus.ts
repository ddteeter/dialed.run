/**
 * "Your conditions" (E2-lite, D-10/D-16): consensus block only, no stranger
 * cards. Bounded scan (docs/architecture.md): ≤200 core rows via the
 * `entries_public_created` covering index + ≤200 weather cache-key seeks.
 * `source='manual'` observations are excluded from the aggregate.
 */
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import {
  outfitEntries,
  outfitEntryItems,
  wardrobeItems,
} from "../../db/schema-core";
import { env } from "../../env";
import { precipClassOf } from "../../lib/temperature";
import type { Conditions } from "./conditions";
import { observationsForEntries } from "./conditions";
import type { UiGroup } from "./groups";
import { uiGroupFor } from "./groups";

const SCAN_LIMIT = 200;
const WINDOW_H = [72, 24 * 7] as const; // widen once before declaring empty
const FEELS_LIKE_DELTA_C = [3, 5] as const;

export function recentPublicEntriesStatement(
  database: DrizzleD1Database,
  sinceEpochSeconds: number,
  limit = SCAN_LIMIT,
) {
  return database
    .select()
    .from(outfitEntries)
    .where(
      and(eq(outfitEntries.isPublic, true), gte(outfitEntries.createdAt, sinceEpochSeconds)),
    )
    .orderBy(desc(outfitEntries.createdAt))
    .limit(limit);
}

export interface ConsensusResult {
  /**
  Number of qualifying entries the group counts are "out of".
  */
  total: number;
  groups: Partial<Record<UiGroup, number>>;
  /**
  True when the 72h/±3°C window was empty and had to be widened.
  */
  widened: boolean;
}

function isWithinConsensusWindow(observation: Conditions, viewer: Conditions, deltaC: number): boolean {
  if (observation.source === "manual") return false;
  if (precipClassOf(observation.precipMm) !== precipClassOf(viewer.precipMm)) return false;
  return Math.abs(observation.feelsLikeC - viewer.feelsLikeC) <= deltaC;
}

async function qualifyingEntryIdsInWindow(
  database: DrizzleD1Database,
  viewer: Conditions,
  sinceEpochSeconds: number,
  deltaC: number,
): Promise<string[]> {
  const entries = await recentPublicEntriesStatement(database, sinceEpochSeconds);
  if (entries.length === 0) return [];
  const observations = await observationsForEntries(database, entries);
  return entries
    .filter((entry) => {
      const observation = observations.get(entry.runId);
      return observation !== undefined && isWithinConsensusWindow(observation, viewer, deltaC);
    })
    .map((entry) => entry.id);
}

export async function yourConditionsConsensus(
  viewer: Conditions,
  nowEpochSeconds: number,
): Promise<ConsensusResult> {
  const database = drizzle(env.DIALED_CORE);

  for (const [pass, windowHours] of WINDOW_H.entries()) {
    const since = nowEpochSeconds - windowHours * 3600;
    const deltaC = FEELS_LIKE_DELTA_C[pass] ?? FEELS_LIKE_DELTA_C.at(-1) ?? 3;
    const qualifyingEntryIds = await qualifyingEntryIdsInWindow(database, viewer, since, deltaC);
    const isLastPass = pass === WINDOW_H.length - 1;
    if (!isLastPass && qualifyingEntryIds.length === 0) continue; // widen once before declaring empty
    const groups = await aggregateGroups(database, qualifyingEntryIds);
    return { total: qualifyingEntryIds.length, groups, widened: pass > 0 };
  }
  return { total: 0, groups: {}, widened: true };
}

async function aggregateGroups(
  database: DrizzleD1Database,
  entryIds: readonly string[],
): Promise<Partial<Record<UiGroup, number>>> {
  const itemRows = await database
    .select()
    .from(outfitEntryItems)
    .where(inArray(outfitEntryItems.entryId, [...entryIds]));
  const itemIds = [...new Set(itemRows.map((r) => r.itemId))];
  const garments =
    itemIds.length === 0
      ? []
      : await database
          .select({
            id: wardrobeItems.id,
            category: wardrobeItems.category,
            layer: wardrobeItems.layer,
          })
          .from(wardrobeItems)
          .where(inArray(wardrobeItems.id, itemIds));
  const groupByItemId = new Map(
    garments.map((g) => [g.id, uiGroupFor(g.category, g.layer)]),
  );

  // one entry counts at most once per group, even with multiple items in it
  const perEntryGroups = new Map<string, Set<UiGroup>>();
  for (const row of itemRows) {
    const group = groupByItemId.get(row.itemId);
    if (!group) continue;
    const set = perEntryGroups.get(row.entryId) ?? new Set<UiGroup>();
    set.add(group);
    perEntryGroups.set(row.entryId, set);
  }
  const counts: Partial<Record<UiGroup, number>> = {};
  for (const groups of perEntryGroups.values()) {
    for (const group of groups) {
      counts[group] = (counts[group] ?? 0) + 1;
    }
  }
  return counts;
}
