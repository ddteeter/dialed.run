/**
 * "Your conditions" (E2-lite, D-10/D-16): consensus block only, no stranger
 * cards. Bounded scan (docs/architecture.md): ≤200 core rows via the
 * `entries_public_created` covering index + ≤200 weather cache-key seeks.
 * `source='manual'` observations are excluded from the aggregate.
 *
 * Round 22 set the rules this module now keeps:
 *
 * - **Five runners or no aggregate.** A privacy floor, confirmed by the
 *   owner: at four, a block of "what they wore" is too easy to read one
 *   person out of. It counts **runners**, not entries — five posts by one
 *   runner are one runner.
 * - **Three days, widened once to fourteen**, and the screen says so.
 *   Still under five is "not enough runs yet".
 * - **The temperature band never widens.** Only the window does; a wider
 *   band would answer a different question ("what do people wear
 *   somewhere near this temperature").
 * - **A row under two runners is dropped**, for the floor's own reason.
 *
 * The viewer's own entries are left out: "what other runners wore" is the
 * question, and counting the viewer as one of the five would leave four
 * strangers behind a floor meant to be five.
 */
import { and, desc, eq, gte, inArray, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import {
  outfitEntries,
  outfitEntryItems,
  wardrobeItems,
} from "../../db/schema-core";
import { env } from "../../env";
import { readInChunks } from "../../lib/chunked";
import { precipClassOf } from "../../lib/temperature";
import type { PrecipClass } from "../../lib/temperature";
import type { Conditions } from "./conditions";
import { observationsForEntries, conditionsAt } from "./conditions";
import { judgedFeelsLikeC } from "./judged-conditions";
import type { UiGroup } from "./groups";
import { uiGroupFor, uiGroups } from "./groups";
import { publiclyVisibleEntry } from "../safety";

const SCAN_LIMIT = 200;
const DAY_S = 24 * 3600;

/**
The two windows, in days: the first look, and the one widening.
*/
export const WINDOW_DAYS = [3, 14] as const;
export type WindowDays = (typeof WINDOW_DAYS)[number];

/**
The band either side of the viewer's feels-like. It never widens.
*/
export const BAND_HALF_WIDTH_C = 3;

/**
Round 22's privacy floor: below this many runners, no aggregate at all.
*/
export const MIN_RUNNERS = 5;

/**
A garment group worn by fewer runners than this is not shown.
*/
export const MIN_GROUP_RUNNERS = 2;

export function recentPublicEntriesStatement(
  database: DrizzleD1Database,
  sinceEpochSeconds: number,
  viewerId?: string,
  limit = SCAN_LIMIT,
) {
  return database
    .select()
    .from(outfitEntries)
    .where(
      // publiclyVisibleEntry(), not a bare isPublic: a removed or
      // pending-review entry must not count toward the numbers everyone
      // reads (packet: "hidden content must not count"). A missed clause
      // here hides nothing visibly — it just quietly skews the aggregate.
      and(
        publiclyVisibleEntry(),
        gte(outfitEntries.createdAt, sinceEpochSeconds),
        viewerId === undefined ? undefined : ne(outfitEntries.userId, viewerId),
      ),
    )
    .orderBy(desc(outfitEntries.createdAt))
    .limit(limit);
}

/**
What the eyebrow says the block is matching: `[41–47°] · DAMP`.
*/
export interface ConsensusBand {
  minC: number;
  maxC: number;
  precip: PrecipClass;
}

export interface ConsensusGroup {
  group: UiGroup;
  runners: number;
}

/**
 * The block, or why there is none.
 *
 * `windowDays` is always there, because the eyebrow's window slot always
 * is: *"it read LAST 3 DAYS unwidened — the slot is always there"*.
 */
export type ConsensusResult =
  | {
      status: "matched";
      runners: number;
      groups: readonly ConsensusGroup[];
      windowDays: WindowDays;
      band: ConsensusBand;
    }
  | {
      status: "too-few";
      windowDays: WindowDays;
      band: ConsensusBand;
    };

/**
 * The two sides are deliberately asymmetric. The **entry** is compared at
 * the hour its runner actually judged by (`judgedFeelsLikeC`), because that
 * is the temperature their verdict is a statement about. The **viewer** is
 * a live reading with no verdict to be worst relative to, so it stays the
 * point it is. "What did people wear when it felt like it does to me now."
 */
function isWithinConsensusBand(
  observation: Conditions,
  verdict: number | null,
  viewer: Conditions,
): boolean {
  if (observation.source === "manual") return false;
  if (precipClassOf(observation.precipMm) !== precipClassOf(viewer.precipMm))
    return false;
  return (
    Math.abs(judgedFeelsLikeC(observation, verdict) - viewer.feelsLikeC) <=
    BAND_HALF_WIDTH_C
  );
}

/**
 * Who matched in a window, and which groups each of them wore.
 *
 * Runners, not entries: one runner's several matching posts are one voice.
 * A runner counts once in a group if any of their matching entries has a
 * garment in it.
 */
export interface MatchTally {
  runners: number;
  groups: Partial<Record<UiGroup, number>>;
}

export async function matchTally(
  viewer: Conditions,
  sinceEpochSeconds: number,
  viewerId?: string,
): Promise<MatchTally> {
  const database = drizzle(env.DIALED_CORE);
  const entries = await recentPublicEntriesStatement(
    database,
    sinceEpochSeconds,
    viewerId,
  );
  // Equivalent mutant: no entries means no observations and nothing to
  // filter, so the empty list comes out either way. The return saves the
  // cross-database walk.
  // Stryker disable next-line ConditionalExpression
  if (entries.length === 0) return { runners: 0, groups: {} };
  // In code rather than SQL: the observations live in DIALED_WEATHER, a
  // separate database D1 cannot join to (CLAUDE.md, D1 discipline).
  const observations = await observationsForEntries(database, entries);
  const matching = entries.filter((entry) => {
    const observation = observations.get(entry.runId);
    // Both halves matter: an entry whose conditions were never resolved
    // cannot be compared to the viewer's, and reading one anyway is a
    // crash on the consensus block rather than a miscount.
    return (
      observation !== undefined &&
      isWithinConsensusBand(observation, entry.verdict, viewer)
    );
  });
  return {
    runners: new Set(matching.map((entry) => entry.userId)).size,
    groups: await groupsByRunner(
      database,
      matching.map((entry) => entry.id),
    ),
  };
}

async function groupsByRunner(
  database: DrizzleD1Database,
  entryIds: readonly string[],
): Promise<Partial<Record<UiGroup, number>>> {
  // Both reads in chunks: up to 200 entries and every garment worn on
  // them, each past D1's 100-parameter cap for one statement. The join
  // brings each garment row its runner, so no row has to look one up.
  const itemRows = await readInChunks(entryIds, (chunk) =>
    database
      .select({
        itemId: outfitEntryItems.itemId,
        userId: outfitEntries.userId,
      })
      .from(outfitEntryItems)
      .innerJoin(outfitEntries, eq(outfitEntries.id, outfitEntryItems.entryId))
      .where(inArray(outfitEntryItems.entryId, chunk)),
  );
  const itemIds = [...new Set(itemRows.map((r) => r.itemId))];
  const garments = await readInChunks(itemIds, (chunk) =>
    database
      .select({
        id: wardrobeItems.id,
        category: wardrobeItems.category,
        layer: wardrobeItems.layer,
      })
      .from(wardrobeItems)
      .where(inArray(wardrobeItems.id, chunk)),
  );
  const groupByItemId = new Map(
    garments.map((g) => [g.id, uiGroupFor(g.category, g.layer)]),
  );

  // One runner counts at most once per group, however many entries or
  // items put them there.
  const runnersByGroup = new Map<UiGroup, Set<string>>();
  for (const row of itemRows) {
    const group = groupByItemId.get(row.itemId);
    // Equivalent mutant: `itemIds` is built from these very rows, so every
    // one of them has a group unless its garment was deleted between the
    // two reads. The guard is what keeps that race from writing an
    // `undefined` key into the counts.
    // Stryker disable next-line ConditionalExpression
    if (!group) continue;
    const runners = runnersByGroup.get(group) ?? new Set<string>();
    runners.add(row.userId);
    runnersByGroup.set(group, runners);
  }
  return Object.fromEntries(
    [...runnersByGroup].map(([group, runners]) => [group, runners.size]),
  );
}

/**
 * The groups worth a row: two runners or more, most-worn first, and the
 * closet's own group order between equals.
 */
export function shownGroups(
  groups: Partial<Record<UiGroup, number>>,
): ConsensusGroup[] {
  return uiGroups
    .map((group) => ({ group, runners: groups[group] ?? 0 }))
    .filter((row) => row.runners >= MIN_GROUP_RUNNERS)
    .toSorted((a, b) => b.runners - a.runners);
}

export async function yourConditionsConsensus(
  viewer: Conditions,
  nowEpochSeconds: number,
  viewerId?: string,
): Promise<ConsensusResult> {
  const band: ConsensusBand = {
    minC: viewer.feelsLikeC - BAND_HALF_WIDTH_C,
    maxC: viewer.feelsLikeC + BAND_HALF_WIDTH_C,
    precip: precipClassOf(viewer.precipMm),
  };
  for (const windowDays of WINDOW_DAYS) {
    const tally = await matchTally(
      viewer,
      nowEpochSeconds - windowDays * DAY_S,
      viewerId,
    );
    if (tally.runners >= MIN_RUNNERS) {
      return {
        status: "matched",
        runners: tally.runners,
        groups: shownGroups(tally.groups),
        windowDays,
        band,
      };
    }
  }
  // Every window has been tried, so the answer is the widest one's.
  return { status: "too-few", windowDays: 14, band };
}

/**
 * The consensus for a place, or nothing when its conditions cannot be
 * resolved.
 *
 * Law 5: the weather lane owns fetching a fresh observation, so a viewer
 * whose conditions are unknown gets no block rather than an error or an
 * empty one — an empty block claims nobody ran in these conditions, which
 * is a different statement from "we do not know what they are".
 */
export async function consensusAt(
  lat: number,
  lng: number,
  nowEpochSeconds: number,
  viewerId?: string,
): Promise<ConsensusResult | undefined> {
  const viewer = await conditionsAt(lat, lng, nowEpochSeconds);
  return viewer && yourConditionsConsensus(viewer, nowEpochSeconds, viewerId);
}
