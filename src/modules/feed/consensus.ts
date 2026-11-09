/**
 * "Your conditions" (E2-lite, D-10/D-16): consensus block only, no stranger
 * cards. The entries in the viewer's conditions in the window, found by
 * the copy of each run's judged conditions in core (`run_conditions`,
 * D-175, design 189) and its band index, so the read tracks the runs that
 * match rather than every shared run in the window. `source='manual'`
 * conditions are excluded from the aggregate.
 *
 * **No LIMIT, deliberately.** A `LIMIT 200` once answered "the matches
 * among the newest 200", hiding every runner in the viewer's conditions
 * behind a busy afternoon somewhere else (PR #102 review). The read is
 * bounded by the band and the window instead.
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
 *
 * **A runner who turned off "Count my runs in anonymous totals" is left
 * out too** (owner, 2026-10-12: U2's conditions pool folded into
 * `count_in_totals`). One switch covers the published totals and this
 * block, so their shared runs stop counting here at once. Their own view
 * is untouched: the block still works for them, since the viewer is never
 * counted anyway.
 */
import { and, eq, gte, inArray, lte, ne, notExists, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import {
  outfitEntries,
  runConditions,
  outfitEntryItems,
  userProfiles,
  wardrobeItems,
} from "../../db/schema-core";
import { coreDb } from "../../env";
import { readInChunks } from "../../lib/chunked";
import { precipClassOf } from "../../lib/contracts/temperature";
import type { PrecipClass } from "../../lib/contracts/temperature";
import type { Conditions } from "./conditions";
import { conditionsAt } from "./conditions";
import { garmentTypeOf } from "../../lib/contracts/garment-fields";
import type { GarmentType } from "../../lib/contracts/garment-fields";
import type { DialedType } from "./bar-share";
import type { UiGroup } from "./groups";
import { uiGroupFor, uiGroups } from "./groups";
import { publiclyVisibleEntry } from "../safety";
import { outfitEntriesSelect } from "./entries-query";

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

// Rhyme with profiles.ts's function of the same name, not a copy: this one
// is every runner's unbounded window for the aggregate above — deliberately
// unordered and un-LIMITed (a LIMIT here hid real matches behind a busy
// afternoon elsewhere, PR #102 review — see the module doc at the top of
// this file). profiles.ts's is a single runner's ordered, LIMITed recent
// page. Merging the two callers would recouple exactly what that PR pulled
// apart — but the `select`/`from` skeleton under both is shared once, via
// `outfitEntriesSelect` (entries-query.ts), rather than retyped here.
export function recentPublicEntriesStatement(
  database: DrizzleD1Database,
  sinceEpochSeconds: number,
  viewerId?: string,
) {
  // Only the five columns the tally reads: the window is unbounded by
  // count, so every column left out is paid for on every row of it.
  // `createdAt` is the sentence's tie-break, "dialed most recently".
  return outfitEntriesSelect(
    database,
    TALLY_COLUMNS,
    countableEntry(database, sinceEpochSeconds, viewerId),
  );
}

/**
The five columns of an entry the tally reads.
*/
const TALLY_COLUMNS = {
  id: outfitEntries.id,
  runId: outfitEntries.runId,
  userId: outfitEntries.userId,
  verdict: outfitEntries.verdict,
  createdAt: outfitEntries.createdAt,
};

/**
 * Which entries the consensus may count, read live from the entry and its
 * runner whatever narrowed the read (D-175): shared and in standing, in
 * the window, not the viewer's own, and not a runner who turned totals
 * off.
 */
function countableEntry(
  database: DrizzleD1Database,
  sinceEpochSeconds: number,
  viewerId?: string,
) {
  // publiclyVisibleEntry(), not a bare audience test: a removed or
  // pending-review entry must not count toward the numbers everyone
  // reads (packet: "hidden content must not count"). A missed clause
  // here hides nothing visibly — it just quietly skews the aggregate.
  return and(
    publiclyVisibleEntry(),
    gte(outfitEntries.createdAt, sinceEpochSeconds),
    viewerId === undefined ? undefined : ne(outfitEntries.userId, viewerId),
    countsInTotals(database),
  );
}

/**
 * The whole degrees a judged feels-like can floor to and still be within
 * `BAND_HALF_WIDTH_C` of the viewer's: what `run_conditions_band` seeks.
 * A bucket at an end can hold a run just outside the band, which the
 * exact check after it drops.
 */
export function bandBuckets(feelsLikeC: number): number[] {
  const lowest = Math.floor(feelsLikeC - BAND_HALF_WIDTH_C);
  const highest = Math.floor(feelsLikeC + BAND_HALF_WIDTH_C);
  return Array.from(
    { length: highest - lowest + 1 },
    (_unused, offset) => lowest + offset,
  );
}

/**
 * The entries in the viewer's conditions in the window, found by the copy
 * of their runs' conditions in core (\`run_conditions\`, D-175) rather
 * than by reading every shared entry in the window and then its weather.
 *
 * Driven from the copy's band index, so what it reads tracks the matches:
 * \`CROSS JOIN\` keeps SQLite from starting at the entries' window index
 * instead. The partial index's own terms are spelled as it spells them
 * (literals, not bound values), or SQLite cannot prove the index covers
 * the query. The entry and its runner are still read live
 * (\`countableEntry\`); the copy only says which runs are in the band.
 */
export function matchingEntriesStatement(
  database: DrizzleD1Database,
  viewer: Conditions,
  sinceEpochSeconds: number,
  viewerId?: string,
) {
  const copy = runConditions;
  const precipitation = precipClassOf(viewer.precipMm);
  const buckets = bandBuckets(viewer.feelsLikeC);
  const distance = sql`abs(${copy.judgedFeelsLikeC} - ${viewer.feelsLikeC})`;
  return database
    .select(TALLY_COLUMNS)
    .from(copy)
    .crossJoin(outfitEntries)
    .where(
      and(
        eq(copy.precipClass, precipitation),
        inArray(copy.judgedBucket, buckets),
        gte(copy.entryCreatedAt, sinceEpochSeconds),
        sql`${copy.entryShared} = 1`,
        sql`${copy.source} != 'manual'`,
        lte(distance, BAND_HALF_WIDTH_C),
        eq(outfitEntries.runId, copy.runId),
        countableEntry(database, sinceEpochSeconds, viewerId),
      ),
    );
}

/**
 * The entry's runner has not turned totals off — a correlated lookup by
 * the profile's primary key, once per entry in the window. NOT EXISTS
 * rather than a join on `count_in_totals = 1`, because nothing creates a
 * profile row at signup: a runner without one is counted, as the column's
 * default says (`docs/contracts.md`).
 */
function countsInTotals(database: DrizzleD1Database) {
  const thisRunnerOptedOut = and(
    eq(userProfiles.userId, outfitEntries.userId),
    eq(userProfiles.countInTotals, false),
  );
  return notExists(
    database
      .select({ one: sql`1` })
      .from(userProfiles)
      .where(thisRunnerOptedOut),
  );
}

/**
What the block says it matched (round 25): the band in the eyebrow,
`FEELS [41–47°] · DAMP`, and the viewer's own feels-like in the line,
"In 44° and damp".
*/
export interface ConsensusBand {
  feelsC: number;
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
      /**
      The dialed runners among them and the garment types they wore, two
      or more to a type: what the summary sentence says (round 47 #114,
      round 49 R49·137).
      */
      dialed: { runners: number; types: readonly DialedType[] };
      windowDays: WindowDays;
      band: ConsensusBand;
    }
  | {
      status: "too-few";
      windowDays: WindowDays;
      band: ConsensusBand;
    };

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
  /**
   * The matched runners who called it dialed, for the summary sentence
   * (round 47 #114): "Most got it right in …" is about the runners who got
   * it right. A runner is dialed if any of their matching entries is, and
   * the types here are those entries' alone. Types, not groups (R49·137a′):
   * matching still compares kits by group, only the sentence's words
   * change, and a piece with no type is not counted.
   */
  dialed: { runners: number; types: readonly DialedType[] };
}

