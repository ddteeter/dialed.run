import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { outfitEntries, outfitEntryItems, runs } from "../../db/schema-core";
import { env } from "../../env";
import type { Conditions } from "./conditions";
import { observationsForEntries, observationsForRuns } from "./conditions";
import { attachKit, submitVerdict } from "./entries";
import { garmentNamesByIds } from "./garment-names";
import { nearestMatch, type BestMatch, type HistoryEntry } from "./prefill";
import { isPublicByDefault } from "./share-default";
import { forIds } from "../../lib/for-ids";

/**
 * DS2 — the verdict backlog's reads.
 *
 * *"A row per imported run with no outfit. Each row is A3's three inputs
 * laid flat — outfit, verdict, save — **not a new form**."* So nothing
 * here writes: saving a row is `attachKit` followed by `submitVerdict`,
 * the same two calls the phone flow makes, and this module only assembles
 * what the table needs to show.
 *
 * It lives in `modules/feed` because outfit entries, verdicts and the
 * prefill are the feed's; the table that renders it is
 * `modules/runs/components/VerdictBacklog`, which is the packet's
 * ownership. The two meet at the module barrel.
 */

/**
 * How many rows the table will show.
 *
 * A backlog is by definition old news, and a runner with two hundred
 * unjudged runs is not going to clear them in one sitting — the contract's
 * own example is six. The cap is here so the LIMIT is in SQL rather than
 * in a `.slice()` over rows D1 has already scanned and billed for.
 */
const BACKLOG_LIMIT = 50;

/**
 * How much history the suggestion looks back over — the same window
 * `nearestPriorEntry` uses, and for the same reason: own history is small
 * at MVP scale and the read is index-backed via `entries_user_created`.
 */
const HISTORY_LIMIT = 200;

/**
 * What the outfit cell offers: *"Same as Monday? Use · Pick"*.
 *
 * The names travel with the ids because the cell draws the kit as chips.
 * Reading them in the component would mean a component making a server
 * call, which it may not.
 */
export interface BacklogSuggestion {
  entryId: string;
  itemIds: readonly string[];
  itemNames: readonly string[];
  /**
  When the run that kit was worn on started, so the cell can say which day
  it is offering rather than "a previous run".
  */
  wornAt: number;
}

export interface BacklogRow {
  runId: string;
  startedAt: number;
  durationS: number;
  distanceM: number;
  /**
  Absent when no observation resolved — an indoor run, or one the hourly
  cron has not caught up with. The row is still judgeable; it just has
  nothing to be near, so it gets no suggestion either.
  */
  conditions: Conditions | undefined;
  suggestion: BacklogSuggestion | undefined;
}

export interface Backlog {
  rows: readonly BacklogRow[];
  /**
   * The runner's own sharing default, carried once for the page rather
   * than read per save.
   *
   * `attachKit` already applies it when it creates the entry; this is
   * here because `submitVerdict` takes `isPublic` explicitly and the
   * backlog row has no sharing control of its own. Reading it per row
   * would be one query per save to learn something that cannot change
   * while the table is open.
   */
  isPublicByDefault: boolean;
}

/**
 * Runs this runner has logged that carry no outfit entry, oldest first.
 *
 * A LEFT JOIN with `IS NULL` rather than a `NOT IN (SELECT …)`: both
 * sides are index-backed — `runs_user_started` for the scan and the
 * UNIQUE `entries_run` for the probe — and the anti-join lets D1 stop at
 * the first matching entry per run instead of materialising every entry
 * id the runner has.
 *
 * **No filter on `source`.** DS2 calls these "imported from Strava",
 * which is where a backlog comes from in practice, but a run without an
 * outfit is a run without an outfit however it arrived — and a manual run
 * abandoned halfway through the flow leaves exactly this row. Filtering
 * on source would hide it with nothing to say so.
 */
async function unjudgedRuns(userId: string) {
  return drizzle(env.DIALED_CORE)
    .select({
      id: runs.id,
      startedAt: runs.startedAt,
      durationS: runs.durationS,
      distanceM: runs.distanceM,
      lat: runs.lat,
      lng: runs.lng,
    })
    .from(runs)
    .leftJoin(outfitEntries, eq(outfitEntries.runId, runs.id))
    .where(and(eq(runs.userId, userId), isNull(outfitEntries.id)))
    .orderBy(asc(runs.startedAt))
    .limit(BACKLOG_LIMIT);
}

