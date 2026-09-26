import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { pointConditions } from "../feed/conditions-fixture";
import {
  BAND_HALF_WIDTH_C,
  consensusAt,
  matchTally,
  MIN_GROUP_RUNNERS,
  MIN_RUNNERS,
  recentPublicEntriesStatement,
  shownGroups,
  WINDOW_DAYS,
  yourConditionsConsensus,
} from "../../src/modules/feed/consensus";
import {
  makeEntry,
  makeItem,
  makeManualBand,
  makeObservation,
  makeRun,
  makeUser,
  NOW,
  resetTables,
} from "./helpers";

// The consensus scan is global (not scoped by user), and this pool shares
// one D1 instance across the `it()` blocks in a file, so every test starts
// from a clean slate.
const HOUR = 3600;
const DAY = 24 * HOUR;
const THREE_DAYS_AGO = NOW - 3 * DAY;
const VIEWER = pointConditions({ tempC: 8, feelsLikeC: 7 });

type Category = "top" | "bottom" | "gloves" | "shoes";

/**
 * One runner, one public entry, logged `ago` seconds before NOW at a place
 * whose observation reads `feelsLikeC` — wearing one garment per category.
 * Each runner gets their own coordinates, so no two share a cache cell.
 */
const place = { next: 0 };
async function runner(
  options: {
    ago?: number;
    feelsLikeC?: number;
    precipMm?: number;
    categories?: Category[];
    userId?: string;
    source?: "visualcrossing" | "manual";
  } = {},
): Promise<string> {
  place.next += 1;
  const lat = (place.next % 80) + 0.5;
  const lng = Math.floor(place.next / 80) + 0.5;
  const at = NOW - (options.ago ?? HOUR);
  const userId = options.userId ?? (await makeUser());
  const itemIds = await Promise.all(
    (options.categories ?? ["top"]).map((category) =>
      makeItem({ userId, category }),
    ),
  );
  const runId = await makeRun({ userId, lat, lng, startedAt: at });
  await makeEntry({ userId, runId, createdAt: at, itemIds });
  await makeObservation({
    lat,
    lng,
    startedAt: at,
    tempC: 8,
    feelsLikeC: options.feelsLikeC ?? 7,
    precipMm: options.precipMm ?? 0,
    ...(options.source !== undefined && { source: options.source }),
  });
  return userId;
}

/**
How many runners matched, and nothing else.
*/
async function runnersIn(
  viewer: typeof VIEWER,
  since: number,
  viewerId?: string,
): Promise<number> {
  const tally = await matchTally(viewer, since, viewerId);
  return tally.runners;
}

async function runners(count: number, ago = HOUR): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await runner({ ago });
  }
}

describe("the rules round 22 set", () => {
  it("are five runners, two per row, three days then fourteen, ±3°", () => {
    expect(MIN_RUNNERS).toBe(5);
    expect(MIN_GROUP_RUNNERS).toBe(2);
    expect(WINDOW_DAYS).toStrictEqual([3, 14]);
    expect(BAND_HALF_WIDTH_C).toBe(3);
  });
});

