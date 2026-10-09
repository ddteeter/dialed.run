/**
 * The run-facing half of the module: attach conditions to a run (from the
 * import/manual-entry pipelines), the manual-temp fallback (D-24), and the
 * hourly retry cron. All three funnel through `resolveAndAttach`, which is
 * the idempotent unit — re-invoking it on an already-resolved run is a
 * no-op (CLAUDE.md resilience law 1).
 */
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { gaveUpClear, gaveUpUpsert } from "../../db/gave-up";
import { gaveUp, imports, runs } from "../../db/schema-core";
import { env } from "../../env";
import type { ManualSky } from "../../lib/contracts";
import type { Ulid } from "../../lib/ids";
import { weatherProvider } from "./provider";
import {
  runHourKeys,
  cacheKeyFor,
  findManualBand,
  findObservationRow,
  upsertManualBand,
  upsertRealObservation,
  type CacheKey,
} from "./store";

import { nowSeconds } from "../../lib/now";
type WeatherStatus = (typeof runs.$inferSelect)["weatherStatus"];

const RETRY_BATCH_SIZE = 50;
const HOUR_SECONDS = 60 * 60;
const FAIL_AFTER_SECONDS = 5 * HOUR_SECONDS;

/**
 * Why a run's conditions gave up, for its Gave up row. The cron keeps no
 * error — a provider failure is logged and the run left `pending` — so
 * what it can say is how long it tried; the logs have the rest.
 */
const WEATHER_GAVE_UP_REASON =
  "No weather came back for this run in five hours of hourly tries.";

/**
 * The same, for a run the cron fails on its first pass already past the
 * window: an operator's Retry (which puts it back to `pending`), or a run
 * that entered the system older than five hours. Either way it had one
 * try, and saying "five hours of hourly tries" again would be untrue.
 */
const WEATHER_LATE_TRY_REASON =
  "No weather came back for this run on its latest try, made after its five-hour window had closed.";

/**
 * What a give-up says and counts, by the run's age when the cron fails it.
 *
 * The cron fails a run on its first pass at or past five hours, so a run
 * that was pending all along is failed before it is six hours old, having
 * had about five hourly goes. One failed later than that was not pending
 * all along — it came back after a give-up, or entered late — and had the
 * one go this pass made. A run already listed adds that to its tries
 * (`gaveUpUpsert`), so a retried run counts one more, not five.
 */
function giveUpFact(age: number): { reason: string; tries: number } {
  return age < FAIL_AFTER_SECONDS + HOUR_SECONDS
    ? {
        reason: WEATHER_GAVE_UP_REASON,
        tries: FAIL_AFTER_SECONDS / HOUR_SECONDS,
      }
    : { reason: WEATHER_LATE_TRY_REASON, tries: 1 };
}

function coreDb() {
  return drizzle(env.DIALED_CORE);
}

/**
 * Resolved means "this run's conditions are settled" — a real observation
 * or a temperature a human typed. Both callers below need the same answer
 * and it was written out twice; the two copies are what would let a third
 * status join one of them and not the other.
 */
function isResolved(status: WeatherStatus): boolean {
  return status === "attached" || status === "manual";
}

/**
 * Write a run's weather status. A run that resolves — fetched, or a band
 * its runner typed — is off the Desk's Gave up in the same batch (R-119),
 * whichever path resolved it: the hourly cron, an operator's Retry, R2b.
 */
async function setStatus(runId: Ulid, status: WeatherStatus): Promise<void> {
  const db = coreDb();
  const update = db
    .update(runs)
    .set({ weatherStatus: status })
    .where(eq(runs.id, runId));
  if (!isResolved(status)) {
    await update;
    return;
  }
  await db.batch([update, gaveUpClear(db, "weather", runId)]);
}

