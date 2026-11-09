import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runConditions, runs } from "../../src/db/schema-core";
import {
  manualConditions,
  weatherObservations,
} from "../../src/db/schema-weather";
import { env } from "../../src/env";
import type { WeatherObservation } from "../../src/lib/contracts";
import { newUlid, type Ulid } from "../../src/lib/ids";
import {
  attachObservation,
  conditionsForRuns,
  recordManualObservation,
  retryPendingWeather,
} from "../../src/modules/weather";
import { weatherHalfOf } from "../../src/lib/contracts";
import { weatherHalfStatements } from "../../src/modules/weather/run-conditions-copy";
import {
  cacheKeyFor,
  upsertRealObservation,
} from "../../src/modules/weather/store";

/**
 * Weather's half of `run_conditions` (D-175, design 189): written in the
 * batch that settles a run, from the same derivation the feed reads, and
 * cleared by the hourly cron when the run is owed weather again.
 */

const HOUR = 3600;
/**
A settled hour long past, at the top of the hour.
*/
const STARTED = 1_768_485_600;
const PLACE = { lat: 44.98, lng: -93.27 };

function core() {
  return drizzle(env.DIALED_CORE);
}

async function insertRun(
  overrides: Partial<typeof runs.$inferInsert> = {},
): Promise<Ulid> {
  const id = newUlid();
  await core()
    .insert(runs)
    .values({
      id,
      userId: newUlid(),
      source: "manual",
      startedAt: STARTED,
      durationS: 1800,
      distanceM: 5000,
      ...PLACE,
      indoor: false,
      title: "Test run",
      ...overrides,
    });
  return id;
}

function reading(feelsLikeC: number, precipMm = 0): WeatherObservation {
  return {
    tempC: feelsLikeC + 2,
    feelsLikeC,
    humidity: 60,
    windKph: 8,
    precipMm,
    condition: "clear",
  };
}

async function cache(
  hourOffset: number,
  observation: WeatherObservation,
): Promise<void> {
  const key = cacheKeyFor(
    PLACE.lat,
    PLACE.lng,
    new Date((STARTED + hourOffset * HOUR) * 1000),
  );
  await upsertRealObservation(key, observation);
}

async function copyOf(runId: string) {
  const [row] = await core()
    .select()
    .from(runConditions)
    .where(eq(runConditions.runId, runId));
  return row;
}

/**
One column of a run's copy.
*/
async function copied<K extends keyof typeof runConditions.$inferSelect>(
  runId: string,
  column: K,
) {
  const row = await copyOf(runId);
  return row?.[column];
}

/**
Asserts the run's copy holds no weather half, and returns the row.
*/
async function expectNoWeather(runId: string) {
  const row = await copyOf(runId);
  expect(row).toBeDefined();
  for (const column of [
    "feelsLikeC",
    "minFeelsLikeC",
    "maxFeelsLikeC",
    "precipClass",
    "source",
  ] as const) {
    expect(row?.[column]).toBeNull();
  }
  return row;
}

/**
What the derivation says now, as the weather half's columns.
*/
async function liveHalfOf(runId: string) {
  const [run] = await core().select().from(runs).where(eq(runs.id, runId));
  if (run === undefined) throw new Error("no such run");
  const derived = await conditionsForRuns([run]);
  const conditions = derived.get(runId);
  if (conditions === undefined) throw new Error("no conditions");
  return weatherHalfOf(conditions);
}

function nothing(): void {
  /*
   * Swallows the degraded paths' warnings.
   */
}