describe("matchTally: who matched", () => {
  beforeEach(resetTables);

  it("counts a runner inside the band, the precip class and the window", async () => {
    await runner();
    const tally = await matchTally(VIEWER, THREE_DAYS_AGO);
    expect(tally).toStrictEqual({ runners: 1, groups: { tops: 1 } });
  });

  it("counts a runner exactly at the band's edge, and not one degree past it", async () => {
    // `<=`: three degrees away is inside a ±3 band.
    await runner({ feelsLikeC: 7 - 3 });
    await runner({ feelsLikeC: 7 + 3 });
    await runner({ feelsLikeC: 7 + 4 });
    expect(await runnersIn(VIEWER, THREE_DAYS_AGO)).toBe(2);
  });

  it("leaves out a run whose only conditions are its own band (B1)", async () => {
    // R2b's band is the run's conditions on its own screens, and nowhere
    // an aggregate reads — it is one runner's pick, not the weather.
    const author = await makeUser();
    const itemIds = [await makeItem({ userId: author, category: "top" })];
    const runId = await makeRun({
      userId: author,
      lat: 88,
      lng: 88,
      startedAt: NOW - HOUR,
    });
    await makeEntry({ userId: author, runId, createdAt: NOW - HOUR, itemIds });
    await makeManualBand(runId, 7);

    expect(await runnersIn(VIEWER, THREE_DAYS_AGO)).toBe(0);
  });

  it("leaves out a different precip class, a manual observation, and an unresolved one", async () => {
    await runner({ precipMm: 5 });
    await runner({ source: "manual" });
    const author = await makeUser();
    const runId = await makeRun({
      userId: author,
      lat: 89,
      lng: 89,
      startedAt: NOW,
    });
    await makeEntry({ userId: author, runId, createdAt: NOW });

    expect(await matchTally(VIEWER, THREE_DAYS_AGO)).toStrictEqual({
      runners: 0,
      groups: {},
    });
  });

  it("leaves out an entry from before the window", async () => {
    await runner({ ago: 3 * DAY + 1 });
    expect(await runnersIn(VIEWER, THREE_DAYS_AGO)).toBe(0);
  });

  it("counts runners, not entries — and a runner once per group", async () => {
    const userId = await runner({ categories: ["top", "bottom"] });
    await runner({ userId, categories: ["top", "top"] });
    await runner({ categories: ["top"] });

    expect(await matchTally(VIEWER, THREE_DAYS_AGO)).toStrictEqual({
      runners: 2,
      groups: { tops: 2, bottoms: 1 },
    });
  });

  it("counts a matching runner who wore nothing in the closet", async () => {
    await runner({ categories: [] });
    expect(await matchTally(VIEWER, THREE_DAYS_AGO)).toStrictEqual({
      runners: 1,
      groups: {},
    });
  });

  it("leaves the viewer's own entries out of what other runners wore", async () => {
    const viewerId = await runner();
    await runner();
    expect(await runnersIn(VIEWER, THREE_DAYS_AGO, viewerId)).toBe(1);
    // And only with a viewer to leave out.
    expect(await runnersIn(VIEWER, THREE_DAYS_AGO)).toBe(2);
  });

  it("aggregates more entries and garments than D1 binds in one statement", async () => {
    // D1 refuses more than 100 bound parameters in one statement. The scan
    // reads up to 200 entries, and every garment on them is a second list:
    // here 150 of each, so both reads cross the cap.
    const author = await makeUser();
    await makeObservation({
      lat: 11,
      lng: 11,
      startedAt: NOW,
      tempC: 8,
      feelsLikeC: 6,
    });
    for (let index = 0; index < 150; index += 1) {
      const item = await makeItem({ userId: author, category: "top" });
      const runId = await makeRun({
        userId: author,
        lat: 11,
        lng: 11,
        startedAt: NOW,
      });
      await makeEntry({
        userId: author,
        runId,
        createdAt: NOW - index,
        itemIds: [item],
      });
    }

    const tally = await matchTally(VIEWER, THREE_DAYS_AGO);

    expect(tally).toStrictEqual({ runners: 1, groups: { tops: 1 } });
  });

  it("finds a match behind two hundred newer entries that do not match", async () => {
    // PR #102 review: the window was read `LIMIT 200` newest-first and then
    // filtered, so it answered "the matches among the newest 200" — a busy
    // afternoon somewhere hot hid every runner in the viewer's conditions.
    await runner({ ago: 2 * DAY });
    const author = await makeUser();
    await makeObservation({
      lat: 12,
      lng: 12,
      startedAt: NOW,
      tempC: 30,
      feelsLikeC: 30,
    });
    for (let index = 0; index < 200; index += 1) {
      const runId = await makeRun({
        userId: author,
        lat: 12,
        lng: 12,
        startedAt: NOW,
      });
      await makeEntry({ userId: author, runId, createdAt: NOW - index });
    }

    expect(await runnersIn(VIEWER, THREE_DAYS_AGO)).toBe(1);
  });

  it("resolves the recent-public-entries scan with an index seek, no table scan", async () => {
    const database = drizzle(env.DIALED_CORE);
    const { sql, params } = recentPublicEntriesStatement(
      database,
      THREE_DAYS_AGO,
      "01VIEWER",
    ).toSQL();
    const plan = await env.DIALED_CORE.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...params)
      .all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail).join("\n");
    expect(details).not.toMatch(/SCAN\s+outfit_entries/i);
  });
});

