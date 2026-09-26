import { describe, expect, it } from "vitest";

import { newUlid } from "../../src/lib/ids";
import {
  bandObservation,
  cacheKeyFor,
  findManualBand,
  findObservationRow,
  hourBucketFor,
  manualBandsFor,
  roundCoord,
  toWeatherObservation,
  upsertManualBand,
  upsertRealObservation,
} from "../../src/modules/weather/store";
import { makeObservation } from "../feed/helpers";

import { nowSeconds } from "../../src/lib/now";
const OBSERVATION = {
  tempC: 5,
  feelsLikeC: 2.2,
  humidity: 88,
  windKph: 14,
  precipMm: 0.2,
  condition: "light rain",
};

describe("weather cache (103)", () => {
  it("rounds coordinates to 2dp and floors the hour", () => {
    expect(roundCoord(44.98014)).toBeCloseTo(44.98, 5);
    expect(roundCoord(-93.2651)).toBeCloseTo(-93.27, 5);
    const at = new Date("2026-01-15T07:45:00Z");
    expect(hourBucketFor(at)).toBe(Math.floor(at.getTime() / 3_600_000));
  });

  it("a miss writes through; a hit finds the row without any provider call", async () => {
    const at = new Date("2026-01-15T07:00:00Z");
    const key = cacheKeyFor(44.98, -93.27, at);
    expect(await findObservationRow(key)).toBeUndefined();

    const runId = newUlid();
    await upsertRealObservation(key, OBSERVATION, runId);

    const row = await findObservationRow(key);
    expect(row?.tempC).toBe(5);
    expect(row?.source).toBe("visualcrossing");
  });

  it("two coordinates rounding to the same cell share one row", async () => {
    const at = new Date("2026-02-01T12:00:00Z");
    const keyA = cacheKeyFor(45.0012, -93.1001, at);
    const keyB = cacheKeyFor(45.0014, -93.1004, at); // rounds identically
    expect(keyA).toEqual(keyB);

    await Promise.all([
      upsertRealObservation(keyA, OBSERVATION, newUlid()),
      upsertRealObservation(keyB, { ...OBSERVATION, tempC: 6 }, newUlid()),
    ]);

    const row = await findObservationRow(keyA);
    expect(row).toBeDefined();
  });

  it("does not find a legacy band in the cell: it is not the weather (B1)", async () => {
    const at = new Date("2026-03-01T09:00:00Z");
    await plantLegacyBand(40.1, -80.2, at);

    expect(
      await findObservationRow(cacheKeyFor(40.1, -80.2, at)),
    ).toBeUndefined();
  });

  it("a real fetch upgrades a legacy band occupying the same cell", async () => {
    const at = new Date("2026-03-02T09:00:00Z");
    const key = cacheKeyFor(40.2, -80.3, at);
    await plantLegacyBand(40.2, -80.3, at);

    await upsertRealObservation(key, OBSERVATION, newUlid());
    const row = await findObservationRow(key);
    expect(row?.source).toBe("visualcrossing");
    expect(row?.tempC).toBe(5);
  });

  it("a real row is never overwritten by a later fetch", async () => {
    const at = new Date("2026-04-01T09:00:00Z");
    const key = cacheKeyFor(41.1, -81.2, at);
    await upsertRealObservation(key, OBSERVATION, newUlid());

    await upsertRealObservation(key, { ...OBSERVATION, tempC: 99 }, newUlid());
    const row = await findObservationRow(key);
    expect(row?.tempC).toBe(5);
  });
});

/**
A band written the way it was before `manual_conditions`: into the cell.
*/
async function plantLegacyBand(lat: number, lng: number, at: Date) {
  await makeObservation({
    lat,
    lng,
    startedAt: at.getTime() / 1000,
    tempC: 30,
    feelsLikeC: 30,
    source: "manual",
  });
}