export async function matchTally(
  viewer: Conditions,
  sinceEpochSeconds: number,
  viewerId?: string,
): Promise<MatchTally> {
  const database = coreDb();
  // The band, the precipitation, the manual exclusion and the judging
  // hour are all decided in SQL now, against the copy in core: no walk to
  // the weather database, and no row read for a run outside the band.
  const matching = await matchingEntriesStatement(
    database,
    viewer,
    sinceEpochSeconds,
    viewerId,
  );
  const dialed = matching.filter((entry) => entry.verdict === 0);
  const worn = await wornByRunner(
    database,
    matching.map((entry) => entry.id),
  );
  return tallyOf(matching, dialed, worn);
}

/**
The tally over the matched entries, the dialed ones among them, and what was
worn on the matched ones.
*/
function tallyOf(
  matching: readonly { id: string; userId: string }[],
  dialed: readonly { id: string; userId: string; createdAt: number }[],
  worn: readonly WornRow[],
): MatchTally {
  const dialedAt = new Map(dialed.map((entry) => [entry.id, entry.createdAt]));
  return {
    runners: runnersIn(matching),
    groups: groupCounts(worn),
    dialed: {
      runners: runnersIn(dialed),
      types: typeCounts(worn, dialedAt),
    },
  };
}

/**
Nobody matched: no runners, no groups, and nobody dialed.
*/
function runnersIn(entries: readonly { userId: string }[]): number {
  return new Set(entries.map((entry) => entry.userId)).size;
}

interface WornRow {
  entryId: string;
  userId: string;
  group: UiGroup;
  type: GarmentType | undefined;
}

