import { desc, eq, inArray, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { outfitEntries, outfitEntryItems, runs } from "../../db/schema-core";
import { env } from "../../env";
import type { Conditions } from "./conditions";
import { observationsForEntries, observationsForRuns } from "./conditions";
import { attachKit } from "./entries";
import { garmentNamesByIds } from "./garment-names";
import { nearestMatch, type BestMatch, type HistoryEntry } from "./prefill";
import { forIds } from "../../lib/for-ids";
import { runsAwaitingVerdict } from "../runs";

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
export interface BacklogKit {
  entryId: string;
  itemIds: readonly string[];
  itemNames: readonly string[];
}

export interface BacklogSuggestion extends BacklogKit {
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
  /**
   * The kit this run already has, when the runner attached one and never
   * gave a verdict — the owner's ruling puts that run in the backlog too.
   * The row shows it and saves only the verdict: `attachKit` never
   * replaces a kit, so offering another here would save a verdict against
   * a kit the runner never saw.
   */
  kit: BacklogKit | undefined;
  /**
  What the outfit cell offers a run with no kit yet; none for one that has.
  */
  suggestion: BacklogSuggestion | undefined;
}

export interface Backlog {
  rows: readonly BacklogRow[];
}

/**
 * Runs this runner has logged that still await a verdict, oldest first —
 * read through `runsAwaitingVerdict`, which owns the query and its index
 * notes.
 *
 * **No filter on `source`.** DS2 calls these "imported from Strava",
 * which is where a backlog comes from in practice, but a run without an
 * outfit is a run without an outfit however it arrived — and a manual run
 * abandoned halfway through the flow leaves exactly this row. Filtering
 * on source would hide it with nothing to say so.
 */
async function unjudgedRuns(userId: string) {
  // The set is the runs module's one definition (owner's ruling: DS2 and
  // the bell count the same runs) — no entry, or an entry with no verdict,
  // at any age. A row that already has a kit saves through `attachKit`'s
  // existing-entry path, which writes the verdict and leaves the kit.
  return runsAwaitingVerdict(drizzle(env.DIALED_CORE), userId, BACKLOG_LIMIT);
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
 * The kits behind a set of suggested entries, and the kits already on a set
 * of runs, as ids and as names — keyed by entry either way.
 *
 * Two reads for the whole table rather than two per row: the entries are
 * asked for together and the garments they name are asked for together
 * after that. The runs' own kits are found by run rather than by entry, so
 * a run with no entry needs no filtering out: it simply joins nothing.
 */
interface Kit {
  itemIds: string[];
  itemNames: string[];
}

async function kitsFor(ask: {
  entryIds: readonly string[];
  runIds: readonly string[];
}): Promise<Map<string, Kit>> {
  const database = drizzle(env.DIALED_CORE);
  const rows = await forIds([...ask.entryIds, ...ask.runIds], () =>
    database
      .select({
        entryId: outfitEntryItems.entryId,
        itemId: outfitEntryItems.itemId,
      })
      .from(outfitEntryItems)
      .innerJoin(outfitEntries, eq(outfitEntries.id, outfitEntryItems.entryId))
      .where(
        or(
          inArray(outfitEntryItems.entryId, [...ask.entryIds]),
          inArray(outfitEntries.runId, [...ask.runIds]),
        ),
      ),
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
  const unjudged = await unjudgedRuns(userId);

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
      // A run that already has a kit is offered no other: it saves its
      // verdict against the kit it has.
      best:
        conditions === undefined || run.entryId !== null
          ? undefined
          : nearestMatch(history, historyConditions, conditions),
    };
  });

  // `best ?? []` rather than a ternary with an empty-array arm: flatMap
  // drops the empty and keeps the match, and — unlike the ternary — every
  // mutant of it is observable. Emptying the arm strands a row's
  // suggestion; replacing it puts a non-match into the id list and the
  // `.map` below throws on it.
  //
  // The kits already on the rows are read in the same pass as the
  // suggested ones: one read for every entry the table names.
  const kits = await kitsFor({
    entryIds: matched
      .flatMap(({ best }) => best ?? [])
      .map((best) => best.entry.id),
    runIds: unjudged.map((run) => run.id),
  });

  return {
    rows: matched.map(({ run, conditions, best }) => ({
      runId: run.id,
      startedAt: run.startedAt,
      durationS: run.durationS,
      distanceM: run.distanceM,
      conditions,
      kit: existingKit(run.entryId, kits),
      suggestion: suggestionFrom(best, kits),
    })),
  };
}

/**
 * The kit a row's run already has, or none when it has no entry.
 *
 * An entry with no garments is still a kit the runner chose — nothing —
 * and the row draws it as such rather than offering to replace it, which
 * `attachKit` would not do.
 */
function existingKit(
  entryId: string | null,
  kits: ReadonlyMap<string, Kit>,
): BacklogKit | undefined {
  if (entryId === null) return undefined;
  const kit = kits.get(entryId) ?? { itemIds: [], itemNames: [] };
  return { entryId, itemIds: kit.itemIds, itemNames: kit.itemNames };
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
 * Save one row: the kit and the verdict, together.
 *
 * **One transaction, because one keystroke.** This began as `attachKit`
 * followed by `submitVerdict` — the same two calls the phone makes — on
 * the argument that a failure between them lands the run in the unjudged
 * state the phone flow produces anyway, which the S1 prompt heals. That
 * argument is true and it is the wrong one: reconciliation is law 8c's
 * answer for when you *cannot* batch, and here you can. Every read
 * `attachKit` needs happens before it writes anything, and a backlog row
 * has no tags and no per-item flags — so `submitVerdict`'s other three
 * statements are all no-ops and what is left is two inserts that belong
 * in one `batch()`.
 *
 * The user's expectation is the deciding argument, and it was the
 * owner's: pressing `Enter` once on a row is submitting a kit *and* a
 * judgement, and half of that landing is not a state anybody asked for.
 * Raised on PR #88.
 *
 * So the verdict rides on `attachKit`, which is still the only function
 * in the codebase that creates an outfit entry — there is no second write
 * path, only an entry that can be born judged.
 */
export async function saveBacklogRow(input: {
  userId: string;
  runId: string;
  itemIds: readonly string[];
  verdict: number;
}): Promise<{ entryId: string }> {
  const entryId = await attachKit({
    userId: input.userId,
    runId: input.runId,
    itemIds: input.itemIds,
    verdict: input.verdict,
  });
  return { entryId };
}