describe("yourConditionsConsensus: the floor and the window", () => {
  beforeEach(resetTables);

  const band = { feelsC: 7, minC: 4, maxC: 10, precip: "dry" };

  it("shows the block at five runners in three days, and says three days", async () => {
    await runners(5);
    const result = await yourConditionsConsensus(VIEWER, NOW);
    expect(result).toStrictEqual({
      status: "matched",
      runners: 5,
      groups: [{ group: "tops", runners: 5 }],
      windowDays: 3,
      band,
    });
  });

  it("widens once to fourteen days when three have fewer than five", async () => {
    await runners(4);
    await runners(1, 10 * DAY);
    const result = await yourConditionsConsensus(VIEWER, NOW);
    expect(result).toMatchObject({
      status: "matched",
      runners: 5,
      windowDays: 14,
    });
  });

  it("has nothing to show at four runners, after looking back fourteen days", async () => {
    await runners(4);
    await runners(1, 15 * DAY);
    expect(await yourConditionsConsensus(VIEWER, NOW)).toStrictEqual({
      status: "too-few",
      windowDays: 14,
      band,
    });
  });

  it("never widens the band — only the window", async () => {
    // Five runners four degrees off: a wider band would find them all.
    for (let index = 0; index < 5; index += 1) {
      await runner({ feelsLikeC: 7 + 4, ago: 5 * DAY });
    }
    expect(await yourConditionsConsensus(VIEWER, NOW)).toMatchObject({
      status: "too-few",
    });
  });

  it("names its band from the viewer's feels-like and precip", async () => {
    const wet = pointConditions({ tempC: 1, feelsLikeC: -2, precipMm: 4 });
    expect(await yourConditionsConsensus(wet, NOW)).toStrictEqual({
      status: "too-few",
      windowDays: 14,
      band: { feelsC: -2, minC: -5, maxC: 1, precip: "wet" },
    });
  });

  it("does not count the viewer as one of the five", async () => {
    const viewerId = await runner();
    await runners(4);
    expect(await yourConditionsConsensus(VIEWER, NOW, viewerId)).toMatchObject({
      status: "too-few",
    });
  });
});

describe("shownGroups", () => {
  it("drops a group worn by fewer than two, and puts the most-worn first", () => {
    expect(
      shownGroups({ tops: 2, bottoms: 5, shoes: 1, outer: 2 }),
    ).toStrictEqual([
      { group: "bottoms", runners: 5 },
      // Equals keep the closet's own group order.
      { group: "tops", runners: 2 },
      { group: "outer", runners: 2 },
    ]);
  });

  it("shows nothing when nothing reaches two", () => {
    expect(shownGroups({ tops: 1 })).toStrictEqual([]);
  });
});

describe("consensusAt", () => {
  beforeEach(resetTables);

  it("shows no block at all when the viewer's conditions are unknown", async () => {
    // Law 5: an empty consensus claims nobody nearby ran in these
    // conditions. "We do not know what they are" is a different statement.
    expect(await consensusAt(80, 80, NOW)).toBeUndefined();
  });

  it("answers once the viewer's conditions resolve, leaving the viewer out", async () => {
    await makeObservation({
      lat: 81,
      lng: 81,
      startedAt: NOW,
      tempC: 8,
      feelsLikeC: 7,
    });
    const viewerId = await runner();
    await runners(4);

    expect(await consensusAt(81, 81, NOW, viewerId)).toMatchObject({
      status: "too-few",
    });
    expect(await consensusAt(81, 81, NOW)).toMatchObject({
      status: "matched",
      runners: 5,
    });
  });
});
