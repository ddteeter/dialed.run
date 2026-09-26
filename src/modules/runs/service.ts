/**
 * Run CRUD + the rules around weather status (D-24) and the ±120s
 * duplicate window. Pure of request plumbing so the workers-pool tests
 * exercise it directly; server-fn glue lives in functions.ts.
 */
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";

import { outfitEntries, runs, userProfiles } from "../../db/schema-core";
import { roundCoordinate } from "../../lib/coords";
import { chunked, readInChunks } from "../../lib/chunked";
import type { ManualSky, RunDraft } from "../../lib/contracts";
import { newUlid, ulidSchema } from "../../lib/ids";
import type { Ulid } from "../../lib/ids";
import type { CoreDb } from "./core-db";
import { selectOwnedRow } from "../../lib/owned";
import { manualReadingsForRuns, observationsForRuns } from "../weather";
import type { WeatherReading } from "../weather";
import { bandMiddleC, canSetConditions } from "./run-conditions";

export const DUPLICATE_WINDOW_S = 120;

export type RunRow = typeof runs.$inferSelect;

/**
Weather is never typed by a human on the default path (D-24): indoor runs
never get conditions; outdoor runs with a location wait for the weather
module; outdoor runs with no resolvable location are immediately eligible
for the flagged manual-temp fallback.
*/
export function initialWeatherStatus(
  draft: Pick<RunDraft, "indoor" | "lat" | "lng">,
): "none" | "pending" | "failed" {
  if (draft.indoor) return "none";
  if (draft.lat !== undefined && draft.lng !== undefined) return "pending";
  return "failed";
}

/**
 * Where a run is stored as starting (STR-14): nowhere for an indoor run,
 * and otherwise its point rounded to the precision the weather works at —
 * before it is stored, which is also before it is sent, because the
 * provider is asked about the stored point. See `lib/coords.ts`.
 */
export function storedStart(draft: {
  indoor: boolean;
  lat?: number | undefined;
  lng?: number | undefined;
}): { lat: number | undefined; lng: number | undefined } {
  if (draft.indoor) return { lat: undefined, lng: undefined };
  return {
    lat: draft.lat === undefined ? undefined : roundCoordinate(draft.lat),
    lng: draft.lng === undefined ? undefined : roundCoordinate(draft.lng),
  };
}

/**
±120s guard: another run by the same user starting within the window.
Covered by the runs(user_id, started_at) index.
*/
export async function findDuplicateRun(
  db: CoreDb,
  userId: string,
  startedAt: number,
): Promise<RunRow | undefined> {
  const rows = await db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.userId, userId),
        gte(runs.startedAt, startedAt - DUPLICATE_WINDOW_S),
        lte(runs.startedAt, startedAt + DUPLICATE_WINDOW_S),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface CreatedRun {
  id: string;
  /**
  Wider than the set a fresh insert can produce, because the idempotent
  path returns an existing run whose weather may since have resolved.
  */
  weatherStatus: RunRow["weatherStatus"];
}

/**
Manual entry. Outdoor drafts without coordinates fall back to the user's
home location (design doc 102, open question 1) so the weather module can
still resolve conditions.
*/
export async function createManualRun(
  db: CoreDb,
  userId: string,
  draft: RunDraft,
  idempotencyKey?: string,
): Promise<CreatedRun> {
  // Resubmission of a key we already have returns the run it made. A
  // double-click, a browser POST replay and a retry over a flaky
  // connection are indistinguishable from a genuine second submission
  // without one, and all three used to create a duplicate run.
  if (idempotencyKey !== undefined) {
    const [existing] = await db
      .select({ id: runs.id, weatherStatus: runs.weatherStatus })
      .from(runs)
      .where(
        and(eq(runs.userId, userId), eq(runs.idempotencyKey, idempotencyKey)),
      )
      .limit(1);
    if (existing !== undefined) {
      return { id: existing.id, weatherStatus: existing.weatherStatus };
    }
  }
  let { lat, lng } = draft;
  if (!draft.indoor && (lat === undefined || lng === undefined)) {
    const profile = await db
      .select({ lat: userProfiles.lat, lng: userProfiles.lng })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);
    lat = profile[0]?.lat ?? undefined;
    lng = profile[0]?.lng ?? undefined;
  }
  const withHome = { ...draft, lat, lng };
  const weatherStatus = initialWeatherStatus(withHome);
  const id = newUlid();
  await db.insert(runs).values({
    id,
    userId,
    source: "manual",
    startedAt: draft.startedAt,
    durationS: draft.durationS,
    distanceM: draft.distanceM,
    ...storedStart(withHome),
    indoor: draft.indoor,
    effort: draft.effort,
    title: draft.title,
    weatherStatus,
    idempotencyKey,
  });
  // Pending(102↔103): when modules/weather merges, call
  // weather.attachObservation(id) here for 'pending' runs (degrade on
  // failure — law 5; status stays 'pending' for the retry machinery).
  return { id, weatherStatus };
}

