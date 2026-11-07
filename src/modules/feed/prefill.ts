/**
 * A2 prefill: "MOST LIKELY · FROM 43° DAMP, AUG 14" — the user's own most
 * recent entry with the nearest |feels-like delta| in the same precip
 * class as the run being attached now. Each past run is read at its worst
 * hour, the hour its own conditions are judged at (D-165).
 *
 * **Yes, this is the germ of the Call** — asked on review, and worth
 * saying out loud. "What did this runner wear the last time it felt like
 * this" is the question the Call answers; this is that question at
 * one-nearest-neighbour resolution, over the runner's own last 200
 * entries, with no learning and no confidence. Epic 200 is the trained
 * version, and when it arrives this is either its cold-start path or the
 * thing it replaces. It is not a second recommender: there is one notion
 * of "nearest conditions" in the codebase and it is `nearestMatch` below,
 * which the verdict backlog reads too. Scanned over the user's own last 200
 * entries (own history is small at MVP scale; still index-backed via
 * `entries_user_created`).
 */
import { eq } from "drizzle-orm";

import { outfitEntryItems } from "../../db/schema-core";
import { coreDb } from "../../env";
import { precipClassOf } from "../../lib/contracts/temperature";
import type { Conditions } from "./conditions";
import { observationsForEntries } from "./conditions";
import { judgedFeelsLikeC } from "./judged-conditions";
import { recentOwnEntries } from "./own-history";

export interface PrefillCandidate {
  entryId: string;
  itemIds: string[];
  conditions: Conditions;
  createdAt: number;
  feelsLikeDeltaC: number;
}

/**
 * One entry of the runner's own history, as much of it as the match needs.
 */
export interface HistoryEntry {
  id: string;
  runId: string;
  /**
   * What decides the hour the entry is read at (`judgedFeelsLikeC`).
   */
  verdict: number | null;
  createdAt: number;
}

/**
 * The winning entry, handed back whole rather than copied field by field.
 *
 * Generic on the caller's own row type so nothing is lost on the way out:
 * the backlog's history carries the day each kit was worn, and a
 * `BestMatch` that flattened the entry to three fields would have sent
 * that back through a lookup with an unreachable fallback on it.
 */
export interface BestMatch<T extends HistoryEntry = HistoryEntry> {
  entry: T;
  conditions: Conditions;
  feelsLikeDeltaC: number;
}

/**
 * The nearest prior entry to `target`, among a history already scanned.
 *
 * Pure, and separate from the scan above, because the verdict backlog asks
 * this question once per row against **one** history. Written inside
 * `nearestPriorEntry` it was a 200-row read per question; six rows of the
 * backlog would have been six scans of the same two hundred entries for
 * six answers that differ only in their target.
 *
 * `history` must be ordered newest first, which is what lets the
 * comparison be a strict `<` with no tie-break: the first entry at a given
 * delta is already the most recent one at that delta. There was a
 * `delta === best && createdAt > best.createdAt` clause here; mutation
 * testing showed it could never be true, which is what dead code looks
 * like from the outside.
 */
export function nearestMatch<T extends HistoryEntry>(
  history: readonly T[],
  observations: ReadonlyMap<string, Conditions>,
  target: Conditions,
): BestMatch<T> | undefined {
  const targetPrecip = precipClassOf(target.precipMm);

  let best: BestMatch<T> | undefined;
  for (const entry of history) {
    const observation = observations.get(entry.runId);
    if (!observation || precipClassOf(observation.precipMm) !== targetPrecip)
      continue;
    // A past run at its worst hour (D-165, owner 2026-11-06), as its
    // conditions are read everywhere else. The target is the run being
    // attached or awaiting a verdict: unrated, so its judged hour is the
    // starting one, `feelsLikeC` itself.
    const delta = Math.abs(
      judgedFeelsLikeC(observation, entry.verdict) - target.feelsLikeC,
    );
    if (!best || delta < best.feelsLikeDeltaC) {
      best = { entry, conditions: observation, feelsLikeDeltaC: delta };
    }
  }
  return best;
}

export async function nearestPriorEntry(
  userId: string,
  currentConditions: Conditions,
): Promise<PrefillCandidate | undefined> {
  const database = coreDb();
  const own = await recentOwnEntries(database, userId);
  // Equivalent mutant: an empty `inArray` matches nothing, so the loop
  // below would find no best and answer undefined anyway. The return saves
  // two queries on every attach by a runner with no history — which is
  // every runner's first one.
  // Stryker disable next-line ConditionalExpression
  if (own.length === 0) return undefined;

  // `observationsForEntries` is this exact walk — entry -> run ->
  // observation, assembled in code because DIALED_CORE and DIALED_WEATHER
  // are separate databases and D1 cannot join across them (law 8c). Its
  // own comment names three call sites that had copy-pasted it; this was a
  // fourth, and the copy is what the clone detector found.
  const observations = await observationsForEntries(database, own);
  const best = nearestMatch(own, observations, currentConditions);
  if (!best) return undefined;

  const items = await database
    .select({ itemId: outfitEntryItems.itemId })
    .from(outfitEntryItems)
    .where(eq(outfitEntryItems.entryId, best.entry.id));

  return {
    entryId: best.entry.id,
    itemIds: items.map((i) => i.itemId),
    conditions: best.conditions,
    createdAt: best.entry.createdAt,
    feelsLikeDeltaC: best.feelsLikeDeltaC,
  };
}
