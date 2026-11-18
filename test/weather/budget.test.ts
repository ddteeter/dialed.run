import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";

import { rateLimits } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import {
  WEATHER_CALLS_PER_DAY,
  WeatherBudgetSpentError,
  isWeatherBudgetSpent,
  runnerWeatherBudget,
  spendNothing,
} from "../../src/modules/weather/budget";
import { climateNormalsFor } from "../../src/modules/weather/normals";
import { resolvePlaceFor } from "../../src/modules/weather/place";
import { timeZoneAtFor } from "../../src/modules/weather/zone";
import { countRow } from "../rate-limit-rows";

/**
 * Each runner's day's budget of provider calls (SA-M13, SA-M27): what
 * every runner-caused lookup spends before it reaches the provider.
 */
const db = drizzle(env.DIALED_CORE);

async function spendAll(userId: string): Promise<void> {
  await db
    .insert(rateLimits)
    .values(
      countRow("weather-runner", userId, WEATHER_CALLS_PER_DAY, nowSeconds()),
    );
}

async function spentBy(userId: string): Promise<number | undefined> {
  const [row] = await db
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(eq(rateLimits.subject, userId));
  return row?.count;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("runnerWeatherBudget", () => {
  it("allows the day's calls, then refuses the next", async () => {
    const userId = newUlid();
    const spend = runnerWeatherBudget(userId);
    for (let n = 0; n < WEATHER_CALLS_PER_DAY; n += 1) await spend();
    await expect(spend()).rejects.toBeInstanceOf(WeatherBudgetSpentError);
    await expect(spend()).rejects.toThrow(
      "The runner's weather budget for the day is spent",
    );
    expect(await spentBy(userId)).toBe(WEATHER_CALLS_PER_DAY + 2);
  });

  it("keeps the count a day, under the runner's id", async () => {
    const userId = newUlid();
    await runnerWeatherBudget(userId)();
    const [row] = await db
      .select()
      .from(rateLimits)
      .where(eq(rateLimits.subject, userId));
    expect(row).toMatchObject({ kind: "weather-runner", count: 1 });
    await spendAll(newUlid());
    await expect(runnerWeatherBudget(userId)()).resolves.toBeUndefined();
  });

  it("holds a count begun earlier in the day", async () => {
    const userId = newUlid();
    await db
      .insert(rateLimits)
      .values(
        countRow(
          "weather-runner",
          userId,
          WEATHER_CALLS_PER_DAY,
          nowSeconds() - 2 * 60 * 60,
        ),
      );
    await expect(runnerWeatherBudget(userId)()).rejects.toBeInstanceOf(
      WeatherBudgetSpentError,
    );
  });

  it("names a spent budget apart from a provider failure", () => {
    const spent = new WeatherBudgetSpentError();
    expect(spent.name).toBe("WeatherBudgetSpentError");
    expect(isWeatherBudgetSpent(spent)).toBe(true);
    expect(isWeatherBudgetSpent(new Error("provider down"))).toBe(false);
  });

  it("counts nothing for a call no runner caused", async () => {
    await expect(spendNothing()).resolves.toBeUndefined();
  });
});

describe("the runner's lookups, past the budget", () => {
  it("asks the provider nothing for a city, normals or a zone", async () => {
    const userId = newUlid();
    await spendAll(userId);
    const fetchSpy = vi.fn(() => Promise.resolve(Response.json({})));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      resolvePlaceFor(userId)("Portland, OR"),
    ).rejects.toBeInstanceOf(WeatherBudgetSpentError);
    await expect(
      climateNormalsFor(userId)({
        kind: "coordinates",
        lat: 44.98,
        lng: -93.27,
      }),
    ).rejects.toBeInstanceOf(WeatherBudgetSpentError);
    await expect(timeZoneAtFor(userId)(12.34, 56.78)).rejects.toBeInstanceOf(
      WeatherBudgetSpentError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("spends one for each lookup that reaches the provider", async () => {
    const userId = newUlid();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            latitude: 45.52,
            longitude: -122.68,
            resolvedAddress: "Portland, OR, United States",
          }),
        ),
      ),
    );
    await resolvePlaceFor(userId)("Portland, OR");
    expect(await spentBy(userId)).toBe(1);
  });
});
