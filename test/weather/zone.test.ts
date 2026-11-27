import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { weatherObservations } from "../../src/db/schema-weather";
import { env } from "../../src/env";
import { timeZoneAt } from "../../src/modules/weather/zone";
import {
  mockVisualCrossing,
  visualCrossingCurrentBody,
  visualCrossingHours,
} from "./fixtures/visual-crossing-observation";

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Every hour cached at a latitude, whatever its longitude.
 */
async function cachedHoursAt(lat: number): Promise<number[]> {
  const rows = await drizzle(env.DIALED_WEATHER)
    .select()
    .from(weatherObservations)
    .where(eq(weatherObservations.latR, lat));
  return rows.map((row) => row.hourBucket);
}

/**
 * The profile's zone lookup (design 142): the configured provider's
 * reading for now, kept for its zone.
 */
describe("timeZoneAt", () => {
  it("answers the zone the provider names for the place, from one request", async () => {
    const fetchSpy = mockVisualCrossing();

    expect(await timeZoneAt(10.11, 20.22)).toBe("America/Chicago");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("answers nothing when the provider names no zone", async () => {
    const body = Object.fromEntries(
      Object.entries(visualCrossingCurrentBody(visualCrossingHours[0])).filter(
        ([key]) => key !== "timezone",
      ),
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(Response.json(body)),
    );

    expect(await timeZoneAt(10.33, 20.44)).toBeUndefined();
  });

  it("throws when the provider is unavailable, for the caller to degrade from", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response("down", { status: 503 })),
    );

    await expect(timeZoneAt(10.55, 20.66)).rejects.toThrow(/responded 503/u);
  });
});

/**
 * D-156: the hour a zone is looked up in has not settled, and the cache
 * cell it would land in is shared and never refreshed.
 */
describe("the zone lookup caches no hour (D-156)", () => {
  it("leaves no observation for the hour it asked about", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    vi.setSystemTime(new Date((1_768_485_600 + 600) * 1000));
    const fetchSpy = mockVisualCrossing();

    expect(await timeZoneAt(42.01, -72.01)).toBe("America/Chicago");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(await cachedHoursAt(42.01)).toStrictEqual([]);
  });
});