/**
Each garment worn on these entries, as its entry, its runner and its group.
*/
async function wornByRunner(
  database: DrizzleD1Database,
  entryIds: readonly string[],
): Promise<WornRow[]> {
  // Both reads in chunks: every matching entry in the window and every
  // garment worn on them, each past D1's 100-parameter cap for one
  // statement. The join
  // brings each garment row its runner, so no row has to look one up.
  const itemRows = await readInChunks(entryIds, (chunk) =>
    // fallow-ignore-next-line code-duplication -- fallow 3.34 matches drizzle's select/from/join/where grammar across tables; groupsByRunner reads which runner wore each item in a chunk of entries for the conditions consensus
    database
      .select({
        itemId: outfitEntryItems.itemId,
        entryId: outfitEntryItems.entryId,
        userId: outfitEntries.userId,
      })
      .from(outfitEntryItems)
      .innerJoin(outfitEntries, eq(outfitEntries.id, outfitEntryItems.entryId))
      .where(inArray(outfitEntryItems.entryId, chunk)),
  );
  const garmentById = await garmentKinds(
    database,
    itemRows.map((r) => r.itemId),
  );

  const worn: WornRow[] = [];
  for (const row of itemRows) {
    const garment = garmentById.get(row.itemId);
    // Equivalent mutant: `itemIds` is built from these very rows, so every
    // one of them has a group unless its garment was deleted between the
    // two reads. The guard is what keeps that race from counting a group
    // of `undefined`.
    // Stryker disable next-line ConditionalExpression
    if (!garment) continue;
    worn.push({ entryId: row.entryId, userId: row.userId, ...garment });
  }
  return worn;
}

/**
What a garment row says about its kind: the columns the rail group and the
type are read from.
*/
const kindColumns = {
  id: wardrobeItems.id,
  category: wardrobeItems.category,
  layer: wardrobeItems.layer,
  type: wardrobeItems.type,
};

/**
Each garment's rail group and its type, by id, in chunks under D1's
parameter cap.
*/
async function garmentKinds(
  database: DrizzleD1Database,
  itemIds: readonly string[],
): Promise<Map<string, Pick<WornRow, "group" | "type">>> {
  const garments = await readInChunks([...new Set(itemIds)], (chunk) =>
    database
      .select(kindColumns)
      .from(wardrobeItems)
      .where(inArray(wardrobeItems.id, chunk)),
  );
  return new Map(
    garments.map((g) => [
      g.id,
      { group: uiGroupFor(g.category, g.layer), type: garmentTypeOf(g.type) },
    ]),
  );
}

/**
 * How many runners wore each group. One runner counts at most once per
 * group, however many entries or items put them there.
 */
function groupCounts(
  worn: readonly WornRow[],
): Partial<Record<UiGroup, number>> {
  const runnersByGroup = new Map<UiGroup, Set<string>>();
  for (const row of worn) {
    const runners = runnersByGroup.get(row.group) ?? new Set<string>();
    runners.add(row.userId);
    runnersByGroup.set(row.group, runners);
  }
  return Object.fromEntries(
    [...runnersByGroup].map(([group, runners]) => [group, runners.size]),
  );
}

/**
 * How many dialed runners wore each garment type, two or more to a type
 * (#114's fewer-than-2 rule, per type under R49·137b′), over the worn rows
 * of the dialed entries alone — `dialedAt` holds each one's time. A piece
 * with no type is not counted. Each type carries the earliest rail group
 * it was worn in, for the sentence's order, and the latest entry it was
 * dialed on, for its tie-break.
 */
function typeCounts(
  worn: readonly WornRow[],
  dialedAt: ReadonlyMap<string, number>,
): DialedType[] {
  const byType = new Map<
    GarmentType,
    { runners: Set<string>; group: UiGroup; lastDialedAt: number }
  >();
  // In rail order, so the first row a type is seen in carries its
  // earliest group.
  for (const row of worn.toSorted(byRail)) {
    const at = dialedAt.get(row.entryId);
    if (at === undefined || row.type === undefined) continue;
    const seen = byType.get(row.type);
    if (seen === undefined) {
      byType.set(row.type, {
        runners: new Set([row.userId]),
        group: row.group,
        lastDialedAt: at,
      });
      continue;
    }
    seen.runners.add(row.userId);
    seen.lastDialedAt = Math.max(seen.lastDialedAt, at);
  }
  return [...byType]
    .map(([type, seen]) => ({
      type,
      runners: seen.runners.size,
      group: seen.group,
      lastDialedAt: seen.lastDialedAt,
    }))
    .filter((row) => row.runners >= MIN_GROUP_RUNNERS)
    .toSorted(byRailThenCount);
}

/**
C's rail group order.
*/
function byRail(
  a: Readonly<{ group: UiGroup }>,
  b: Readonly<{ group: UiGroup }>,
): number {
  return uiGroups.indexOf(a.group) - uiGroups.indexOf(b.group);
}

/**
 * C's rail group order, then most-worn first, then the type's own name:
 * one order whatever order the rows were read in.
 */
function byRailThenCount(a: DialedType, b: DialedType): number {
  return byRail(a, b) || b.runners - a.runners || a.type.localeCompare(b.type);
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
    feelsC: viewer.feelsLikeC,
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
        dialed: tally.dialed,
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
