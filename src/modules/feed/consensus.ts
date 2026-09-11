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
import { forIds } from "../../lib/for-ids";
import { precipClassOf } from "../../lib/temperature";
import type { Conditions } from "./conditions";
import { conditionsAt, observationsForEntries } from "./conditions";
import { judgedFeelsLikeC } from "./judged-conditions";
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

/**
 * The two sides are deliberately asymmetric. The **entry** is compared at
 * the hour its runner actually judged by (`judgedFeelsLikeC`), because that
 * is the temperature their verdict is a statement about. The **viewer** is
 * a live reading with no verdict to be worst relative to, so it stays the
 * point it is. "What did people wear when it felt like it does to me now."
 */
function isWithinConsensusWindow(
  observation: Conditions,
  verdict: number | null,
  viewer: Conditions,
  deltaC: number,
): boolean {
  if (observation.source === "manual") return false;
  if (precipClassOf(observation.precipMm) !== precipClassOf(viewer.precipMm)) return false;
  return (
    Math.abs(judgedFeelsLikeC(observation, verdict) - viewer.feelsLikeC) <=
    deltaC
  );
}

async function qualifyingEntryIdsInWindow(
  database: DrizzleD1Database,
  viewer: Conditions,
  sinceEpochSeconds: number,
  deltaC: number,
): Promise<string[]> {
  const entries = await recentPublicEntriesStatement(database, sinceEpochSeconds);
  // Equivalent mutant: no entries means no observations and nothing to
  // filter, so the empty list comes out either way. The return saves the
  // cross-database walk.
  // Stryker disable next-line ConditionalExpression
  if (entries.length === 0) return [];
  const observations = await observationsForEntries(database, entries);
  return entries
    .filter((entry) => {
      const observation = observations.get(entry.runId);
      // Both halves matter: an entry whose conditions were never resolved
      // cannot be compared to the viewer's, and reading one anyway is a
      // crash on the consensus block rather than a miscount.
      return (
        observation !== undefined &&
        isWithinConsensusWindow(observation, entry.verdict, viewer, deltaC)
      );
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
    // The two fallbacks are unreachable: `pass` indexes `WINDOW_H`, and
    // the two arrays are the same length by construction. They are here
    // because an index signature cannot promise that.
    // Stryker disable next-line LogicalOperator,UnaryOperator
    const deltaC = FEELS_LIKE_DELTA_C[pass] ?? FEELS_LIKE_DELTA_C.at(-1) ?? 3;
    const qualifyingEntryIds = await qualifyingEntryIdsInWindow(database, viewer, since, deltaC);
    // Widen before declaring empty. There was an `isLastPass` check here
    // as well, so the final pass returned its own empty result rather than
    // falling through; mutation testing showed the two paths produce the
    // same value, which is what a redundant branch looks like. Falling
    // through says it once.
    if (qualifyingEntryIds.length === 0) continue;
    const groups = await aggregateGroups(database, qualifyingEntryIds);
    return { total: qualifyingEntryIds.length, groups, widened: pass > 0 };
  }
  // Every window has been tried, so an empty answer is a widened one.
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
  const garments = await forIds(itemIds, () =>
    database
      .select({
        id: wardrobeItems.id,
        category: wardrobeItems.category,
        layer: wardrobeItems.layer,
      })
      .from(wardrobeItems)
      .where(inArray(wardrobeItems.id, itemIds)),
  );
  const groupByItemId = new Map(
    garments.map((g) => [g.id, uiGroupFor(g.category, g.layer)]),
  );

  // one entry counts at most once per group, even with multiple items in it
  const perEntryGroups = new Map<string, Set<UiGroup>>();
  for (const row of itemRows) {
    const group = groupByItemId.get(row.itemId);
    // Equivalent mutant: `itemIds` is built from these very rows, so every
    // one of them has a group unless its garment was deleted between the
    // two reads. The guard is what keeps that race from writing an
    // `undefined` key into the counts.
    // Stryker disable next-line ConditionalExpression
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

/**
 * The consensus for a place, or nothing when its conditions cannot be
 * resolved.
 *
 * Law 5: the weather lane owns fetching a fresh observation, so a viewer
 * whose conditions are unknown sees no consensus block rather than an
 * error or an empty one — an empty block claims nobody ran in these
 * conditions, which is a different statement from "we do not know what
 * they are".
 */
export async function consensusAt(
  lat: number,
  lng: number,
  nowEpochSeconds: number,
): Promise<ConsensusResult | undefined> {
  const viewer = await conditionsAt(lat, lng, nowEpochSeconds);
  if (viewer === undefined) return undefined;
  return yourConditionsConsensus(viewer, nowEpochSeconds);
}
