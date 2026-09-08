import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runs } from "../../src/db/schema-core";
import { weatherObservations } from "../../src/db/schema-weather";
import { env } from "../../src/env";
import { newUlid, type Ulid } from "../../src/lib/ids";
import { attachObservation, recordManualObservation } from "../../src/modules/weather";
import { cacheKeyFor, upsertRealObservation } from "../../src/modules/weather/store";
import { visualCrossingObservationFixture } from "./fixtures/visual-crossing-observation";

const OBSERVATION_HOUR_EPOCH = 1_768_485_600; // 07:00 fixture hour

function coreDb() {
  return drizzle(env.DIALED_CORE);
}

/**
 * `lat`/`lng` default to a real location; pass `{ noLocation: true }` to
 * omit both entirely (leaving the nullable columns unset — NULL — rather
 * than assigning `null` explicitly).
 */
async function insertRun(
  overrides: Partial<typeof runs.$inferInsert> & { noLocation?: boolean } = {},
): Promise<Ulid> {
  const { noLocation, ...rest } = overrides;
  const id = newUlid();
  await coreDb()
    .insert(runs)
    .values({
      id,
      userId: newUlid(),
      source: "manual",
      startedAt: OBSERVATION_HOUR_EPOCH,
      durationS: 1800,
      distanceM: 5000,
      ...(!noLocation && { lat: 44.98, lng: -93.27 }),
      indoor: false,
      title: "Test run",
      ...rest,
    });
  return id;
}

async function statusOf(runId: Ulid): Promise<string | undefined> {
  const [row] = await coreDb().select().from(runs).where(eq(runs.id, runId)).limit(1);
  return row?.weatherStatus;
}

/**
 * A fresh Response per call. `mockResolvedValue` hands back the same object
 * every time, and a Response body can only be read once — which stayed
 * invisible while every test called fetch exactly once, and then showed up
 * as a parse failure the moment one sampled multiple hours.
 */
function mockFetchJson(body: unknown, status = 200) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => Promise.resolve(Response.json(body, { status })));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("attachObservation (103)", () => {
  it("no-ops on an indoor run and leaves status unchanged", async () => {
    const fetchSpy = mockFetchJson(visualCrossingObservationFixture);
    const runId = await insertRun({ indoor: true, noLocation: true });
    await attachObservation(runId);
    expect(await statusOf(runId)).toBe("none");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("no-ops on a run with no location", async () => {
    const fetchSpy = mockFetchJson(visualCrossingObservationFixture);
    const runId = await insertRun({ noLocation: true });
    await attachObservation(runId);
    expect(await statusOf(runId)).toBe("none");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a cache hit attaches without ever calling the provider", async () => {
    const runId = await insertRun({ lat: 50.5, lng: 12.5 });
    const key = cacheKeyFor(50.5, 12.5, new Date(OBSERVATION_HOUR_EPOCH * 1000));
    await upsertRealObservation(
      key,
      {
        tempC: 1,
        feelsLikeC: -1,
        humidity: 90,
        windKph: 5,
        precipMm: 0,
        condition: "fog",
      },
      newUlid(),
    );
    const fetchSpy = mockFetchJson(visualCrossingObservationFixture);
    await attachObservation(runId);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await statusOf(runId)).toBe("attached");
  });

  it("a cache miss fetches, writes through, and attaches", async () => {
    const runId = await insertRun({ lat: 51.5, lng: 13.5 });
    mockFetchJson(visualCrossingObservationFixture);
    await attachObservation(runId);
    expect(await statusOf(runId)).toBe("attached");
  });

  it("a provider failure degrades to pending, never throwing", async () => {
    const runId = await insertRun({ lat: 52.5, lng: 14.5 });
    mockFetchJson({ unexpected: "shape" });
    await expect(attachObservation(runId)).resolves.toBeUndefined();
    expect(await statusOf(runId)).toBe("pending");
  });

  it("is idempotent: re-invoking an attached run never calls the provider again", async () => {
    const runId = await insertRun({ lat: 53.5, lng: 15.5 });
    const fetchSpy = mockFetchJson(visualCrossingObservationFixture);
    await attachObservation(runId);
    expect(await statusOf(runId)).toBe("attached");
    fetchSpy.mockClear();

    await attachObservation(runId);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await statusOf(runId)).toBe("attached");
  });
});

describe("attachObservation samples every hour a run spans", () => {
  /**
   * A long run resolved only at its start hour is remembered as the
   * conditions it began in. The verdict covers the whole run, so that
   * mislabels the training signal the call epic depends on — a 9-11am run
   * that warmed up 8 degrees would teach the model that the *starting*
   * temperature meant overdressed.
   */
  it("resolves one observation per hour bucket for a multi-hour run", async () => {
    const fetchSpy = mockFetchJson(visualCrossingObservationFixture);
    // Its own coordinates: observations are a shared cache keyed by
    // rounded lat/lng/hour, and these tests share a database, so a
    // location another test already resolved would be a cache hit here.
    const lat = 40.11;
    const lng = -70.11;
    // Starts on the hour and runs for two hours: hours 0, 1 and 2.
    const runId = await insertRun({ durationS: 2 * 3600, lat, lng });

    await attachObservation(runId);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(await statusOf(runId)).toBe("attached");

    const stored = await drizzle(env.DIALED_WEATHER)
      .select()
      .from(weatherObservations)
      .where(eq(weatherObservations.latR, lat));
    const buckets = stored.map((row) => row.hourBucket);
    const startBucket = Math.floor(OBSERVATION_HOUR_EPOCH / 3600);
    expect(new Set(buckets)).toEqual(
      new Set([startBucket, startBucket + 1, startBucket + 2]),
    );
  });

  it("still resolves exactly one observation for a short run", async () => {
    const fetchSpy = mockFetchJson(visualCrossingObservationFixture);
    const runId = await insertRun({ durationS: 1500, lat: 41.22, lng: -71.22 });

    await attachObservation(runId);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not re-fetch a later hour another run already cached", async () => {
    const startBucket = Math.floor(OBSERVATION_HOUR_EPOCH / 3600);
    await upsertRealObservation(
      { latR: 42.33, lngR: -72.33, hourBucket: startBucket + 1 },
      {
        tempC: 5,
        feelsLikeC: 3,
        humidity: 70,
        windKph: 10,
        precipMm: 0,
        condition: "clear",
      },
      undefined,
    );
    const fetchSpy = mockFetchJson(visualCrossingObservationFixture);
    const runId = await insertRun({ durationS: 3600, lat: 42.33, lng: -72.33 });

    await attachObservation(runId);

    // Hour 0 is fetched; hour 1 was already in the shared cache.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("recordManualObservation (103, D-24)", () => {
  it("writes a manual row, links it, and never overwrites a resolved run", async () => {
    const runId = await insertRun({ lat: 54.5, lng: 16.5 });
    await recordManualObservation(runId, -3);
    expect(await statusOf(runId)).toBe("manual");

    // Idempotent against an already-resolved run: a second call is a no-op.
    await recordManualObservation(runId, 40);
    expect(await statusOf(runId)).toBe("manual");
  });

  it("throws rather than crashing silently when the run has no location", async () => {
    const runId = await insertRun({ noLocation: true });
    await expect(recordManualObservation(runId, 10)).rejects.toThrow();
  });
});