export async function getRun(
  db: CoreDb,
  userId: string,
  runId: string,
): Promise<RunRow | undefined> {
  return selectOwnedRow(db, runs, { id: runId, userId });
}

/**
 * How many runs a runner has — what disconnecting Strava keeps (T3b: "All
 * 186 runs, their outfits and verdicts"). Counted on `runs_user_started`.
 */
export async function countRuns(db: CoreDb, userId: string): Promise<number> {
  return db.$count(runs, eq(runs.userId, userId));
}

/**
 * A run's conditions as a screen draws them: the temperature, how wet, and
 * the zone the run's date is written in. Manual conditions included — a
 * runner who set a band sees it — and marked, so they read "SET BY YOU".
 */
export interface RunConditions {
  tempC: number;
  feelsLikeC: number;
  humidity: number;
  windKph: number;
  precipMm: number;
  condition: string;
  timeZone: string | undefined;
  isSetByYou: boolean;
  /**
   * The sky the runner picked in R2b, when they set the conditions and
   * the sheet asked (round 26, item 2). Never on a real reading.
   */
  sky: ManualSky | undefined;
}

/**
 * A reading as a screen draws it. Whether the runner set it is the caller's
 * to say: it knows which read the reading came from, and only the band
 * read finds a hand-set one.
 */
function asRunConditions(
  reading: Omit<WeatherReading, "source">,
  isSetByYou: boolean,
): RunConditions {
  return {
    tempC: reading.tempC,
    feelsLikeC: reading.feelsLikeC,
    humidity: reading.humidity,
    windKph: reading.windKph,
    precipMm: reading.precipMm,
    condition: reading.condition,
    timeZone: reading.timeZone,
    isSetByYou,
    sky: reading.sky,
  };
}

/**
 * What the runs list and run detail need of a run beyond its row: its
 * conditions, and its entry — a run with a verdict opens D, one with only
 * a kit opens A3 (round 22, R: *"A run with a verdict opens D; these are
 * the runs that aren't entries yet"*).
 */
export interface RunSummary {
  id: string;
  source: RunRow["source"];
  startedAt: number;
  durationS: number;
  distanceM: number;
  indoor: boolean;
  weatherStatus: RunRow["weatherStatus"];
  /**
  Whether R2b may be offered — see `canSetConditions`.
  */
  canSetConditions: boolean;
  conditions: RunConditions | undefined;
  entryId: string | undefined;
  hasVerdict: boolean;
}

function summaryOf(
  run: RunRow,
  entry: { id: string; verdict: number | null } | undefined,
  conditions: RunConditions | undefined,
): RunSummary {
  return {
    id: run.id,
    source: run.source,
    startedAt: run.startedAt,
    durationS: run.durationS,
    distanceM: run.distanceM,
    indoor: run.indoor,
    weatherStatus: run.weatherStatus,
    canSetConditions: canSetConditions(run),
    conditions,
    entryId: entry?.id,
    hasVerdict: entry?.verdict != undefined,
  };
}

/**
 * The entries these runs have, by run id. One read, owner-scoped, in
 * chunks under D1's parameter cap; `entries_run` is UNIQUE, so a run has
 * at most one.
 */
