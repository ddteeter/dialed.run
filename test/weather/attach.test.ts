import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runs } from "../../src/db/schema-core";
import { weatherObservations } from "../../src/db/schema-weather";
import { env } from "../../src/env";
import { newUlid, type Ulid } from "../../src/lib/ids";
import {
  attachObservation,
  recordManualObservation,
  retryPendingWeather,
} from "../../src/modules/weather";
import {
  cacheKeyFor,
  upsertManualObservation,
  upsertRealObservation,
} from "../../src/modules/weather/store";
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
  overrides: Partial<typeof runs.$inferInsert> & {
    noLocation?: boolean;
    /**
    Leave exactly one coordinate column unset, to make a half-located run.
    */
    omit?: "lat" | "lng";
  } = {},
): Promise<Ulid> {
  const { noLocation, omit, ...rest } = overrides;
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
      ...(!noLocation && {
        ...(omit !== "lat" && { lat: 44.98 }),
        ...(omit !== "lng" && { lng: -93.27 }),
      }),
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
/**
 * Swallows a `console.warn` and hands back the spy. Every degraded path
 * logs, and a test that lets those through buries the real output.
 */
function silenceWarn() {
  return vi.spyOn(console, "warn").mockImplementation(nothing);
}

function nothing(): void {
  /*
   * The point is to do nothing.
   */
}

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
    await expect(attachObservation(runId)).resolves.toBe("pending");
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

    // Idempotent against an already-resolved run: a second call is a
    // no-op, and asserting the *temperature* is what proves it. The status
    // is "manual" either way, so a second write would land unnoticed.
    await recordManualObservation(runId, 40);
    expect(await statusOf(runId)).toBe("manual");
    const stored = await observationsAt(54.5);
    expect(
      stored.get(Math.floor(OBSERVATION_HOUR_EPOCH / 3600))?.tempC,
    ).toBeCloseTo(-3, 5);
  });

  it("throws rather than crashing silently when the run has no location", async () => {
    const runId = await insertRun({ noLocation: true });
    await expect(recordManualObservation(runId, 10)).rejects.toThrow();
  });
});

/**
 * The degraded paths, asserted rather than assumed.
 *
 * `attachObservation` returns its outcome and never throws (law 5), which
 * makes "what happened" a value a caller — and a test — can read. Every
 * one of these was a surviving mutant: the outcome strings could all be
 * emptied, the not-found branch was never entered at all, and the warn
 * calls that are the only operational trace of a degradation could be
 * silenced without a test noticing.
 */
describe("attachObservation reports what it did", () => {
  it("skips a run that does not exist, and says so in the log", async () => {
    const warn = silenceWarn();
    const missing = newUlid();

    await expect(attachObservation(missing)).resolves.toBe("skipped-not-found");

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("attach: run not found"),
      { runId: missing },
    );
  });

  it("skips an already-resolved run without touching it", async () => {
    const runId = await insertRun({ lat: 55.5, lng: 17.5 });
    mockFetchJson(visualCrossingObservationFixture);
    expect(await attachObservation(runId)).toBe("attached");

    expect(await attachObservation(runId)).toBe("skipped-resolved");
  });

  it("skips an indoor run, logging which run and that it was indoor", async () => {
    const warn = silenceWarn();
    const runId = await insertRun({ indoor: true, noLocation: true });

    await expect(attachObservation(runId)).resolves.toBe("skipped-no-location");

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("attach: no-op"),
      { runId, indoor: true },
    );
  });

  it("skips an outdoor run with no coordinates", async () => {
    silenceWarn();
    const runId = await insertRun({ noLocation: true });
    await expect(attachObservation(runId)).resolves.toBe("skipped-no-location");
  });

  it("degrades to pending and logs why when the provider fails", async () => {
    const warn = silenceWarn();
    const runId = await insertRun({ lat: 56.5, lng: 18.5 });
    mockFetchJson({ unexpected: "shape" });

    await expect(attachObservation(runId)).resolves.toBe("pending");

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("provider call failed"),
      // The run id is what makes the line actionable; an empty context
      // object is the mutant that hides it.
      expect.objectContaining({ runId }),
    );
  });

  it("reports `manual` when the cached row for the hour was typed by a human", async () => {
    const runId = await insertRun({ lat: 57.5, lng: 19.5 });
    // A different run already recorded a manual temp for this hour and
    // place. The distinction that matters is resolved-vs-typed, so this
    // run inherits `manual` — not `attached`.
    await upsertManualObservation(
      cacheKeyFor(57.5, 19.5, new Date(OBSERVATION_HOUR_EPOCH * 1000)),
      -7,
      newUlid(),
    );
    const fetchSpy = mockFetchJson(visualCrossingObservationFixture);

    expect(await attachObservation(runId)).toBe("manual");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await statusOf(runId)).toBe("manual");
  });
});