describe("a run's band (R2b, B1)", () => {
  it("is found by its run, and by no other", async () => {
    const runId = newUlid();
    await upsertManualBand(runId, 12.5);

    expect(await findManualBand(runId)).toMatchObject({ runId, tempC: 12.5 });
    expect(await findManualBand(newUlid())).toBeUndefined();
  });

  it("takes the latest pick when set again", async () => {
    const runId = newUlid();
    await upsertManualBand(runId, 2.5);
    await upsertManualBand(runId, 7.5);

    expect(await manualBandsFor([runId])).toStrictEqual([
      expect.objectContaining({ runId, tempC: 7.5 }),
    ]);
  });

  it("reads only the runs asked about", async () => {
    const asked = newUlid();
    const other = newUlid();
    await upsertManualBand(asked, 1);
    await upsertManualBand(other, 2);

    const bands = await manualBandsFor([asked]);
    expect(bands.map((band) => band.runId)).toStrictEqual([asked]);
  });

  it("reads nothing for no runs", async () => {
    await upsertManualBand(newUlid(), 1);
    expect(await manualBandsFor([])).toStrictEqual([]);
  });
});

describe("what a stored observation records about itself", () => {
  /**
   * `fetched_at` is seconds, and `Date.now()` is milliseconds. The
   * conversion had no assertion, so the mutant that multiplies where the
   * code divides — writing a value a thousand times too large — was
   * invisible. Staleness is judged against this column, and a row stamped
   * in the year 57000 is never stale.
   */
  it("stamps fetched_at in epoch seconds, not milliseconds", async () => {
    const now = nowSeconds();
    const key = cacheKeyFor(38.5, -85.5, new Date("2026-05-01T09:00:00Z"));

    await upsertRealObservation(key, OBSERVATION, newUlid());

    const row = await findObservationRow(key);
    expect(row?.fetchedAt).toBeGreaterThanOrEqual(now - 5);
    expect(row?.fetchedAt).toBeLessThanOrEqual(now + 5);
  });

  it("stamps a band's set_at the same way", async () => {
    const now = nowSeconds();
    const runId = newUlid();

    await upsertManualBand(runId, 12);

    const band = await findManualBand(runId);
    expect(band?.setAt).toBeGreaterThanOrEqual(now - 5);
    expect(band?.setAt).toBeLessThanOrEqual(now + 5);
  });

  it("fills a band's unmeasured fields with neutral sentinels", () => {
    // A band carries a temperature a runner picked and nothing else. It is
    // excluded from every aggregate, so the remaining fields are
    // placeholders — but `condition` is read straight onto the screen, and
    // an empty string there renders as a blank chip.
    expect(
      bandObservation({ runId: newUlid(), tempC: -8, setAt: 0, sky: "snow" }),
    ).toStrictEqual({
      tempC: -8,
      feelsLikeC: -8,
      humidity: 0,
      windKph: 0,
      precipMm: 0,
      condition: "manual",
    });
  });
});

describe("the observation's zone (D-96)", () => {
  it("stores the zone the provider named, so a cache hit can supply it", async () => {
    // On the observation, not the run, because a run whose hour is cached
    // never fetches — the row is the only place its zone can come from.
    const key = cacheKeyFor(41.88, -87.63, new Date("2026-04-01T11:00:00Z"));
    await upsertRealObservation(
      key,
      { ...OBSERVATION, timeZone: "America/Chicago" },
      newUlid(),
    );

    const row = await findObservationRow(key);
    expect(row?.timeZone).toBe("America/Chicago");
    expect(row && toWeatherObservation(row)).toMatchObject({
      timeZone: "America/Chicago",
    });
  });

  it("stores no zone when the fetch that upgrades a legacy band names none", async () => {
    // The only rows an upsert overwrites are legacy bands (`setWhere`),
    // and those never carry a zone — so a fetch without one leaves the
    // column empty rather than inventing or keeping anything.
    const at = new Date("2026-04-02T11:00:00Z");
    const key = cacheKeyFor(41.89, -87.64, at);
    await plantLegacyBand(41.89, -87.64, at);
    await upsertRealObservation(key, OBSERVATION, newUlid());

    const row = await findObservationRow(key);
    expect(row?.timeZone).toBeNull();
    expect(row && toWeatherObservation(row)).not.toHaveProperty("timeZone");
  });

  it("drops a stored zone this runtime would reject, on the way out", async () => {
    // The column is text. A zone valid when written can be one this ICU
    // does not know; it must not reach `Intl` at render time.
    const key = cacheKeyFor(41.91, -87.66, new Date("2026-04-04T11:00:00Z"));
    await upsertRealObservation(key, OBSERVATION, newUlid());
    const row = await findObservationRow(key);
    if (!row) throw new Error("no row");

    expect(
      toWeatherObservation({ ...row, timeZone: "Mars/Olympus_Mons" }),
    ).not.toHaveProperty("timeZone");
  });
});