async function entriesByRun(
  db: CoreDb,
  userId: string,
  runIds: readonly string[],
): Promise<Map<string, { id: string; verdict: number | null }>> {
  const rows = await readInChunks([...runIds], (chunk) =>
    db
      .select({
        id: outfitEntries.id,
        runId: outfitEntries.runId,
        verdict: outfitEntries.verdict,
      })
      .from(outfitEntries)
      .where(
        and(
          eq(outfitEntries.userId, userId),
          inArray(outfitEntries.runId, chunk),
        ),
      ),
  );
  return new Map(rows.map((row) => [row.runId, row]));
}

/**
 * Runs per read of the weather cache. Each run is three bound parameters
 * there — a latitude, a longitude and an hour — and D1 refuses a statement
 * with more than a hundred; a full list of fifty is a hundred and fifty.
 */
const CELLS_PER_READ = 30;

/**
 * Each run's conditions, as the list and run detail show them.
 *
 * `DIALED_WEATHER` is a second database, so this is correlated in code,
 * never joined (CLAUDE.md, D1's one exception). Two reads: the real
 * observation at each run's cell, and the band each run's runner set, by
 * run id.
 *
 * **A band wins, and is only ever its own run's.** It is what the runner
 * chose for this run, so a real reading someone else's run later fetched
 * into the same cell does not replace it; and it is read by run, never by
 * cell, so it never reaches anyone else's run (B1).
 */
async function conditionsFor(
  list: readonly RunRow[],
): Promise<Map<string, RunConditions | undefined>> {
  const ids = list.map((run) => ulidSchema.parse(run.id));
  const [pages, bands] = await Promise.all([
    Promise.all(
      chunked(ids, CELLS_PER_READ).map(async (chunk) =>
        observationsForRuns(chunk),
      ),
    ),
    manualReadingsForRuns(ids),
  ]);
  const conditions = new Map<string, RunConditions | undefined>();
  for (const page of pages) {
    for (const [runId, observation] of page) {
      conditions.set(runId, asRunConditions(observation, false));
    }
  }
  for (const [runId, band] of bands) {
    conditions.set(runId, asRunConditions(band, true));
  }
  return conditions;
}

/**
 * Runs as the screens draw them: their conditions and their entries, read
 * for the whole list at once.
 */
async function summariesOf(
  db: CoreDb,
  userId: string,
  list: readonly RunRow[],
): Promise<RunSummary[]> {
  const [entries, conditions] = await Promise.all([
    entriesByRun(
      db,
      userId,
      list.map((run) => run.id),
    ),
    conditionsFor(list),
  ]);
  return list.map((run) =>
    summaryOf(run, entries.get(run.id), conditions.get(run.id)),
  );
}

/**
 * One run, as run detail and A1 draw it — read exactly as the list reads
 * it, so a run never says one thing in the list and another on its page.
 */
export async function summaryOfRun(
  db: CoreDb,
  userId: string,
  run: RunRow,
): Promise<RunSummary | undefined> {
  const [summary] = await summariesOf(db, userId, [run]);
  return summary;
}

/**
 * The runs list (round 22, "R Runs list"): the runner's last fifty runs,
 * newest first, each with the badge its conditions earn and the door its
 * entry opens. Covered by `runs(user_id, started_at)`.
 */
export async function listRunSummaries(
  db: CoreDb,
  userId: string,
): Promise<RunSummary[]> {
  const list = await db
    .select()
    .from(runs)
    .where(eq(runs.userId, userId))
    .orderBy(desc(runs.startedAt))
    .limit(50);
  return summariesOf(db, userId, list);
}

/**
One run, as run detail draws it; nothing when it is not this runner's.
*/
export async function getRunSummary(
  db: CoreDb,
  userId: string,
  runId: string,
): Promise<RunSummary | undefined> {
  const run = await getRun(db, userId, runId);
  return run === undefined ? undefined : summaryOfRun(db, userId, run);
}

