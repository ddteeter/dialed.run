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
import { exportData } from "../../src/modules/account/export";
import { readmeSection } from "../../src/modules/account/export-format";
import {
  csvCell,
  exportFiles,
  type ExportText,
  type StoredObjects,
} from "../../src/modules/account/export-files";
import { buildSheets } from "../../src/modules/account/export-sheets";
import { cacheKeyFor } from "../../src/modules/weather";
import { core } from "../email/helpers";

/**
 * What the export ZIP holds (task 126, ACC-10; round 27 #13), read on
 * real D1: everything a runner put in, derived conditions only, the files
 * R2 still has — and nothing of anybody else's.
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
const BOM = String.fromCodePoint(0xfe_ff);
const NOTHING_STORED: StoredObjects = { media: new Map(), imports: new Map() };

function byText(a: string, b: string): number {
  return a.localeCompare(b);
}

function iso(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

/**
One text of the ZIP, by name.
*/
function textNamed(texts: readonly ExportText[], name: string): string {
  const text = texts.find((candidate) => candidate.name === name);
  if (text === undefined) throw new Error(`${name} is not in the ZIP`);
  return text.text;
}

/**
 * A CSV's lines, after checking the frame every one shares: the byte-order
 * mark first, CRLF line ends, one after the last row too.
 */
function linesOf(texts: readonly ExportText[], name: string): string[] {
  const text = textNamed(texts, name);
  expect(text.startsWith(BOM)).toBe(true);
  expect(text.endsWith("\r\n")).toBe(true);
  return text.slice(BOM.length, -2).split("\r\n");
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
 * the first — none of it may reach the first runner's ZIP.
 */
async function seedStranger(startedAt: number): Promise<string> {
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
  return strangerId;
}

describe("csvCell", () => {
  it("writes nothing for a missing value, and numbers and booleans as they read", () => {
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(-2)).toBe("-2");
    expect(csvCell(8046.7)).toBe("8046.7");
    expect(csvCell(false)).toBe("false");
    expect(csvCell("plain")).toBe("plain");
  });

  it("quotes a cell holding a comma, a quote, a line break or an edge space", () => {
    expect(csvCell("Minneapolis, MN")).toBe('"Minneapolis, MN"');
    expect(csvCell('the "good" tights')).toBe('"the ""good"" tights"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell("cr\ronly")).toBe('"cr\ronly"');
    expect(csvCell(" lead")).toBe('" lead"');
    expect(csvCell("trail ")).toBe('"trail "');
    expect(csvCell("in side")).toBe("in side");
  });

  it("stops a spreadsheet reading text as a formula", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-2 layers")).toBe("'-2 layers");
    expect(csvCell("@once")).toBe("'@once");
    expect(csvCell("\tx")).toBe("'\tx");
    expect(csvCell("\rx")).toBe(`"'\rx"`);
    expect(csvCell("a=b")).toBe("a=b");
  });
});

