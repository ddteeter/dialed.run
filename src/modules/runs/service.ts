/**
 * Run CRUD + the rules around weather status (D-24) and the ±120s
 * duplicate window. Pure of request plumbing so the workers-pool tests
 * exercise it directly; server-fn glue lives in functions.ts.
 */
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";

import { outfitEntries, runs, userProfiles } from "../../db/schema-core";
import { chunked, readInChunks } from "../../lib/chunked";
import type { RunDraft } from "../../lib/contracts";
import { newUlid, ulidSchema } from "../../lib/ids";
import type { Ulid } from "../../lib/ids";
import type { CoreDb } from "./core-db";
import { selectOwnedRow } from "../../lib/owned";
import { observationForRun, observationsForRuns } from "../weather";
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
    lat: withHome.indoor ? undefined : lat,
    lng: withHome.indoor ? undefined : lng,
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
}

function asRunConditions(reading: WeatherReading): RunConditions {
  return {
    tempC: reading.tempC,
    feelsLikeC: reading.feelsLikeC,
    humidity: reading.humidity,
    windKph: reading.windKph,
    precipMm: reading.precipMm,
    condition: reading.condition,
    timeZone: reading.timeZone,
    isSetByYou: reading.source === "manual",
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
  reading: WeatherReading | undefined,
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
    conditions: reading === undefined ? undefined : asRunConditions(reading),
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
 * Each run's conditions, as the list shows them.
 *
 * `DIALED_WEATHER` is a second database, so this is correlated in code,
 * never joined (CLAUDE.md, D1's one exception). The batch read is the
 * weather module's aggregate one, which leaves manual rows out on purpose;
 * a run whose conditions were set by hand is read on its own, and there are
 * few of those — R2b is the only way to make one.
 */
/**
 * Runs per read of the weather cache. Each run is three bound parameters
 * there — a latitude, a longitude and an hour — and D1 refuses a statement
 * with more than a hundred; a full list of fifty is a hundred and fifty.
 */
const CELLS_PER_READ = 30;

async function readingsFor(
  list: readonly RunRow[],
): Promise<Map<string, WeatherReading>> {
  const ids = list.map((run) => ulidSchema.parse(run.id));
  const pages = await Promise.all(
    chunked(ids, CELLS_PER_READ).map(async (chunk) =>
      observationsForRuns(chunk),
    ),
  );
  const readings = new Map<string, WeatherReading>();
  for (const page of pages) {
    for (const [runId, observation] of page) {
      readings.set(runId, { ...observation, source: "visualcrossing" });
    }
  }
  for (const run of list) {
    if (run.weatherStatus !== "manual") continue;
    const reading = await observationForRun(ulidSchema.parse(run.id));
    if (reading !== undefined) readings.set(run.id, reading);
  }
  return readings;
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
  const ids = list.map((run) => run.id);
  const [entries, readings] = await Promise.all([
    entriesByRun(db, userId, ids),
    readingsFor(list),
  ]);
  return list.map((run) =>
    summaryOf(run, entries.get(run.id), readings.get(run.id)),
  );
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
  if (run === undefined) return undefined;
  const [entries, reading] = await Promise.all([
    entriesByRun(db, userId, [run.id]),
    observationForRun(ulidSchema.parse(run.id)),
  ]);
  return summaryOf(run, entries.get(run.id), reading);
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
  record: (runId: Ulid, tempC: number) => Promise<void>;
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
  bandFloorC: number,
): Promise<boolean> {
  return didWriteEligibleRun(db, userId, runId, () =>
    weather.record(ulidSchema.parse(runId), bandMiddleC(bandFloorC)),
  );
}

/**
 * A1's one correction (round 20): the run started at another time. The
 * start moves by `shiftS`, and a run with a place to look the weather up
 * at has it asked for again at the new hour — the old hour's reading was
 * for a run that did not happen then. Weather itself is never edited.
 */
export async function didRetimeRun(
  db: CoreDb,
  weather: Pick<WeatherWrites, "attach">,
  userId: string,
  runId: string,
  shiftS: number,
): Promise<boolean> {
  const run = await getRun(db, userId, runId);
  if (run === undefined) return false;
  const isLocated = run.lat !== null && run.lng !== null;
  // One write: the new start and, where there is weather to ask for, the
  // marker that says it is owed.
  await db
    .update(runs)
    .set({
      startedAt: run.startedAt + shiftS,
      ...(isLocated && { weatherStatus: "pending" as const }),
    })
    .where(eq(runs.id, runId));
  if (isLocated) await weather.attach(ulidSchema.parse(runId));
  return true;
}
