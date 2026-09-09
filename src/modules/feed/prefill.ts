/**
 * A2 prefill: "MOST LIKELY · FROM 43° DAMP, AUG 14" — the user's own most
 * recent entry with the nearest |feels-like delta| in the same precip
 * class as the run being attached now. Scanned over the user's own last 200
 * entries (own history is small at MVP scale; still index-backed via
 * `entries_user_created`).
 */
import { desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { outfitEntries, outfitEntryItems, runs } from "../../db/schema-core";
import { env } from "../../env";
import { precipClassOf } from "../../lib/temperature";
import type { Conditions } from "./conditions";
import { conditionsAt, observationsForRuns } from "./conditions";

const HISTORY_LIMIT = 200;

export interface PrefillCandidate {
  entryId: string;
  itemIds: string[];
  conditions: Conditions;
  createdAt: number;
  feelsLikeDeltaC: number;
}

interface BestMatch {
  entryId: string;
  runId: string;
  conditions: Conditions;
  createdAt: number;
  feelsLikeDeltaC: number;
}

export async function nearestPriorEntry(
  userId: string,
  currentConditions: Conditions,
): Promise<PrefillCandidate | undefined> {
  const database = drizzle(env.DIALED_CORE);
  const own = await database
    .select({
      id: outfitEntries.id,
      runId: outfitEntries.runId,
      createdAt: outfitEntries.createdAt,
    })
    .from(outfitEntries)
    .where(eq(outfitEntries.userId, userId))
    .orderBy(desc(outfitEntries.createdAt))
    .limit(HISTORY_LIMIT);
  // Equivalent mutant: an empty `inArray` matches nothing, so the loop
  // below would find no best and answer undefined anyway. The return saves
  // two queries on every attach by a runner with no history — which is
  // every runner's first one.
  // Stryker disable next-line ConditionalExpression
  if (own.length === 0) return undefined;

  const ownRuns = await database
    .select({ id: runs.id, lat: runs.lat, lng: runs.lng, startedAt: runs.startedAt })
    .from(runs)
    .where(
      inArray(
        runs.id,
        own.map((e) => e.runId),
      ),
    );
  const observations = await observationsForRuns(ownRuns);
  const targetPrecip = precipClassOf(currentConditions.precipMm);

  let best: BestMatch | undefined;
  for (const entry of own) {
    const observation = observations.get(entry.runId);
    if (!observation) continue;
    if (precipClassOf(observation.precipMm) !== targetPrecip) continue;
    const delta = Math.abs(observation.feelsLikeC - currentConditions.feelsLikeC);
    // `<`, and no tie-break: `own` is already ordered newest first, so the
    // first entry at a given delta is the most recent one at that delta and
    // a strictly-smaller delta is the only reason to replace it. There was
    // a `delta === best && createdAt > best.createdAt` clause here; mutation
    // testing showed it could never be true, which is what dead code looks
    // like from the outside.
    if (!best || delta < best.feelsLikeDeltaC) {
      best = {
        entryId: entry.id,
        runId: entry.runId,
        conditions: observation,
        createdAt: entry.createdAt,
        feelsLikeDeltaC: delta,
      };
    }
  }
  if (!best) return undefined;

  const items = await database
    .select({ itemId: outfitEntryItems.itemId })
    .from(outfitEntryItems)
    .where(eq(outfitEntryItems.entryId, best.entryId));

  return {
    entryId: best.entryId,
    itemIds: items.map((i) => i.itemId),
    conditions: best.conditions,
    createdAt: best.createdAt,
    feelsLikeDeltaC: best.feelsLikeDeltaC,
  };
}

/**
 * The nearest prior entry for a place, or nothing when the conditions
 * there cannot be resolved.
 *
 * A prefill without conditions has nothing to be near, so this returns
 * nothing rather than guessing — the form falls back to the picker.
 */
export async function prefillAt(
  userId: string,
  lat: number,
  lng: number,
  nowEpochSeconds: number,
): Promise<PrefillCandidate | undefined> {
  const conditions = await conditionsAt(lat, lng, nowEpochSeconds);
  if (conditions === undefined) return undefined;
  return nearestPriorEntry(userId, conditions);
}