describe("exportData and exportFiles", () => {
  it("hold the runner's profile, closet, runs with conditions, entries, kit and files — and nobody else's", async () => {
    const email = `runner-${newUlid()}@example.test`;
    const userId = await seedRunner(email);
    const username = `r_${userId.slice(-10).toLowerCase()}`;
    await db.insert(userProfiles).values({
      userId,
      username,
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
        note: "hot, then fine",
      },
      { entryId: observedEntry, itemId: tightsId },
    ]);
    await db.insert(entryTags).values([
      { entryId: observedEntry, tag: "hills" },
      { entryId: observedEntry, tag: "windy" },
    ]);
    const firstPhoto = `entries/${userId}/${observedEntry}/first`;
    const secondPhoto = `entries/${userId}/${observedEntry}/second`;
    // Written out of order: the ZIP numbers them by position.
    await db.insert(entryPhotos).values([
      {
        id: newUlid(),
        entryId: observedEntry,
        photoKey: secondPhoto,
        position: 1,
      },
      {
        id: newUlid(),
        entryId: observedEntry,
        photoKey: firstPhoto,
        position: 0,
      },
    ]);
    const doneUpload = newUlid();
    const failedUpload = newUlid();
    const duplicateUpload = newUlid();
    await db.insert(imports).values([
      {
        id: doneUpload,
        userId,
        r2Key: `imports/${userId}/${doneUpload}.fit`,
        status: "done",
        runId: bandRun,
        createdAt: bandAt + 60,
      },
      {
        id: failedUpload,
        userId,
        r2Key: `imports/${userId}/${failedUpload}.gpx`,
        status: "failed",
        failureReason: "not a run",
        createdAt: indoorAt + 60,
      },
      {
        // The same run uploaded twice: its file is in the ZIP, but it is
        // not the file the run came from.
        id: duplicateUpload,
        userId,
        r2Key: `imports/${userId}/${duplicateUpload}.tcx`,
        status: "duplicate",
        runId: observedRun,
        createdAt: indoorAt + 120,
      },
    ]);
    const strangerId = await seedStranger(observedAt);

    const stored: StoredObjects = {
      // No original for this garment: a photo from before originals were
      // kept, so the full size stands in.
      media: new Map([
        [`items/${userId}/${shirtId}/01V3/full.webp`, 11],
        [`items/${userId}/${shirtId}/01V3/card.webp`, 5],
        [firstPhoto, 12],
        [secondPhoto, 13],
      ]),
      imports: new Map([
        [`imports/${userId}/${doneUpload}.fit`, 21],
        [`imports/${userId}/${failedUpload}.gpx`, 22],
        [`imports/${userId}/${duplicateUpload}.tcx`, 23],
      ]),
    };
    const { texts, objects } = exportFiles(
      await exportData(db, userId),
      stored,
      NOW,
    );

    expect(texts.map((text) => text.name)).toStrictEqual([
      "README.txt",
      "profile.csv",
      "runs.csv",
      "entries.csv",
      "kit.csv",
      "garments.csv",
    ]);
    expect(linesOf(texts, "profile.csv")).toStrictEqual([
      "email,joined_at,username,place,thermal_level,temp_unit,distance_unit,share_new_runs",
      `${email},${iso(JOINED)},${username},"Minneapolis, MN",-1,f,mi,false`,
    ]);
    expect(linesOf(texts, "runs.csv")).toStrictEqual([
      "id,title,started_at,duration_seconds,distance_meters,indoor,effort,added_from,conditions_from,temp_c,feels_like_c,humidity,wind_kph,precip_mm,condition,sky,run_file",
      `${observedRun},Morning run,${iso(observedAt)},2400,8046.7,false,easy,manual,visualcrossing,2.5,-0.5,71,14,0.4,overcast,,`,
      `${bandRun},Parkrun,${iso(bandAt)},1800,5000,false,race,file,manual,-4,-4,0,0,0,manual,rain,run-files/${doneUpload}.fit`,
      `${indoorRun},Treadmill,${iso(indoorAt)},1800,5000,true,,manual,,,,,,,,,`,
    ]);
    expect(linesOf(texts, "entries.csv")).toStrictEqual([
      "id,run_id,verdict,shared,caption,tags,photos,created_at",
      `${observedEntry},${observedRun},1,true,Cold start,hills; windy,photos/entries/${observedEntry}-1.jpg; photos/entries/${observedEntry}-2.jpg,${iso(observedAt + 3600)}`,
      `${bandEntry},${bandRun},,false,,,,${iso(bandAt + 3600)}`,
    ]);
    const [kitHeader, ...kitRows] = linesOf(texts, "kit.csv");
    expect(kitHeader).toBe("entry_id,garment_id,flag,note");
    // Row order within an entry is SQLite's; the set is the ZIP's.
    expect(kitRows.toSorted(byText)).toStrictEqual(
      [
        `${observedEntry},${shirtId},too_much,"hot, then fine"`,
        `${observedEntry},${tightsId},,`,
      ].toSorted(byText),
    );
    expect(linesOf(texts, "garments.csv")).toStrictEqual([
      "id,category,type,brand,name,size,color,color_name,color_hex,layer,weight,fabric,wind_resistant,water_resistant,visibility,product_url,retired,added_at,photo",
      `${shirtId},top,long_sleeve,Tracksmith,Harrier,M,Obsidian,black,#111111,base,light,merino,false,true,reflective,https://example.test/harrier,false,${iso(NOW - 300)},photos/closet/${shirtId}.webp`,
      `${tightsId},bottom,,,Old tights,,,,,,,,,,,,true,${iso(NOW - 200)},`,
    ]);
    expect(objects).toStrictEqual([
      {
        bucket: "media",
        key: firstPhoto,
        name: `photos/entries/${observedEntry}-1.jpg`,
        size: 12,
      },
      {
        bucket: "media",
        key: secondPhoto,
        name: `photos/entries/${observedEntry}-2.jpg`,
        size: 13,
      },
      {
        bucket: "media",
        key: `items/${userId}/${shirtId}/01V3/full.webp`,
        name: `photos/closet/${shirtId}.webp`,
        size: 11,
      },
      {
        bucket: "imports",
        key: `imports/${userId}/${doneUpload}.fit`,
        name: `run-files/${doneUpload}.fit`,
        size: 21,
      },
      {
        bucket: "imports",
        key: `imports/${userId}/${failedUpload}.gpx`,
        name: `run-files/${failedUpload}.gpx`,
        size: 22,
      },
      {
        bucket: "imports",
        key: `imports/${userId}/${duplicateUpload}.tcx`,
        name: `run-files/${duplicateUpload}.tcx`,
        size: 23,
      },
    ]);
    for (const text of texts) expect(text.text).not.toContain(strangerId);
  });

  it("prefers a garment's original, and leaves out what R2 no longer has", async () => {
    const userId = await seedRunner(`files-${newUlid()}@example.test`);
    const garmentId = newUlid();
    const photoKey = `items/${userId}/${garmentId}/01V9`;
    await db.insert(wardrobeItems).values({
      id: garmentId,
      userId,
      category: "top",
      name: "Shirt",
      photoKey,
      createdAt: NOW - 100,
    });
    const runId = await seedRun(userId, NOW - 3600);
    const entryId = newUlid();
    await db.insert(outfitEntries).values({
      id: entryId,
      runId,
      userId,
      createdAt: NOW - 60,
    });
    await db.insert(entryPhotos).values({
      id: newUlid(),
      entryId,
      photoKey: `entries/${userId}/${entryId}/gone`,
      position: 0,
    });
    const uploadId = newUlid();
    await db.insert(imports).values({
      id: uploadId,
      userId,
      r2Key: `imports/${userId}/${uploadId}.gpx`,
      status: "done",
      runId,
      createdAt: NOW - 30,
    });

    const { texts, objects } = exportFiles(
      await exportData(db, userId),
      {
        media: new Map([
          [`${photoKey}/original.jpg`, 7],
          [`${photoKey}/full.webp`, 8],
        ]),
        imports: new Map(),
      },
      NOW,
    );

    expect(objects).toStrictEqual([
      {
        bucket: "media",
        key: `${photoKey}/original.jpg`,
        name: `photos/closet/${garmentId}.jpg`,
        size: 7,
      },
    ]);
    expect(linesOf(texts, "entries.csv")[1]).toBe(
      `${entryId},${runId},,true,,,,${iso(NOW - 60)}`,
    );
    expect(linesOf(texts, "runs.csv")[1]?.endsWith(",")).toBe(true);
    expect(
      linesOf(texts, "garments.csv")[1]?.endsWith(
        `,photos/closet/${garmentId}.jpg`,
      ),
    ).toBe(true);
  });

  it("leaves out a garment's photo when it has none, even if R2 happens to hold a key that would spell 'null'", async () => {
    // photoKey null must gate the whole search, not just happen to find
    // nothing: a garment with no key must never resolve a photo even when
    // R2 holds an object at the key the candidate search would build by
    // blindly interpolating a null photoKey into a template literal.
    const userId = await seedRunner(`nullkey-${newUlid()}@example.test`);
    const garmentId = newUlid();
    await db.insert(wardrobeItems).values({
      id: garmentId,
      userId,
      category: "top",
      name: "No photo",
      createdAt: NOW - 100,
    });

    const { objects } = exportFiles(
      await exportData(db, userId),
      {
        media: new Map([
          [`null/original.jpg`, 999],
          [`null/full.webp`, 999],
        ]),
        imports: new Map(),
      },
      NOW,
    );

    expect(objects).toStrictEqual([]);
  });

  it("never lets an upload that did not become a run's own file claim that run's run_file column", async () => {
    // A duplicate (or any non-'done') upload can still point its runId at
    // a real run — that is what makes it a duplicate — but it must never
    // be read as the run's own imported file.
    const userId = await seedRunner(`notfile-${newUlid()}@example.test`);
    const runId = await seedRun(userId, NOW - 3600);
    const uploadId = newUlid();
    await db.insert(imports).values({
      id: uploadId,
      userId,
      r2Key: `imports/${userId}/${uploadId}.tcx`,
      status: "duplicate",
      runId,
      createdAt: NOW - 60,
    });

    const { texts } = exportFiles(
      await exportData(db, userId),
      {
        media: new Map(),
        imports: new Map([[`imports/${userId}/${uploadId}.tcx`, 5]]),
      },
      NOW,
    );

    const [, row] = linesOf(texts, "runs.csv");
    expect(row?.endsWith(",")).toBe(true);
  });

  it("keeps a kit-less entry's tags and photos as real empty arrays, not the fallback's raw junk", async () => {
    // (tagsOf.get(id) ?? []).map(...) and photosOf.get(id) ?? [] both use
    // an array fallback that a broken guard could replace with a
    // single-element placeholder — which a naive check of the *rendered*
    // CSV text cannot tell apart from a real empty list, since joining a
    // one-element array of a bad shape collapses to the same "" cell. The
    // raw array read directly off exportData does not have that blind spot.
    const userId = await seedRunner(`bare-${newUlid()}@example.test`);
    const runId = await seedRun(userId, NOW - 3600);
    const entryId = newUlid();
    await db.insert(outfitEntries).values({
      id: entryId,
      runId,
      userId,
      createdAt: NOW - 60,
    });

    const data = await exportData(db, userId);
    const entry = data.entries.find((candidate) => candidate.id === entryId);
    expect(entry?.tags).toStrictEqual([]);
    expect(entry?.photos).toStrictEqual([]);
  });

  it("names every column of every CSV in the README, with what it holds", async () => {
    const userId = await seedRunner(`readme-${newUlid()}@example.test`);
    const data = await exportData(db, userId);
    const { texts } = exportFiles(data, NOTHING_STORED, NOW);
    const readme = textNamed(texts, "README.txt");
    expect(readme.startsWith(`dialed.run export\nMade ${iso(NOW)}.\n`)).toBe(
      true,
    );
    expect(readme).toContain(
      "Times are UTC. Conditions are the reading dialed.run showed for each run: from Visual Crossing, or the band you set yourself.",
    );
    for (const text of texts.slice(1)) {
      const [header = ""] = linesOf(texts, text.name);
      expect(readme).toContain(`\n${text.name}: `);
      for (const column of header.split(",")) {
        expect(readme).toMatch(new RegExp(String.raw`\n  ${column}: \S`, "u"));
      }
    }
    expect(readme).toContain(
      "  verdict: -2 (too cold) to +2 (too warm); 0 is dialed.",
    );
    // The loop above only proves every column NAME appears somewhere with
    // SOME non-space text after it — it cannot see a blank separator line
    // turning into junk, or the fixed paragraph between the title and the
    // first sheet going missing, because neither is a "\n  name: " line.
    // Rebuilding the exact expected text from the same sheets (built
    // independently here, not reused from exportFiles' own call) pins
    // both.
    const { profileSheet, runsSheet, entriesSheet, kitSheet, garmentsSheet } =
      buildSheets({
        profile: { account: undefined, profile: undefined },
        runs: [],
        entries: [],
        kit: [],
        garments: [],
      });
    expect(readme).toBe(
      [
        "dialed.run export",
        `Made ${iso(NOW)}.`,
        "",
        "Times are UTC. Conditions are the reading dialed.run showed for each run: from Visual Crossing, or the band you set yourself.",
        "photos/ holds your kit photos (photos/entries/) and garment photos (photos/closet/), at the size dialed.run keeps. run-files/ holds the GPX, FIT and TCX files you uploaded, as uploaded.",
        "",
        readmeSection(profileSheet),
        "",
        readmeSection(runsSheet),
        "",
        readmeSection(entriesSheet),
        "",
        readmeSection(kitSheet),
        "",
        readmeSection(garmentsSheet),
        "",
      ].join("\n"),
    );
  });

  it("is headers and an empty profile, not a failure, for an account with nothing in it — or gone", async () => {
    const email = `empty-${newUlid()}@example.test`;
    const userId = await seedRunner(email);
    const empty = exportFiles(
      await exportData(db, userId),
      NOTHING_STORED,
      NOW,
    );
    expect(empty.objects).toStrictEqual([]);
    expect(linesOf(empty.texts, "profile.csv")[1]).toBe(
      `${email},${iso(JOINED)},,,,,,`,
    );
    for (const name of ["runs.csv", "entries.csv", "kit.csv", "garments.csv"]) {
      expect(linesOf(empty.texts, name)).toHaveLength(1);
    }
    const gone = exportFiles(
      await exportData(db, newUlid()),
      NOTHING_STORED,
      NOW,
    );
    expect(linesOf(gone.texts, "profile.csv")[1]).toBe(",,,,,,,");
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

    const data = await exportData(db, userId);
    expect(data.runs).toHaveLength(count);
    expect(data.runs.map((run) => run.conditions?.tempC)).toStrictEqual(
      startedAts.map((_startedAt, index) => index),
    );
  });
});