/**
Every observation row stored for this rounded latitude, by hour bucket.
*/
async function observationsAt(lat: number): Promise<
  Map<number, { tempC: number; runId: string | null }>
> {
  const rows = await drizzle(env.DIALED_WEATHER)
    .select()
    .from(weatherObservations)
    .where(eq(weatherObservations.latR, lat));
  return new Map(
    rows.map((row) => [row.hourBucket, { tempC: row.tempC, runId: row.runId }]),
  );
}

describe("each sampled hour gets that hour's weather", () => {
  /**
   * Not the same assertion as "three buckets were written". The bucket
   * comes from the run's own clock; the *temperature* comes from the date
   * handed to the provider, and those are two different computations. With
   * only the bucket asserted, every arithmetic mutant in the date — a
   * multiply flipped to a divide, a plus to a minus — wrote three rows
   * with the right keys and the wrong weather, silently.
   *
   * The fixture's hours are 06:00 (-5.6), 07:00 (-4.8) and 08:00 (-3.9),
   * and the provider picks the nearest, so a shifted date shows up as the
   * wrong temperature rather than a missing row.
   */
  it("stores hour 0's temperature in hour 0 and hour 1's in hour 1", async () => {
    mockFetchJson(visualCrossingObservationFixture);
    const lat = 43.44;
    const lng = -73.44;
    const runId = await insertRun({ durationS: 3600, lat, lng });

    await attachObservation(runId);

    const startBucket = Math.floor(OBSERVATION_HOUR_EPOCH / 3600);
    const stored = await observationsAt(lat);
    expect(stored.get(startBucket)?.tempC).toBeCloseTo(-4.8, 5);
    expect(stored.get(startBucket + 1)?.tempC).toBeCloseTo(-3.9, 5);
  });

  it("links only the starting hour to the run", async () => {
    // The row is a shared cache cell — a later hour belongs to everyone
    // who runs through it. Linking every sampled hour to this run would
    // make one run look like several to anything reading `run_id`.
    mockFetchJson(visualCrossingObservationFixture);
    const lat = 43.55;
    const lng = -73.55;
    const runId = await insertRun({ durationS: 3600, lat, lng });

    await attachObservation(runId);

    const startBucket = Math.floor(OBSERVATION_HOUR_EPOCH / 3600);
    const stored = await observationsAt(lat);
    expect(stored.get(startBucket)?.runId).toBe(runId);
    expect(stored.get(startBucket + 1)?.runId).toBeNull();
  });
});

describe("a half-located run is not located", () => {
  // `lat || lng` being null is one condition with two ways to be true, and
  // every fixture set both or neither — so the mutant that turns the `||`
  // into an `&&` (needing *both* to be missing) survived. A run with a
  // latitude and no longitude cannot be keyed.
  it("skips a run with a latitude but no longitude", async () => {
    silenceWarn();
    const runId = await insertRun({ omit: "lng" });
    await expect(attachObservation(runId)).resolves.toBe("skipped-no-location");
  });

  it("skips a run with a longitude but no latitude", async () => {
    silenceWarn();
    const runId = await insertRun({ omit: "lat" });
    await expect(attachObservation(runId)).resolves.toBe("skipped-no-location");
  });

  it("skips an outdoor run that is fully located only because it is indoors", async () => {
    // The `indoor` arm on its own, with both coordinates present.
    silenceWarn();
    const runId = await insertRun({ indoor: true, lat: 46.1, lng: -76.1 });
    await expect(attachObservation(runId)).resolves.toBe("skipped-no-location");
  });
});

