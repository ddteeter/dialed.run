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

async function insertRun(overrides: Partial<typeof runs.$inferInsert> = {}): Promise<Ulid> {
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
      lat: 70.1,
      lng: 30.1,
      indoor: 0,
      title: "Read test run",
      ...overrides,
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
