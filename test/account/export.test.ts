import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { user } from "../../src/db/schema-auth";
import {
  entryPhotos,
  entryTags,
  imports,
  outfitEntries,
  outfitEntryItems,
  runs,
  userProfiles,
  wardrobeItems,
} from "../../src/db/schema-core";
import {
  manualConditions,
  weatherObservations,
} from "../../src/db/schema-weather";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  accountExport,
  EXPORT_NOTES,
  exportDownload,
  exportResponse,
  type AccountExport,
} from "../../src/modules/account/export";
import { cacheKeyFor } from "../../src/modules/weather";
import { core, ORIGIN } from "../email/helpers";

/**
 * "Export your data" (task 126, ACC-10) on real D1: everything a runner
 * put in, derived conditions only, photos as links — and nothing of
 * anybody else's.
 */

const db = core();
const weather = drizzle(env.DIALED_WEATHER);
/**
2027-01-15T08:00:00Z.
*/
const NOW = 1_800_000_000;
const JOINED = NOW - 90 * 86_400;
const LAT = 44.98;
const LNG = -93.27;

/**
What the downloaded file holds: the export as its JSON reads back.
*/
async function asFile(value: AccountExport): Promise<unknown> {
  return exportResponse(value).json();
}

/**
Row order of a keyed read is SQLite's to choose; the set is the file's.
*/
function sortKit<TItem extends { garmentId: string }>(value: TItem[]): TItem[] {
  return value.toSorted((a, b) => a.garmentId.localeCompare(b.garmentId));
}