describe("recordManualObservation refuses what it cannot key", () => {
  it("names the run it could not find", async () => {
    const missing = newUlid();
    // Unlike attach, this one throws: it is a user typing a temperature
    // into a form, so a silent no-op would look like a successful save.
    await expect(recordManualObservation(missing, 5)).rejects.toThrow(missing);
  });

  it("names the run that has half a location", async () => {
    const runId = await insertRun({ omit: "lng" });
    await expect(recordManualObservation(runId, 5)).rejects.toThrow(
      /no location/,
    );
  });

  it("links to a real observation rather than overwriting it with a guess", async () => {
    // The manual write never wins against a resolved row, so the run ends
    // up `attached` — reading the row back is what tells us which it got,
    // and the status has to follow the row rather than the intent.
    const lat = 47.25;
    const lng = -77.25;
    const runId = await insertRun({ lat, lng });
    await upsertRealObservation(
      cacheKeyFor(lat, lng, new Date(OBSERVATION_HOUR_EPOCH * 1000)),
      {
        tempC: 2,
        feelsLikeC: 0,
        humidity: 60,
        windKph: 8,
        precipMm: 0,
        condition: "clear",
      },
      undefined,
    );

    await recordManualObservation(runId, -20);

    expect(await statusOf(runId)).toBe("attached");
    const stored = await observationsAt(lat);
    expect(
      stored.get(Math.floor(OBSERVATION_HOUR_EPOCH / 3600))?.tempC,
    ).toBeCloseTo(2, 5);
  });

  it("leaves an already-attached run alone", async () => {
    const runId = await insertRun({ lat: 48.35, lng: -78.35 });
    mockFetchJson(visualCrossingObservationFixture);
    await attachObservation(runId);
    expect(await statusOf(runId)).toBe("attached");

    await recordManualObservation(runId, 30);

    expect(await statusOf(runId)).toBe("attached");
    const stored = await observationsAt(48.35);
    expect(
      stored.get(Math.floor(OBSERVATION_HOUR_EPOCH / 3600))?.tempC,
    ).toBeCloseTo(-4.8, 5);
  });
});

describe("a run whose conditions are already settled is left alone", () => {
  it("skips a run resolved from a human-typed temperature", async () => {
    // "Resolved" is two statuses, and only `attached` was ever tested —
    // so the `manual` half of the check could be deleted without a
    // failure, and the retry cron would have re-fetched every run whose
    // temperature someone had typed.
    const runId = await insertRun({ lat: 49.45, lng: -79.45 });
    await recordManualObservation(runId, -12);
    expect(await statusOf(runId)).toBe("manual");
    const fetchSpy = mockFetchJson(visualCrossingObservationFixture);

    expect(await attachObservation(runId)).toBe("skipped-resolved");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not re-key a run marked attached whose cache cell is empty", async () => {
    // The state an older row can be in: the status says settled, the cell
    // it pointed at is gone. Writing a manual guess into it now would
    // rewrite history for every run sharing that cell.
    const runId = await insertRun({
      lat: 49.55,
      lng: -79.55,
      weatherStatus: "attached",
    });

    await recordManualObservation(runId, 25);

    expect(await statusOf(runId)).toBe("attached");
    const stored = await observationsAt(49.55);
    expect(stored.size).toBe(0);
  });

  it("counts a run that resolves to a typed temperature as attached", async () => {
    // The retry cron's tally: `manual` counts as resolved, because the
    // run leaves the pending queue either way.
    const lat = 49.65;
    const lng = -79.65;
    await upsertManualObservation(
      cacheKeyFor(lat, lng, new Date(OBSERVATION_HOUR_EPOCH * 1000)),
      -14,
      newUlid(),
    );
    const runId = await insertRun({ lat, lng, weatherStatus: "pending" });
    mockFetchJson(visualCrossingObservationFixture);

    const result = await retryPendingWeather();

    expect(await statusOf(runId)).toBe("manual");
    expect(result.attached).toBeGreaterThanOrEqual(1);
  });
});

/**
Someone else's weather, at the cell a dropped coordinate check would key to.
*/
async function plantAt(lat: number, lng: number): Promise<void> {
  await upsertRealObservation(
    cacheKeyFor(lat, lng, new Date(OBSERVATION_HOUR_EPOCH * 1000)),
    {
      tempC: 33,
      feelsLikeC: 35,
      humidity: 90,
      windKph: 2,
      precipMm: 0,
      condition: "somewhere else",
    },
    undefined,
  );
}

describe("half a location is no location, in every direction", () => {
  /**
   * `cacheKeyFor` rounds, and rounding `null` gives 0 — so dropping half
   * of a "no coordinates" check does not crash, it keys the run to a
   * different place on Earth. Planting an observation at each half-key is
   * what makes that visible: with the check intact these runs resolve to
   * nothing, and with half of it gone they resolve to someone else's
   * weather.
   */
  it("refuses a manual temperature for a run missing only its latitude", async () => {
    await plantAt(0, 31.75);
    const runId = await insertRun({ omit: "lat", lng: 31.75 });
    await expect(recordManualObservation(runId, 5)).rejects.toThrow(
      /no location/,
    );
  });

  it("refuses a manual temperature for a run missing only its longitude", async () => {
    await plantAt(31.85, 0);
    const runId = await insertRun({ omit: "lng", lat: 31.85 });
    await expect(recordManualObservation(runId, 5)).rejects.toThrow(
      /no location/,
    );
  });
});
