import { env } from "../src/env";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { garmentSchema, runDraftSchema } from "../src/lib/contracts";
import { newUlid, ulidSchema } from "../src/lib/ids";
import { runs, wardrobeItems } from "../src/db/schema-core";
import { weatherObservations } from "../src/db/schema-weather";

describe("dialed-core schema", () => {
  it("roundtrips a wardrobe item and a run against real D1", async () => {
    const db = drizzle(env.DIALED_CORE);
    const userId = newUlid();
    const itemId = newUlid();

    await db.insert(wardrobeItems).values({
      id: itemId,
      userId,
      category: "top",
      layer: "mid",
      name: "Tracksmith Harrier",
      brand: "Tracksmith",
      origin: "manual",
      createdAt: 1_757_000_000,
    });
    const items = await db.select().from(wardrobeItems);
    expect(items).toHaveLength(1);
    expect(items[0]?.category).toBe("top");

    await db.insert(runs).values({
      id: newUlid(),
      userId,
      source: "manual",
      startedAt: 1_757_000_000,
      durationS: 3600,
      distanceM: 10_000,
      title: "Morning run",
    });
    const allRuns = await db.select().from(runs);
    expect(allRuns[0]?.weatherStatus).toBe("none");
  });

  it("enforces the observation cache key uniqueness", async () => {
    const db = drizzle(env.DIALED_WEATHER);
    const row = {
      latR: 44.98,
      lngR: -93.27,
      hourBucket: 488_055,
      tempC: 5,
      feelsLikeC: 2.2,
      humidity: 88,
      windKph: 14,
      precipMm: 0.2,
      condition: "light rain",
      source: "visualcrossing",
      fetchedAt: 1_757_000_000,
    } as const;
    await db.insert(weatherObservations).values({ id: newUlid(), ...row });
    let caught: unknown;
    try {
      await db.insert(weatherObservations).values({ id: newUlid(), ...row });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String((caught as Error).cause)).toMatch(/UNIQUE/);
  });
});

describe("contracts", () => {
  it("rejects attributes outside a category's variant", () => {
    const socksWithWind = garmentSchema.safeParse({
      category: "socks",
      name: "Wool socks",
      windResistant: true,
    });
    expect(socksWithWind.success).toBe(false);
  });

  it("parses a run draft and defaults indoor to false", () => {
    const draft = runDraftSchema.parse({
      startedAt: 1_757_000_000,
      durationS: 1800,
      distanceM: 5000,
      title: "Treadmill",
    });
    expect(draft.indoor).toBe(false);
  });

  it("brands ULIDs through the schema", () => {
    expect(ulidSchema.safeParse("not-a-ulid").success).toBe(false);
    expect(ulidSchema.safeParse(newUlid()).success).toBe(true);
  });
});
