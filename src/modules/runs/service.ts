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
        and(
          eq(runs.userId, userId),
          eq(runs.idempotencyKey, idempotencyKey),
        ),
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
  const rows = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.userId, userId)))
    .limit(1);
  return rows[0];
}

export async function listRuns(db: CoreDb, userId: string): Promise<RunRow[]> {
  const rows = await db
    .select()
    .from(runs)
    .where(eq(runs.userId, userId))
    .orderBy(desc(runs.startedAt))
    .limit(50);
  return rows;
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
        eq(runs.indoor, false),
        // Claim-style guard: only unresolved runs accept a manual temp.
        inArray(runs.weatherStatus, ["failed", "pending"]),
      ),
    );
  return result.meta.changes > 0;
}
