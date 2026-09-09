import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { runs } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid, type Ulid } from "../../src/lib/ids";
import {
  observationForRun,
  observationsForRuns,
  recordManualObservation,
  type WeatherReading,
} from "../../src/modules/weather";
import { cacheKeyFor, upsertRealObservation } from "../../src/modules/weather/store";

function coreDb() {
  return drizzle(env.DIALED_CORE);
}

async function insertRun(
  overrides: Partial<typeof runs.$inferInsert> & {
    /**
    Leave exactly one coordinate column unset, to make a half-located run.
    */
    omit?: "lat" | "lng";
  } = {},
): Promise<Ulid> {
  const { omit, ...rest } = overrides;
  const id = newUlid();
  await coreDb()
    .insert(runs)
    .values({
      id,
      userId: newUlid(),
      source: "manual",
      startedAt: 1_768_500_000,
      durationS: 1800,
      distanceM: 5000,
      ...(omit !== "lat" && { lat: 70.1 }),
      ...(omit !== "lng" && { lng: 30.1 }),
      indoor: false,
      title: "Read test run",
      ...rest,
    });
  return id;
}

describe("observationForRun (103, read API for 104)", () => {
  it("returns undefined when nothing is cached yet", async () => {
    const runId = await insertRun({ lat: 71.1, lng: 31.1 });
    expect(await observationForRun(runId)).toBeUndefined();
  });

  it("returns a manual reading tagged with its source", async () => {
    const runId = await insertRun({ lat: 72.1, lng: 32.1 });
    await recordManualObservation(runId, -8);
    const reading: WeatherReading | undefined = await observationForRun(runId);
    expect(reading?.source).toBe("manual");
    expect(reading?.tempC).toBe(-8);
  });

  it("returns a real reading tagged with its source", async () => {
    const runId = await insertRun({ lat: 73.1, lng: 33.1, startedAt: 1_768_500_000 });
    const key = cacheKeyFor(73.1, 33.1, new Date(1_768_500_000 * 1000));
    await upsertRealObservation(
      key,
      { tempC: 2, feelsLikeC: 0, humidity: 70, windKph: 10, precipMm: 0, condition: "cloudy" },
      runId,
    );
    const reading = await observationForRun(runId);
    expect(reading?.source).toBe("visualcrossing");
    expect(reading?.tempC).toBe(2);
  });
});

describe("observationsForRuns (103, consensus batch read for 104)", () => {
  it("excludes manual rows entirely", async () => {
    const manualRun = await insertRun({ lat: 74.1, lng: 34.1 });
    await recordManualObservation(manualRun, -2);

    const realRun = await insertRun({ lat: 75.1, lng: 35.1 });
    const key = cacheKeyFor(75.1, 35.1, new Date(1_768_500_000 * 1000));
    await upsertRealObservation(
      key,
      { tempC: 4, feelsLikeC: 2, humidity: 60, windKph: 8, precipMm: 0, condition: "clear" },
      realRun,
    );

    const results = await observationsForRuns([manualRun, realRun]);
    expect(results.has(manualRun)).toBe(false);
    expect(results.get(realRun)?.tempC).toBe(4);
  });

  it("returns an empty map for an empty input", async () => {
    const results = await observationsForRuns([]);
    expect(results.size).toBe(0);
  });
});

/**
 * The read API's refusals.
 *
 * Both functions decline to answer for a run they cannot key, and every
 * one of those branches survived mutation — the tests only ever asked
 * about runs that had both coordinates, so "returns undefined" was never
 * distinguished from "was never asked".
 *
 * The planted observations are what make the refusals visible. `cacheKeyFor`
 * rounds its inputs, so a null coordinate does not blow up — it rounds to
 * 0. Dropping half of the check therefore does not crash; it keys the run
 * to a different place on Earth and hands back somebody else's weather.
 * Each fixture below sits at exactly the half-key a dropped check would
 * produce.
 */
const ELSEWHERE = {
  tempC: 33,
  feelsLikeC: 35,
  humidity: 90,
  windKph: 2,
  precipMm: 0,
  condition: "somewhere else",
};

async function plantAt(lat: number, lng: number): Promise<void> {
  await upsertRealObservation(
    cacheKeyFor(lat, lng, new Date(1_768_500_000 * 1000)),
    ELSEWHERE,
    undefined,
  );
}

describe("observationForRun declines what it cannot key", () => {
  it("returns undefined for a run that does not exist", async () => {
    expect(await observationForRun(newUlid())).toBeUndefined();
  });

  it("returns undefined for a run missing only its longitude", async () => {
    await plantAt(79.1, 0);
    const runId = await insertRun({ omit: "lng", lat: 79.1 });
    expect(await observationForRun(runId)).toBeUndefined();
  });

  it("returns undefined for a run missing only its latitude", async () => {
    await plantAt(0, 39.1);
    const runId = await insertRun({ omit: "lat", lng: 39.1 });
    expect(await observationForRun(runId)).toBeUndefined();
  });
});

describe("observationsForRuns answers about exactly the runs it was asked about", () => {
  it("drops a run missing either coordinate rather than keying it to zero", async () => {
    await plantAt(80.1, 0);
    await plantAt(0, 40.1);
    const noLng = await insertRun({ omit: "lng", lat: 80.1 });
    const noLat = await insertRun({ omit: "lat", lng: 40.1 });

    const results = await observationsForRuns([noLng, noLat]);
    expect(results.size).toBe(0);
  });

  it("returns an empty map for no runs, even with runs in the table", async () => {
    // The early return, not the query returning nothing: without it, an
    // empty id list builds a `WHERE` that matches every run in the table.
    const cached = await insertRun({ lat: 76.1, lng: 36.1 });
    await upsertRealObservation(
      cacheKeyFor(76.1, 36.1, new Date(1_768_500_000 * 1000)),
      {
        tempC: 9,
        feelsLikeC: 8,
        humidity: 50,
        windKph: 4,
        precipMm: 0,
        condition: "clear",
      },
      cached,
    );

    const results = await observationsForRuns([]);
    expect(results.size).toBe(0);
  });

  it("does not answer about a run it was not asked about", async () => {
    const asked = await insertRun({ lat: 77.1, lng: 37.1 });
    const notAsked = await insertRun({ lat: 78.1, lng: 38.1 });
    for (const [runId, lat, lng] of [
      [asked, 77.1, 37.1],
      [notAsked, 78.1, 38.1],
    ] as const) {
      await upsertRealObservation(
        cacheKeyFor(lat, lng, new Date(1_768_500_000 * 1000)),
        {
          tempC: 3,
          feelsLikeC: 1,
          humidity: 55,
          windKph: 6,
          precipMm: 0,
          condition: "clear",
        },
        runId,
      );
    }

    const results = await observationsForRuns([asked]);
    expect(results.size).toBe(1);
    expect(results.has(asked)).toBe(true);
  });
});