function iso(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

async function seedRunner(email: string): Promise<string> {
  const userId = newUlid();
  await db.insert(user).values({
    id: userId,
    name: "",
    email,
    emailVerified: true,
    createdAt: new Date(JOINED * 1000),
    updatedAt: new Date(JOINED * 1000),
  });
  return userId;
}

async function seedRun(
  userId: string,
  startedAt: number,
  overrides: Partial<typeof runs.$inferInsert> = {},
): Promise<string> {
  const id = newUlid();
  await db.insert(runs).values({
    id,
    userId,
    source: "manual",
    startedAt,
    durationS: 1800,
    distanceM: 5000,
    lat: LAT,
    lng: LNG,
    title: "Morning run",
    ...overrides,
  });
  return id;
}

function observationAt(startedAt: number, tempC: number) {
  const key = cacheKeyFor(LAT, LNG, new Date(startedAt * 1000));
  return weather.insert(weatherObservations).values({
    id: newUlid(),
    runId: newUlid(),
    latR: key.latR,
    lngR: key.lngR,
    hourBucket: key.hourBucket,
    tempC,
    feelsLikeC: tempC - 3,
    humidity: 71,
    windKph: 14,
    precipMm: 0.4,
    condition: "overcast",
    source: "visualcrossing",
    timeZone: "America/Chicago",
    fetchedAt: startedAt + 60,
  });
}

/**
 * A second runner with one of everything, at the same place and hour as
 * the first — none of it may reach the first runner's file.
 */
async function seedStranger(startedAt: number): Promise<void> {
  const strangerId = await seedRunner(`stranger-${newUlid()}@example.test`);
  const garmentId = newUlid();
  await db.insert(wardrobeItems).values({
    id: garmentId,
    userId: strangerId,
    category: "shoes",
    name: "Stranger shoe",
    photoKey: `items/${strangerId}/${garmentId}/01STRANGER`,
    createdAt: NOW - 500,
  });
  const runId = await seedRun(strangerId, startedAt, { title: "Stranger" });
  const entryId = newUlid();
  await db.insert(outfitEntries).values({
    id: entryId,
    runId,
    userId: strangerId,
    verdict: -2,
    createdAt: NOW - 400,
  });
  await db.insert(entryTags).values({ entryId, tag: "stranger" });
  await db.insert(entryPhotos).values({
    id: newUlid(),
    entryId,
    photoKey: `entries/${strangerId}/${entryId}/stranger`,
    position: 0,
  });
  await db.insert(imports).values({
    id: newUlid(),
    userId: strangerId,
    r2Key: `imports/${strangerId}/x.gpx`,
    status: "pending",
    createdAt: NOW - 50,
  });
  await weather
    .insert(manualConditions)
    .values({ runId, tempC: 30, setAt: NOW, sky: "snow" });
}

describe("accountExport", () => {
  it("holds the runner's profile, closet, runs with conditions, entries and uploads — and nobody else's", async () => {
    const email = `runner-${newUlid()}@example.test`;
    const userId = await seedRunner(email);
    await db.insert(userProfiles).values({
      userId,
      username: `r_${userId.slice(-10).toLowerCase()}`,
      cityLabel: "Minneapolis, MN",
      lat: LAT,
      lng: LNG,
      thermalLevel: -1,
      tempUnit: "f",
      distanceUnit: "mi",
      shareDefault: false,
    });

    const shirtId = newUlid();
    const tightsId = newUlid();
    await db.insert(wardrobeItems).values([
      {
        id: shirtId,
        userId,
        category: "top",
        type: "long_sleeve",
        layer: "base",
        weight: "light",
        fabric: "merino",
        windResistant: false,
        waterResistant: true,
        brand: "Tracksmith",
        name: "Harrier",
        size: "M",
        color: "Obsidian",
        colorName: "black",
        colorHex: "#111111",
        visibilityLevel: "reflective",
        photoKey: `items/${userId}/${shirtId}/01V3`,
        productUrl: "https://example.test/harrier",
        createdAt: NOW - 300,
      },
      {
        id: tightsId,
        userId,
        category: "bottom",
        name: "Old tights",
        retired: true,
        retiredAt: NOW - 10,
        createdAt: NOW - 200,
      },
    ]);

    const observedAt = NOW - 3 * 86_400;
    const bandAt = NOW - 2 * 86_400;
    const indoorAt = NOW - 86_400;
    const observedRun = await seedRun(userId, observedAt, {
      effort: "easy",
      durationS: 2400,
      distanceM: 8046.7,
    });
    const bandRun = await seedRun(userId, bandAt, {
      source: "file",
      effort: "race",
      title: "Parkrun",
    });
    const indoorRun = await seedRun(userId, indoorAt, {
      lat: undefined,
      lng: undefined,
      indoor: true,
      title: "Treadmill",
    });
    await observationAt(observedAt, 2.5);
    // The band's hour has an observation too; the band is what the run showed.
    await observationAt(bandAt, 9);
    await weather
      .insert(manualConditions)
      .values({ runId: bandRun, tempC: -4, setAt: NOW, sky: "rain" });

    const observedEntry = newUlid();
    const bandEntry = newUlid();
    await db.insert(outfitEntries).values([
      {
        id: observedEntry,
        runId: observedRun,
        userId,
        verdict: 1,
        isPublic: true,
        caption: "Cold start",
        createdAt: observedAt + 3600,
      },
      {
        id: bandEntry,
        runId: bandRun,
        userId,
        isPublic: false,
        createdAt: bandAt + 3600,
      },
    ]);
    await db.insert(outfitEntryItems).values([
      {
        entryId: observedEntry,
        itemId: shirtId,
        flag: "too_much",
        note: "hot",
      },
      { entryId: observedEntry, itemId: tightsId },
    ]);
    await db.insert(entryTags).values([
      { entryId: observedEntry, tag: "hills" },
      { entryId: observedEntry, tag: "windy" },
    ]);
    // Written out of order: the file lists them by position.
    await db.insert(entryPhotos).values([
      {
        id: newUlid(),
        entryId: observedEntry,
        photoKey: `entries/${userId}/${observedEntry}/second`,
        position: 1,
      },
      {
        id: newUlid(),
        entryId: observedEntry,
        photoKey: `entries/${userId}/${observedEntry}/first`,
        position: 0,
      },
    ]);
    await db.insert(imports).values([
      {
        id: newUlid(),
        userId,
        r2Key: `imports/${userId}/a.fit`,
        status: "done",
        runId: bandRun,
        createdAt: bandAt + 60,
      },
      {
        id: newUlid(),
        userId,
        r2Key: `imports/${userId}/b.gpx`,
        status: "failed",
        failureReason: "not a run",
        createdAt: indoorAt + 60,
      },
    ]);
    await seedStranger(observedAt);

    const file = await accountExport(db, userId, ORIGIN, NOW);

    expect(
      await asFile({
        ...file,
        entries: file.entries.map((entry) => ({
          ...entry,
          kit: sortKit(entry.kit),
        })),
      }),
    ).toStrictEqual({
      exportedAt: "2027-01-15T08:00:00.000Z",
      notes: EXPORT_NOTES,
      account: { email, joinedAt: iso(JOINED) },
      profile: {
        username: `r_${userId.slice(-10).toLowerCase()}`,
        place: "Minneapolis, MN",
        thermalLevel: -1,
        tempUnit: "f",
        distanceUnit: "mi",
        shareNewRuns: false,
      },
      closet: [
        {
          id: shirtId,
          category: "top",
          type: "long_sleeve",
          brand: "Tracksmith",
          name: "Harrier",
          size: "M",
          color: "Obsidian",
          colorName: "black",
          colorHex: "#111111",
          layer: "base",
          weight: "light",
          fabric: "merino",
          windResistant: false,
          waterResistant: true,
          visibility: "reflective",
          productUrl: "https://example.test/harrier",
          retired: false,
          addedAt: iso(NOW - 300),
          photo: `${ORIGIN}/closet/photo/${shirtId}/full?v=01V3`,
        },
        {
          id: tightsId,
          category: "bottom",
          name: "Old tights",
          retired: true,
          addedAt: iso(NOW - 200),
        },
      ],
      runs: [
        {
          id: observedRun,
          title: "Morning run",
          startedAt: iso(observedAt),
          durationSeconds: 2400,
          distanceMeters: 8046.7,
          indoor: false,
          effort: "easy",
          from: "manual",
          conditions: {
            source: "visualcrossing",
            tempC: 2.5,
            feelsLikeC: -0.5,
            humidity: 71,
            windKph: 14,
            precipMm: 0.4,
            condition: "overcast",
          },
        },
        {
          id: bandRun,
          title: "Parkrun",
          startedAt: iso(bandAt),
          durationSeconds: 1800,
          distanceMeters: 5000,
          indoor: false,
          effort: "race",
          from: "file",
          conditions: {
            source: "manual",
            tempC: -4,
            feelsLikeC: -4,
            humidity: 0,
            windKph: 0,
            precipMm: 0,
            condition: "manual",
            sky: "rain",
          },
        },
        {
          id: indoorRun,
          title: "Treadmill",
          startedAt: iso(indoorAt),
          durationSeconds: 1800,
          distanceMeters: 5000,
          indoor: true,
          from: "manual",
        },
      ],
      entries: [
        {
          id: observedEntry,
          runId: observedRun,
          verdict: 1,
          shared: true,
          caption: "Cold start",
          createdAt: iso(observedAt + 3600),
          kit: sortKit([
            { garmentId: shirtId, flag: "too_much", note: "hot" },
            { garmentId: tightsId },
          ]),
          tags: ["hills", "windy"],
          photos: [
            `${ORIGIN}/feed/photo/entries/${userId}/${observedEntry}/first`,
            `${ORIGIN}/feed/photo/entries/${userId}/${observedEntry}/second`,
          ],
        },
        {
          id: bandEntry,
          runId: bandRun,
          shared: false,
          createdAt: iso(bandAt + 3600),
          kit: [],
          tags: [],
          photos: [],
        },
      ],
      runFiles: [
        { uploadedAt: iso(bandAt + 60), status: "done", runId: bandRun },
        { uploadedAt: iso(indoorAt + 60), status: "failed" },
      ],
    });
  });

  it("says what its links and conditions are, in its own notes", () => {
    expect(EXPORT_NOTES).toStrictEqual({
      photos:
        "Photo links open while you are logged in to dialed.run as this account; they show your photos, shared or not.",
      conditions:
        "Conditions are the reading dialed.run showed for each run: from Visual Crossing, or the band you set yourself.",
      runFiles:
        "Uploaded run files (GPX, FIT, TCX) are listed by when you uploaded them; the files themselves are not in this export.",
    });
  });

  it("is an empty file, not a failure, for an account with nothing in it", async () => {
    const email = `empty-${newUlid()}@example.test`;
    const userId = await seedRunner(email);
    expect(
      await asFile(await accountExport(db, userId, ORIGIN, NOW)),
    ).toStrictEqual({
      exportedAt: "2027-01-15T08:00:00.000Z",
      notes: EXPORT_NOTES,
      account: { email, joinedAt: iso(JOINED) },
      profile: {},
      closet: [],
      runs: [],
      entries: [],
      runFiles: [],
    });
  });

  it("leaves the account's fields out, rather than failing, when its row is already gone", async () => {
    const file = await accountExport(db, newUlid(), ORIGIN, NOW);
    expect(file.account).toStrictEqual({
      email: undefined,
      joinedAt: undefined,
    });
    expect(await asFile(file)).toMatchObject({ account: {}, closet: [] });
  });

  it("gives every run its conditions past one chunk of observation reads", async () => {
    const userId = await seedRunner(`many-${newUlid()}@example.test`);
    const count = 85;
    const start = NOW - 200 * 3600;
    const startedAts = Array.from(
      { length: count },
      (_unused, index) => start + index * 3600,
    );
    const [firstRun, ...restRuns] = startedAts.map((startedAt) =>
      db.insert(runs).values({
        id: newUlid(),
        userId,
        source: "manual",
        startedAt,
        durationS: 1800,
        distanceM: 5000,
        lat: LAT,
        lng: LNG,
        title: "One of many",
      }),
    );
    const [firstObservation, ...restObservations] = startedAts.map(
      (startedAt, index) => observationAt(startedAt, index),
    );
    if (firstRun === undefined || firstObservation === undefined) {
      throw new Error("no runs to seed");
    }
    // One statement each: a multi-row insert of 85 runs is past D1's
    // bound-parameter cap on its own.
    await db.batch([firstRun, ...restRuns]);
    await weather.batch([firstObservation, ...restObservations]);

    const file = await accountExport(db, userId, ORIGIN, NOW);
    expect(file.runs).toHaveLength(count);
    expect(file.runs.map((run) => run.conditions?.tempC)).toStrictEqual(
      startedAts.map((_startedAt, index) => index),
    );
  });
});

describe("exportDownload", () => {
  it("refuses nobody signed in", async () => {
    const response = await exportDownload(undefined, db, ORIGIN, NOW);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Log in to export your data.");
  });

  it("hands a runner their file as an attachment named for the day, never cached", async () => {
    const userId = await seedRunner(`download-${newUlid()}@example.test`);
    await seedRun(userId, NOW - 86_400, { lat: undefined, lng: undefined });

    const response = await exportDownload(userId, db, ORIGIN, NOW);
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toStrictEqual({
      "content-type": "application/json; charset=utf-8",
      "content-disposition":
        'attachment; filename="dialed-run-export-2027-01-15.json"',
      "cache-control": "no-store",
    });
    const body = await response.text();
    const expected = await accountExport(db, userId, ORIGIN, NOW);
    expect(JSON.parse(body)).toStrictEqual(await asFile(expected));
    // Pretty-printed, two spaces: a runner opens this in a text editor.
    expect(body).toBe(JSON.stringify(expected, undefined, 2));
  });
});