/**
 * The weather module's two writes, handed in so the rules around them can
 * be tested against a fake as well as the real thing. Both are
 * `modules/weather`'s own (`attachObservation`, `recordManualObservation`);
 * neither throws on a provider failure — a run the provider cannot answer
 * for stays `pending`, which is the reconciliation marker the hourly cron
 * re-drives (law 8c).
 */
export interface WeatherWrites {
  attach: (runId: Ulid) => Promise<unknown>;
  record: (runId: Ulid, tempC: number, sky: ManualSky) => Promise<void>;
}

/**
 * Ask for a run's weather again: back to `pending`, then one attempt now.
 * A gap between the two heals itself — `pending` is what the cron reads.
 */
async function refetchWeather(
  db: CoreDb,
  weather: Pick<WeatherWrites, "attach">,
  runId: string,
): Promise<void> {
  await db
    .update(runs)
    .set({ weatherStatus: "pending" })
    .where(eq(runs.id, runId));
  await weather.attach(ulidSchema.parse(runId));
}

/**
 * The shape both of R2b's mutations share: load the run, refuse if it is
 * not this runner's or is not eligible for R2b, otherwise make the write.
 * Extracted because the two calls were the same guard around a different
 * write, not two decisions.
 */
async function didWriteEligibleRun(
  db: CoreDb,
  userId: string,
  runId: string,
  write: () => Promise<void>,
): Promise<boolean> {
  const run = await getRun(db, userId, runId);
  if (run === undefined || !canSetConditions(run)) return false;
  await write();
  return true;
}

/**
 * R2b's "Try again": the weather gave up on this run, and the runner asks
 * once more. Only for a run R2b may be offered for; false otherwise.
 */
export async function didRetryRunWeather(
  db: CoreDb,
  weather: Pick<WeatherWrites, "attach">,
  userId: string,
  runId: string,
): Promise<boolean> {
  return didWriteEligibleRun(db, userId, runId, () =>
    refetchWeather(db, weather, runId),
  );
}

/**
 * R2b's "Set conditions": the runner picks a band, and the run is dated
 * into it with `source='manual'` — excluded from every aggregate, never a
 * number anyone typed (D-24, round 22). False for a run R2b may not be
 * offered for, which includes one whose weather has since arrived.
 */
export async function didSetRunConditions(
  db: CoreDb,
  weather: Pick<WeatherWrites, "record">,
  userId: string,
  runId: string,
  pick: { bandFloorC: number; sky: ManualSky },
): Promise<boolean> {
  return didWriteEligibleRun(db, userId, runId, () =>
    weather.record(
      ulidSchema.parse(runId),
      bandMiddleC(pick.bandFloorC),
      pick.sky,
    ),
  );
}

/**
 * How far A1's correction may move a start: within its day, either way.
 * A run that started on another day is another run.
 */
const RETIME_LIMIT_S = 86_400;

/**
 * A1's one correction (round 20): the run started at another time. The
 * start becomes `startedAt`, and a run with a place to look the weather up
 * at has it asked for again at the new hour — the old hour's reading was
 * for a run that did not happen then. Weather itself is never edited.
 *
 * **Absolute, so a retry is harmless** (law 8b). It used to take a shift,
 * and a retry after a lost response applied it twice. A start that is
 * already where it was asked to be is the first call having landed: true,
 * and nothing written or fetched again.
 */
export async function didRetimeRun(
  db: CoreDb,
  weather: Pick<WeatherWrites, "attach">,
  userId: string,
  runId: string,
  startedAt: number,
): Promise<boolean> {
  const run = await getRun(db, userId, runId);
  if (run === undefined) return false;
  if (Math.abs(startedAt - run.startedAt) > RETIME_LIMIT_S) return false;
  if (startedAt === run.startedAt) return true;
  const isLocated = run.lat !== null && run.lng !== null;
  // One write: the new start and, where there is weather to ask for, the
  // marker that says it is owed.
  await db
    .update(runs)
    .set({
      startedAt,
      ...(isLocated && { weatherStatus: "pending" as const }),
    })
    .where(eq(runs.id, runId));
  if (isLocated) await weather.attach(ulidSchema.parse(runId));
  return true;
}