/**
 * The runner's own recent entries, with the run each was worn on.
 *
 * One read for the whole table. `nearestMatch` is then asked once per row
 * against this one history, which is the reason it is a pure function
 * separate from `nearestPriorEntry`'s scan.
 */
async function ownHistory(userId: string): Promise<
  (HistoryEntry & {
    wornAt: number;
  })[]
> {
  return drizzle(env.DIALED_CORE)
    .select({
      id: outfitEntries.id,
      runId: outfitEntries.runId,
      createdAt: outfitEntries.createdAt,
      wornAt: runs.startedAt,
    })
    .from(outfitEntries)
    .innerJoin(runs, eq(runs.id, outfitEntries.runId))
    .where(eq(outfitEntries.userId, userId))
    .orderBy(desc(outfitEntries.createdAt))
    .limit(HISTORY_LIMIT);
}

/**
 * The kits behind a set of suggested entries, as ids and as names.
 *
 * Two reads for the whole table rather than two per row: the entries are
 * asked for together and the garments they name are asked for together
 * after that.
 */
interface Kit {
  itemIds: string[];
  itemNames: string[];
}

async function kitsFor(
  entryIds: readonly string[],
): Promise<Map<string, Kit>> {
  const database = drizzle(env.DIALED_CORE);
  // fallow-ignore-next-line code-duplication -- the forIds+inArray shape rhymes with garmentNamesByIds, but against a different table for a different key (entry ids -> item pairs, not item ids -> names); a shared helper would need to be generic over its own projection, which garment-names.ts's own header already argues against for the similar case of consensus.ts
  const rows = await forIds(entryIds, () =>
    database
      .select({
        entryId: outfitEntryItems.entryId,
        itemId: outfitEntryItems.itemId,
      })
      .from(outfitEntryItems)
      .where(inArray(outfitEntryItems.entryId, [...entryIds])),
  );
  const names = await garmentNamesByIds(
    database,
    rows.map((row) => row.itemId),
  );

  const kits = new Map<string, Kit>();
  for (const row of rows) {
    const kit = kits.get(row.entryId) ?? { itemIds: [], itemNames: [] };
    kit.itemIds.push(row.itemId);
    // A garment the runner has since deleted leaves its id on the entry
    // with no row to name it. The chip is dropped rather than drawn empty;
    // the id stays, so "Use" still attaches what was actually worn.
    const name = names.get(row.itemId);
    if (name !== undefined) kit.itemNames.push(name);
    kits.set(row.entryId, kit);
  }
  return kits;
}

/**
 * How many runs are waiting, for the feed's "Clear the queue ›".
 *
 * A count rather than the rows: the link needs one number and the table
 * needs everything, and running the full assembly to decide whether to
 * draw a link would cost three reads and a weather round trip on every
 * feed load.
 *
 * The cap is the table's, so the number never promises more than the
 * table will show.
 */
export async function unjudgedRunCount(userId: string): Promise<number> {
  const waiting = await unjudgedRuns(userId);
  return waiting.length;
}

export async function verdictBacklog(userId: string): Promise<Backlog> {
  const database = drizzle(env.DIALED_CORE);
  const [unjudged, isPublic] = await Promise.all([
    unjudgedRuns(userId),
    isPublicByDefault(database, userId),
  ]);

  // **No early return for an empty backlog**, deliberately. One would
  // save `ownHistory` a query — the two weather reads already guard
  // themselves — but it cannot change the answer, because an empty list
  // produces no rows through every step below. That is an equivalent
  // mutant by construction, and the guard is not worth a suppression for
  // one indexed read on a page nobody reaches empty: the queue is only
  // linked from the feed when `isBacklogWorthOpening` says two or more.
  //
  // Conditions for the rows, and conditions for the history the
  // suggestion is drawn from. Two batched reads against DIALED_WEATHER,
  // assembled in code because it is a separate database from DIALED_CORE
  // and D1 cannot join across them (CLAUDE.md law 8c).
  const history = await ownHistory(userId);
  const [rowConditions, historyConditions] = await Promise.all([
    observationsForRuns(unjudged),
    observationsForEntries(database, history),
  ]);

  const matched = unjudged.map((run) => {
    const conditions = rowConditions.get(run.id);
    return {
      run,
      conditions,
      best:
        conditions === undefined
          ? undefined
          : nearestMatch(history, historyConditions, conditions),
    };
  });

  // `best ?? []` rather than a ternary with an empty-array arm: flatMap
  // drops the empty and keeps the match, and — unlike the ternary — every
  // mutant of it is observable. Emptying the arm strands a row's
  // suggestion; replacing it puts a non-match into the id list and the
  // `.map` below throws on it.
  const kits = await kitsFor(
    matched.flatMap(({ best }) => best ?? []).map((best) => best.entry.id),
  );

  return {
    isPublicByDefault: isPublic,
    rows: matched.map(({ run, conditions, best }) => ({
      runId: run.id,
      startedAt: run.startedAt,
      durationS: run.durationS,
      distanceM: run.distanceM,
      conditions,
      suggestion: suggestionFrom(best, kits),
    })),
  };
}

