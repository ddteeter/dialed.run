/**
 * The run-facing half of the module: attach conditions to a run (from the
 * import/manual-entry pipelines), the manual-temp fallback (D-24), and the
 * hourly retry cron. All three funnel through `resolveAndAttach`, which is
 * the idempotent unit — re-invoking it on an already-resolved run is a
 * no-op (CLAUDE.md resilience law 1).
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { imports, runs } from "../../db/schema-core";
import { env } from "../../env";
import type { Ulid } from "../../lib/ids";
import { weatherProvider } from "./provider";
import {
  cacheKeyFor,
  findObservationRow,
  upsertManualObservation,
  upsertRealObservation,
} from "./store";

type WeatherStatus = (typeof runs.$inferSelect)["weatherStatus"];

const RETRY_BATCH_SIZE = 50;
const FAIL_AFTER_SECONDS = 5 * 60 * 60;

function coreDb() {
  return drizzle(env.DIALED_CORE);
}

async function setStatus(runId: Ulid, status: WeatherStatus): Promise<void> {
  await coreDb().update(runs).set({ weatherStatus: status }).where(eq(runs.id, runId));
}

type AttachOutcome =
  | "attached"
  | "manual"
  | "pending"
  | "skipped-no-location"
  | "skipped-resolved"
  | "skipped-not-found";

/**
 * Core idempotent unit. Returns what happened rather than throwing on a
 * degraded path — only genuinely unexpected errors (e.g. a DB failure)
 * propagate; a weather-provider outage never does (law 5).
 */
async function resolveAndAttach(runId: Ulid): Promise<AttachOutcome> {
  const [run] = await coreDb().select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) {
    console.warn("[weather] attach: run not found", { runId });
    return "skipped-not-found";
  }
  if (run.weatherStatus === "attached" || run.weatherStatus === "manual") {
    return "skipped-resolved";
  }
  if (run.indoor === 1 || run.lat === null || run.lng === null) {
    console.warn("[weather] attach: no-op (indoor or no location)", {
      runId,
      indoor: run.indoor,
    });
    return "skipped-no-location";
  }

  const key = cacheKeyFor(run.lat, run.lng, new Date(run.startedAt * 1000));
  const cached = await findObservationRow(key);
  if (cached) {
    // The distinction that matters is resolved-vs-typed-by-a-human, not
    // which vendor resolved it. Comparing to the provider name meant a
    // second provider's observations would silently be classed as manual
    // and dropped from consensus aggregates.
    const status = cached.source === "manual" ? "manual" : "attached";
    await setStatus(runId, status);
    return status;
  }

  const provider = weatherProvider();
  try {
    const observation = await provider.observation(
      run.lat,
      run.lng,
      new Date(run.startedAt * 1000),
    );
    await upsertRealObservation(key, observation, runId);
    await setStatus(runId, "attached");
    return "attached";
  } catch (error) {
    console.warn("[weather] attach: provider call failed, marking pending", {
      runId,
      error: error instanceof Error ? error.message : String(error),
    });
    await setStatus(runId, "pending");
    return "pending";
  }
}

/**
 * Public API: attach conditions to a run. No-op with a structured log when
 * the run is indoor/has no location/is already resolved; degrades to
 * `weather_pending` on provider failure — never throws (law 5).
 */
export async function attachObservation(runId: Ulid): Promise<void> {
  await resolveAndAttach(runId);
}

/**
 * Public API: the manual-temp fallback (D-24, lane 102's UI). Only
 * temperature is user-entered; the other required columns are filled with
 * neutral sentinels since manual rows are excluded from every aggregate the
 * module exposes (docs/designs/103-weather.md open questions). If a real
 * observation already occupies this run's cache cell, that wins and the run
 * links to it instead of the manual guess.
 */
export async function recordManualObservation(
  runId: Ulid,
  tempC: number,
): Promise<void> {
  const [run] = await coreDb().select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) {
    throw new Error(`recordManualObservation: run ${runId} not found`);
  }
  if (run.weatherStatus === "attached" || run.weatherStatus === "manual") {
    return;
  }
  if (run.lat === null || run.lng === null) {
    throw new Error(
      `recordManualObservation: run ${runId} has no location to key the observation on`,
    );
  }
  const key = cacheKeyFor(run.lat, run.lng, new Date(run.startedAt * 1000));
  const row = await upsertManualObservation(key, tempC, runId);
  await setStatus(runId, row.source === "manual" ? "manual" : "attached");
}

interface RetryCronResult {
  claimed: number;
  attached: number;
  failed: number;
}

/**
 * The hourly retry cron body (docs/tasks/103-weather.md requirement 4/5).
 * `weather_status` has no `processing` state, so there is no literal
 * claim-then-work UPDATE here; overlap safety instead comes from
 * `resolveAndAttach`'s idempotency plus the cache's UNIQUE key (worst case
 * on a genuinely overlapping run is a duplicate provider call, never a
 * duplicate row or a lost update) — documented deviation from law 2's
 * literal shape, flagged in the design doc.
 *
 * The packet's "5 attempts" cap is approximated with a 5-hour age window on
 * the run's entry time (`imports.created_at` for file imports, else
 * `started_at`) instead of a persisted per-run counter — no schema change
 * needed, at the cost of exact-5 counting (docs/designs/103-weather.md open
 * questions; reviewer may veto for a `runs.weather_attempts` column).
 */
export async function retryPendingWeather(): Promise<RetryCronResult> {
  const db = coreDb();
  const candidates = await db
    .select({
      id: runs.id,
      startedAt: runs.startedAt,
      importCreatedAt: imports.createdAt,
    })
    .from(runs)
    .leftJoin(imports, eq(imports.runId, runs.id))
    .where(eq(runs.weatherStatus, "pending"))
    .orderBy(asc(runs.startedAt))
    .limit(RETRY_BATCH_SIZE);

  let attached = 0;
  for (const candidate of candidates) {
    const outcome = await resolveAndAttach(candidate.id as Ulid);
    if (outcome === "attached" || outcome === "manual") {
      attached += 1;
    }
  }

  if (candidates.length === 0) {
    return { claimed: 0, attached, failed: 0 };
  }

  const candidateIds = candidates.map((c) => c.id);
  const stillPending = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.weatherStatus, "pending"), inArray(runs.id, candidateIds)));
  const stillPendingIds = new Set(stillPending.map((r) => r.id));

  const now = Math.floor(Date.now() / 1000);
  const toFailIds = candidates
    .filter((c) => stillPendingIds.has(c.id))
    .filter((c) => now - (c.importCreatedAt ?? c.startedAt) >= FAIL_AFTER_SECONDS)
    .map((c) => c.id);

  if (toFailIds.length > 0) {
    await db.update(runs).set({ weatherStatus: "failed" }).where(inArray(runs.id, toFailIds));
    console.warn("[weather] retry cron: exhausted, marking failed", {
      runIds: toFailIds,
    });
  }

  return { claimed: candidates.length, attached, failed: toFailIds.length };
}