/**
 * What an attach attempt did. Returned rather than swallowed: three of the
 * six outcomes are degradations (law 5 — a weather failure never fails the
 * run), and a caller that cannot tell "attached" from "pending" has no way
 * to report or count them. The retry cron counts on these, and the strings
 * are what a tail log shows.
 */
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
// fallow-ignore-next-line code-duplication -- the same one-line run read with different failure handling: one warns and skips, the other throws
async function resolveAndAttach(runId: Ulid): Promise<AttachOutcome> {
  const [run] = await coreDb()
    .select()
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  if (!run) {
    console.warn("[weather] attach: run not found", { runId });
    return "skipped-not-found";
  }
  if (isResolved(run.weatherStatus)) {
    return "skipped-resolved";
  }
  if (run.indoor || run.lat === null || run.lng === null) {
    console.warn("[weather] attach: no-op (indoor or no location)", {
      runId,
      indoor: run.indoor,
    });
    return "skipped-no-location";
  }

  // The run's own band, if its runner set one, is its conditions — the
  // same answer every reader gives. Checked here as well so a run with a
  // band that is re-driven (a retime, a status write that was lost after
  // the band landed) settles as `manual` rather than fetching over it.
  if ((await findManualBand(runId)) !== undefined) {
    await setStatus(runId, "manual");
    return "manual";
  }

  const keys = runHourKeys(run.lat, run.lng, run.startedAt, run.durationS);
  const [key] = keys;
  // Unreachable: `runHourKeys` always yields at least the starting hour.
  // The guard is here for the compiler — destructuring a `CacheKey[]`
  // gives `CacheKey | undefined` whatever the runtime does.
  // Stryker disable next-line ConditionalExpression,EqualityOperator,StringLiteral
  if (key === undefined) return "skipped-no-location";
  // Real observations only: another runner's band in this cell is not
  // this run's weather (B1), so it reads as a miss and this run fetches.
  if ((await findObservationRow(key)) !== undefined) {
    await setStatus(runId, "attached");
    return "attached";
  }

  const provider = weatherProvider();
  try {
    // Sample every hour the run spans, not just its start.
    //
    // A 9-11am run resolved only at 09:00 is remembered as a 4 degree run
    // even if it finished at 12. The verdict covers the whole run, so the
    // model would learn that 4 degrees means overdressed — which poisons
    // the signal the call epic is built on rather than merely displaying a
    // stale number. People also judge an outfit by the extremes, not the
    // mean, which is why entry_tags already has cold_first_mile and
    // overheated_late.
    //
    // No schema change: observations are already cached per rounded
    // hour, so "the conditions across a run" is derivable at read time
    // from started_at + duration_s. What was missing was resolving the
    // later hours at all. The run still links to its starting hour, so
    // every existing reader is unaffected.
    await sampleRunHours(
      provider,
      keys,
      run.lat,
      run.lng,
      run.startedAt,
      runId,
    );
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

async function sampleRunHours(
  provider: ReturnType<typeof weatherProvider>,
  keys: readonly CacheKey[],
  lat: number,
  lng: number,
  startedAt: number,
  runId: Ulid,
): Promise<void> {
  for (const [index, hourKey] of keys.entries()) {
    // A later hour already cached by someone else's run at the same place
    // needs no upstream call.
    //
    // Stryker cannot kill the guard itself and neither can a test: hour 0
    // is *known* to be a miss, because `resolveAndAttach` looked it up and
    // returned early if it hit. Widening the guard therefore only adds a
    // query that always misses. It stays because that query is billed.
    // Stryker disable next-line ConditionalExpression,EqualityOperator
    if (index > 0) {
      const existing = await findObservationRow(hourKey);
      if (existing !== undefined) continue;
    }
    const at = new Date((startedAt + index * 3600) * 1000);
    const observation = await provider.observation(lat, lng, at);
    // Only the starting hour carries the run id: the row is a shared cache
    // cell, and the run's own conditions are its start.
    await upsertRealObservation(
      hourKey,
      observation,
      index === 0 ? runId : undefined,
    );
  }
}

/**
 * Public API: attach conditions to a run. No-op with a structured log when
 * the run is indoor/has no location/is already resolved; degrades to
 * `weather_pending` on provider failure — never throws (law 5).
 */
export async function attachObservation(runId: Ulid): Promise<AttachOutcome> {
  return resolveAndAttach(runId);
}

/**
 * Public API: R2b's band (D-24). The band is written against the run in
 * `manual_conditions`, never into the shared cache cell — a cell answers
 * for everyone who ran there that hour, and a band answers for one run
 * (B1). If a real observation already occupies this run's cache cell, that
 * wins and the run links to it instead of the guess.
 */
export async function recordManualObservation(
  runId: Ulid,
  tempC: number,
  // R2b's sky (task 127, STR-12); optional, so the write stays additive.
  sky?: ManualSky,
): Promise<void> {
  const [run] = await coreDb()
    .select()
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  if (!run) {
    throw new Error(`recordManualObservation: run ${runId} not found`);
  }
  if (isResolved(run.weatherStatus)) {
    return;
  }
  if (run.lat === null || run.lng === null) {
    throw new Error(
      `recordManualObservation: run ${runId} has no location to key the observation on`,
    );
  }
  const key = cacheKeyFor(run.lat, run.lng, new Date(run.startedAt * 1000));
  if ((await findObservationRow(key)) !== undefined) {
    await setStatus(runId, "attached");
    return;
  }
  // Two databases: the band goes to DIALED_WEATHER, the status to
  // DIALED_CORE, and batch() does not span them (law 8c). No outbox: a
  // failure between the two throws to the runner, whose run is still the
  // `failed` one R2b is offered for, so saving again lands the same row and
  // then the status. And `resolveAndAttach` reads the band first, so any
  // re-drive of the run settles it as `manual` too.
  await upsertManualBand(runId, tempC, sky);
  await setStatus(runId, "manual");
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

  const now = nowSeconds();
  const toFail = candidates
    .map((c) => ({ id: c.id, age: now - (c.importCreatedAt ?? c.startedAt) }))
    .filter((c) => c.age >= FAIL_AFTER_SECONDS);
  // Equivalent mutant: skipping this return changes nothing an assertion
  // can see — an empty `inArray` matches nothing, so the batch below fails
  // nothing, lists nothing and returns the same zero. What it saves is the
  // batch, on a cron that fires every hour.
  // Stryker disable next-line ConditionalExpression,EqualityOperator,BlockStatement
  if (toFail.length === 0) {
    return { claimed: candidates.length, attached, failed: 0 };
  }

  // Failed and on the Desk's Gave up together (R-119), and only what is
  // still `pending`: a run this pass attached, or one its runner saved a
  // band for since, is settled and must not be overwritten — nor listed,
  // so a row this batch wrote for a run it did not fail is taken back in
  // the same batch. What the update returns is what failed.
  const toFailIds = toFail.map((c) => c.id);
  const stillPending = and(
    inArray(runs.id, toFailIds),
    eq(runs.weatherStatus, "pending"),
  );
  const notFailed = db
    .select({ id: runs.id })
    .from(runs)
    .where(and(inArray(runs.id, toFailIds), ne(runs.weatherStatus, "failed")));
  const listedButNotFailed = and(
    eq(gaveUp.kind, "weather"),
    inArray(gaveUp.subjectId, notFailed),
  );
  const [failed] = await db.batch([
    db
      .update(runs)
      .set({ weatherStatus: "failed" })
      .where(stillPending)
      .returning({ id: runs.id }),
    ...toFail.map((c) =>
      gaveUpUpsert(db, {
        kind: "weather",
        subjectId: c.id,
        ...giveUpFact(c.age),
      }),
    ),
    db.delete(gaveUp).where(listedButNotFailed),
  ]);
  const failedIds = failed.map((row) => row.id);
  if (failedIds.length > 0) {
    console.warn("[weather] retry cron: exhausted, marking failed", {
      runIds: failedIds,
    });
  }
  return { claimed: candidates.length, attached, failed: failedIds.length };
}