beforeEach(async () => {
  await core().delete(runConditions);
  await core().delete(runs);
  await drizzle(env.DIALED_WEATHER).delete(weatherObservations);
  await drizzle(env.DIALED_WEATHER).delete(manualConditions);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the weather half, written as a run settles", () => {
  it("copies what the derivation says, start, coldest and warmest", async () => {
    // Three hours: it set out at 4, dipped to 1, finished at 9.
    const runId = await insertRun({ durationS: 2 * HOUR + 600 });
    await cache(0, reading(4));
    await cache(1, reading(1));
    await cache(2, reading(9, 3));

    expect(await attachObservation(runId)).toBe("attached");

    const row = await copyOf(runId);
    expect(row).toMatchObject({
      feelsLikeC: 4,
      minFeelsLikeC: 1,
      maxFeelsLikeC: 9,
      // The starting hour's, as every reader's precipitation is.
      precipClass: "dry",
      source: "visualcrossing",
    });
    // Pinned against a live derivation, not restated: derive, don't mirror.
    expect(row).toMatchObject(await liveHalfOf(runId));
  });

  it("names the runner, whose purge deletes it", async () => {
    const userId = newUlid();
    const runId = await insertRun({ userId });
    await cache(0, reading(6));
    await attachObservation(runId);
    expect(await copied(runId, "userId")).toBe(userId);
  });

  it("classes the starting hour's precipitation", async () => {
    const runId = await insertRun();
    await cache(0, reading(6, 3));
    await attachObservation(runId);
    expect(await copied(runId, "precipClass")).toBe("wet");
  });

  it("copies a band its runner set, tagged manual", async () => {
    vi.spyOn(console, "warn").mockImplementation(nothing);
    const runId = await insertRun({ weatherStatus: "failed" });
    await recordManualObservation(runId, 3);
    const row = await copyOf(runId);
    expect(row?.source).toBe("manual");
    // A band is one pick for the whole run: its span is that one point.
    expect(row?.feelsLikeC).toStrictEqual(expect.any(Number));
    expect(row?.minFeelsLikeC).toBe(row?.feelsLikeC);
    expect(row?.maxFeelsLikeC).toBe(row?.feelsLikeC);
    expect(row).toMatchObject(await liveHalfOf(runId));
  });

  it("leaves feed's half as it was", async () => {
    const runId = await insertRun();
    await core()
      .insert(runConditions)
      .values({
        runId,
        userId: newUlid(),
        verdict: -1,
        entryCreatedAt: STARTED + HOUR,
        entryShared: true,
      });
    await cache(0, reading(6));
    await attachObservation(runId);
    expect(await copyOf(runId)).toMatchObject({
      verdict: -1,
      entryCreatedAt: STARTED + HOUR,
      entryShared: true,
      feelsLikeC: 6,
    });
  });

  it("writes nothing for a run still owed hours", async () => {
    vi.spyOn(console, "warn").mockImplementation(nothing);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    const runId = await insertRun();
    expect(await attachObservation(runId)).toBe("pending");
    expect(await copyOf(runId)).toBeUndefined();
  });
});

describe("weatherHalfStatements", () => {
  it("is empty for a run that is gone", async () => {
    expect(await weatherHalfStatements(core(), newUlid())).toStrictEqual([]);
  });

  it("clears the weather half of a run with no conditions to copy", async () => {
    const runId = await insertRun();
    await core().insert(runConditions).values({
      runId,
      userId: newUlid(),
      feelsLikeC: 6,
      minFeelsLikeC: 6,
      maxFeelsLikeC: 6,
      precipClass: "dry",
      source: "visualcrossing",
      verdict: 0,
    });
    const statements = await weatherHalfStatements(core(), runId);
    for (const statement of statements) await statement;
    const row = await expectNoWeather(runId);
    expect(row?.verdict).toBe(0);
  });
});

describe("the hourly cron's repair", () => {
  it("clears a stale half on a run owed weather again, and keeps feed's", async () => {
    vi.spyOn(console, "warn").mockImplementation(nothing);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    const runId = await insertRun({ weatherStatus: "pending" });
    const settled = await insertRun({ weatherStatus: "attached" });
    for (const id of [runId, settled]) {
      await core().insert(runConditions).values({
        runId: id,
        userId: newUlid(),
        feelsLikeC: 6,
        minFeelsLikeC: 6,
        maxFeelsLikeC: 6,
        precipClass: "dry",
        source: "visualcrossing",
        verdict: 1,
      });
    }

    await retryPendingWeather();

    const row = await expectNoWeather(runId);
    expect(row?.verdict).toBe(1);
    // A settled run is not the cron's to touch.
    expect(await copied(settled, "feelsLikeC")).toBe(6);
  });

  it("writes a fresh half for a pending run that settles on this pass", async () => {
    const runId = await insertRun({ weatherStatus: "pending" });
    await cache(0, reading(-3));
    await retryPendingWeather();
    expect(await copied(runId, "feelsLikeC")).toBe(-3);
  });
});
