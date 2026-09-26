import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { runs } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid, type Ulid } from "../../src/lib/ids";
import {
  manualReadingsForRuns,
  observationsForRuns,
  recordManualObservation,
} from "../../src/modules/weather";
import {
  cacheKeyFor,
  upsertRealObservation,
} from "../../src/modules/weather/store";
import { makeObservation } from "../feed/helpers";

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

describe("manualReadingsForRuns: a band is its own run's (B1)", () => {
  it("answers nothing for a run with no band", async () => {
    const runId = await insertRun({ lat: 71.1, lng: 31.1 });
    const bands = await manualReadingsForRuns([runId]);
    expect(bands.size).toBe(0);
  });

  it("returns a band tagged manual, with its sentinels", async () => {
    const runId = await insertRun({ lat: 72.1, lng: 32.1 });
    await recordManualObservation(runId, -8);

    const bands = await manualReadingsForRuns([runId]);
    expect(bands.get(runId)).toStrictEqual({
      tempC: -8,
      feelsLikeC: -8,
      humidity: 0,
      windKph: 0,
      precipMm: 0,
      condition: "manual",
      source: "manual",
    });
  });

  it("never answers for another run in the same place and hour", async () => {
    const theirs = await insertRun({ lat: 72.2, lng: 32.2 });
    await recordManualObservation(theirs, -8);
    const mine = await insertRun({ lat: 72.2, lng: 32.2 });

    const bands = await manualReadingsForRuns([theirs, mine]);
    expect(bands.has(theirs)).toBe(true);
    expect(bands.has(mine)).toBe(false);
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
      {
        tempC: 4,
        feelsLikeC: 2,
        humidity: 60,
        windKph: 8,
        precipMm: 0,
        condition: "clear",
      },
      realRun,
    );

    const results = await observationsForRuns([manualRun, realRun]);
    expect(results.has(manualRun)).toBe(false);
    expect(results.get(realRun)?.tempC).toBe(4);
  });

  it("skips a legacy band still in the cache cell", async () => {
    // Written before `manual_conditions` existed: somebody's band, in a
    // cell every runner there reads.
    await makeObservation({
      lat: 74.2,
      lng: 34.2,
      startedAt: 1_768_500_000,
      tempC: -2,
      feelsLikeC: -2,
      source: "manual",
    });
    const runId = await insertRun({ lat: 74.2, lng: 34.2 });

    const results = await observationsForRuns([runId]);
    expect(results.has(runId)).toBe(false);
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