/**
 * A suggestion, or nothing — separate so the row builder above reads as
 * one shape rather than as a nested conditional.
 *
 * A match whose kit came back empty is no suggestion at all: an entry with
 * no garments on it is one the runner saved without attaching anything,
 * and offering "same as that" offers nothing.
 */
function suggestionFrom(
  best: BestMatch<HistoryEntry & { wornAt: number }> | undefined,
  kits: ReadonlyMap<string, Kit>,
): BacklogSuggestion | undefined {
  if (best === undefined) return undefined;
  const kit = kits.get(best.entry.id);
  // An entry with no garments on it is one the runner saved without
  // attaching anything, and "same as that" offers nothing. `kitsFor` only
  // ever holds entries that have items, so the two checks are one
  // question asked once.
  if (kit === undefined) return undefined;
  return {
    entryId: best.entry.id,
    itemIds: kit.itemIds,
    itemNames: kit.itemNames,
    // The day the kit was worn, carried through the match rather than
    // looked up again — which is why `nearestMatch` hands back the
    // caller's own row instead of a copy of three of its fields.
    wornAt: best.entry.wornAt,
  };
}

/**
 * Save one row: attach the kit, then judge it.
 *
 * **Two calls, deliberately the same two the phone makes.** DS2 is
 * emphatic that a row is *"A3's three inputs laid flat — not a new
 * form"*, and *"verdicts saved here count exactly like verdicts from the
 * phone. There is no 'bulk' rule — every row is one A3."* A third write
 * path would be a second thing to keep in sync with the verdict rules,
 * which is what DS5's "no second wide form" is about one layer down.
 *
 * They are one server function rather than two calls from the component
 * because a row half-saved is the one state the table cannot show: the run
 * would have an entry and so leave the backlog, carrying no verdict and no
 * prompt to add one. Here, a failure in `submitVerdict` leaves the entry
 * behind — the same place the phone flow leaves a runner who attaches a
 * kit and closes the tab — and the run's own verdict prompt is what picks
 * it up.
 */
export async function saveBacklogRow(input: {
  userId: string;
  runId: string;
  itemIds: readonly string[];
  verdict: number;
  isPublic: boolean;
}): Promise<{ entryId: string }> {
  const entryId = await attachKit({
    userId: input.userId,
    runId: input.runId,
    itemIds: input.itemIds,
  });
  await submitVerdict({
    userId: input.userId,
    entryId,
    verdict: input.verdict,
    isPublic: input.isPublic,
    // The row has neither, and DS2 draws neither: the table is the three
    // inputs A3 leads with. Tags and per-item flags stay on the sheet,
    // which is still one Tab away through the outfit cell.
    //
    // `tags: []` is observable and tested — a bogus tag would insert an
    // `entry_tags` row. `itemFlags: []` is **not**, and the proof is in
    // `submitVerdict`: it filters every flag against the entry's own item
    // ids, so a flag for anything else matches no row and the batch is
    // identical. Making it optional only moved the same literal into
    // `entries.ts`, where it survived for the same reason; passing it
    // here keeps the two arguments symmetrical and the exclusion in one
    // place.
    tags: [],
    // Stryker disable next-line ArrayDeclaration
    itemFlags: [],
  });
  return { entryId };
}
