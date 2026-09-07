/**
 * Run CRUD + the rules around weather status (D-24) and the ±120s
 * duplicate window. Pure of request plumbing so the workers-pool tests
 * exercise it directly; server-fn glue lives in functions.ts.
 */
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";

import { runs, userProfiles } from "../../db/schema-core";
import type { RunDraft } from "../../lib/contracts";
import { newUlid } from "../../lib/ids";
import type { CoreDb } from "./core-db";

export const DUPLICATE_WINDOW_S = 120;

export type RunRow = typeof runs.$inferSelect;

/**
 * What a component gets. Identical to the stored row except that `indoor`
 * is a boolean.
 *
 * SQLite has no boolean type, so the column is an integer — but that is a
 * storage detail and it was reaching the UI, which had to write
 * `run.indoor !== 0` to ask a yes/no question. Drizzle's
 * `mode: "boolean"` would express this on the column itself; it is not
 * used here because drizzle-kit treats the codec change as a column-type
 * change and emits a full DROP/recreate of the table for what is, in SQL
 * terms, no change at all. A mapping function costs one call and no
 * migration.
 */
export interface RunView extends Omit<RunRow, "indoor"> {
  indoor: boolean;
}

function toRunView(row: RunRow): RunView {
  return { ...row, indoor: row.indoor !== 0 };
}

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
  weatherStatus: "none" | "pending" | "failed";
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
): Promise<CreatedRun> {
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
    indoor: draft.indoor ? 1 : 0,
    effort: draft.effort,
    title: draft.title,
    weatherStatus,
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
): Promise<RunView | undefined> {
  const rows = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.userId, userId)))
    .limit(1);
  const row = rows[0];
  return row === undefined ? undefined : toRunView(row);
}

export async function listRuns(db: CoreDb, userId: string): Promise<RunView[]> {
  const rows = await db
    .select()
    .from(runs)
    .where(eq(runs.userId, userId))
    .orderBy(desc(runs.startedAt))
    .limit(50);
  return rows.map((row) => toRunView(row));
}

/**
D-24 manual-temp fallback: only reachable when no observation resolved.
Marks the run 'manual' so it is excluded from consensus aggregates and
training. Returns false when the run isn't eligible (already attached).
*/
export async function didRecordManualTemp(
  db: CoreDb,
  userId: string,
  runId: string,
  tempC: number,
): Promise<boolean> {
  // Pending(102↔103): once modules/weather merges, persist the observation
  // via weather.recordManualObservation(runId, tempC) (source='manual',
  // excluded from aggregates) instead of only flipping the run's status.
  // tempC is logged here so it isn't silently dropped in the meantime.
  console.info("[manual-temp-pending-weather-module]", { runId, tempC });

  const result = await db
    .update(runs)
    .set({ weatherStatus: "manual" })
    .where(
      and(
        eq(runs.id, runId),
        eq(runs.userId, userId),
        eq(runs.indoor, 0),
        // Claim-style guard: only unresolved runs accept a manual temp.
        inArray(runs.weatherStatus, ["failed", "pending"]),
      ),
    );
  return result.meta.changes > 0;
}
