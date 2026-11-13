import { beforeEach, describe, expect, it } from "vitest";

import {
  DAY,
  HOUR,
  MAYA_ID,
  PHOTO_SIZES,
  buildDenseSeed,
  fToC,
  flagFor,
  garmentOf,
  kitFor,
  lookup,
  mayaAudience,
  modeOf,
  nth,
  pick,
  prng,
  runnerPhotos,
  skyOf,
  tagsFor,
  weatherFor,
  type CoreRows,
  type DenseSeed,
  type KitTable,
} from "../../e2e/audit/dense-seed";
import garmentsJson from "../../e2e/audit/data/garments.json";
import kitTable from "./fixtures/kit-table.json";
import { garmentSchema } from "../../src/lib/contracts";
import { photoSizes } from "../../src/modules/closet";

/**
 * The dense seed's builder (design 205, "Seeded data"). It is pure, so
 * every claim the audit's captures lean on — the same data each run, the
 * documented counts, nothing a real person could be — is checked here
 * rather than by looking at a screenshot.
 */
const NOW = 1_794_000_000;

const ULID = /(?<![0-9a-z])[0-9a-hjkmnp-tv-z]{26}(?![0-9a-z])/giu;
/**
A ULID with its time stripped: the part the PRNG drew.
*/
const drawn = (value: string) =>
  value.replaceAll(ULID, (id) => `<${id.slice(10).toUpperCase()}>`);

const fixed = () => 0.5;
const isAtMaya = (row: { latR: number }) => String(row.latR) === "41.88";
const sharedByOthers = (built: DenseSeed) =>
  built.core.entryPhotos.filter(
    (row) =>
      row.screenStatus === "pass" &&
      built.core.outfitEntries
        .find((entry) => entry.id === row.entryId)
        ?.userId.startsWith("audit-r") === true,
  );

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object" || value instanceof Date) {
    return [];
  }
  return Object.values(value).flatMap((item) => strings(item));
}

describe("prng", () => {
  it("draws mulberry32's sequence for a seed", () => {
    const rnd = prng(1);
    expect([rnd(), rnd(), rnd()]).toStrictEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522,
    ]);
  });

  it("draws a different sequence for a different seed", () => {
    const rnd = prng(20_261_112);
    expect([rnd(), rnd()]).toStrictEqual([
      0.9313658876344562, 0.3483475421089679,
    ]);
  });
});

describe("the small rules", () => {
  it("nth returns the item, and says what is missing either side", () => {
    expect(nth(["a", "b"], 1)).toBe("b");
    expect(() => nth(["a"], 1)).toThrow("no item at 1");
    expect(() => nth(["a"], -1)).toThrow("no item at -1");
  });

  it("pick wraps round, and fails on an empty list", () => {
    expect(pick(["a", "b", "c"], 4)).toBe("b");
    expect(() => pick([], 0)).toThrow("no item at NaN");
  });

  it("converts Fahrenheit to Celsius", () => {
    expect(fToC(212)).toBe(100);
    expect(fToC(-40)).toBe(-40);
  });

  it("looks a key up, and names a missing one", () => {
    expect(lookup(new Map([["cap", "c1"]]), "cap")).toBe("c1");
    expect(() => lookup(new Map<string, string>(), "cap")).toThrow(
      'nothing under "cap"',
    );
  });

  it("tags a judged even run by the verdict's direction, more as it spins", () => {
    expect(tagsFor(undefined, 0)).toStrictEqual([]);
    expect(tagsFor(-1, 1)).toStrictEqual([]);
    expect(tagsFor(-1, 0)).toStrictEqual(["cold_first_mile"]);
    expect(tagsFor(-2, 2)).toStrictEqual([
      "cold_first_mile",
      "hands_cold",
      "wind_cut_through",
    ]);
    expect(tagsFor(1, 4)).toStrictEqual(["overheated_late", "sleeves_damp"]);
    expect(tagsFor(0, 2)).toStrictEqual(["perfect_warmup"]);
  });

  it("flags only the first garment, the way the verdict went", () => {
    expect(flagFor(2, 0)).toBe("too_much");
    expect(flagFor(-1, 0)).toBe("not_enough");
    expect(flagFor(-1, 1)).toBeUndefined();
    expect(flagFor(0, 0)).toBeUndefined();
    expect(flagFor(1, 0)).toBe("too_much");
    expect(flagFor(undefined, 0)).toBeUndefined();
  });

  it("reads a manual run's sky from its rain", () => {
    expect(skyOf(4.2)).toBe("rain");
    expect(skyOf(2)).toBe("damp");
    expect(skyOf(0.1)).toBe("damp");
    expect(skyOf(0)).toBe("dry");
  });

  it("reads a run's mode from the exceptions table", () => {
    const table = { indoor: [3], manual: [4], failed: [5], pending: [6] };
    expect([2, 3, 4, 5, 6].map((index) => modeOf(table, index))).toStrictEqual([
      "normal",
      "indoor",
      "manual",
      "failed",
      "pending",
    ]);
    expect(modeOf({}, 3)).toBe("normal");
  });

  it("keeps every sixth of Maya's entries private and every fourth public", () => {
    expect(
      [5, 1, 9, 13, 0, 2].map((index) => mayaAudience(index)),
    ).toStrictEqual([
      "private",
      "world",
      "world",
      "world",
      "runners",
      "runners",
    ]);
    expect(mayaAudience(17)).toBe("private");
  });

  it("gives another runner's entry no photo on every fourth spin, two on every third", () => {
    expect(
      [3, 0, 1, 2, 6, 7, 15].map((spin) => runnerPhotos(spin)),
    ).toStrictEqual([0, 2, 1, 1, 2, 0, 0]);
  });
});

describe("weatherFor", () => {
  it("feels like the season, colder close to now", () => {
    expect(weatherFor(fixed, 0, 0).feelsC).toBe(2);
    expect(weatherFor(fixed, 13.9, 0).feelsC).toBe(2);
    expect(weatherFor(fixed, 14, 0).feelsC).toBe(8);
    expect(weatherFor(fixed, 104, 0).feelsC).toBe(22);
    expect(weatherFor(fixed, 105, 0).feelsC).toBe(28);
  });

  it("jitters by up to five degrees either way", () => {
    expect(weatherFor(() => 0, 0, 0).feelsC).toBe(-3);
    expect(weatherFor(() => 0.99, 0, 0).feelsC).toBe(7);
  });

  it("rains on every fifth run, drizzles on every seventh, else picks a sky", () => {
    expect(weatherFor(fixed, 0, 3)).toStrictEqual({
      feelsC: 2,
      precipMm: 4.2,
      condition: "rain",
    });
    expect(weatherFor(fixed, 0, 2)).toStrictEqual({
      feelsC: 2,
      precipMm: 1,
      condition: "light rain",
    });
    expect(weatherFor(fixed, 0, 1)).toStrictEqual({
      feelsC: 2,
      precipMm: 0,
      condition: "overcast",
    });
  });
});

describe("kitFor", () => {
  const table: KitTable = kitTable;
  const closet = new Map(
    ["thermal", "vest", "shell", "singlet", "tee", "trail", "road"].map(
      (key) => [key, `id-${key}`],
    ),
  );

  it("takes the first band the temperature is below, then the shoes", () => {
    expect(kitFor(table, closet, -5, 1, false)).toStrictEqual([
      "id-thermal",
      "id-vest",
      "id-road",
    ]);
    expect(kitFor(table, closet, -5, 0, false)).toStrictEqual([
      "id-thermal",
      "id-road",
    ]);
  });

  it("reads a wet slot only when it rains", () => {
    expect(kitFor(table, closet, 5, 0, true)).toStrictEqual([
      "id-shell",
      "id-trail",
    ]);
    expect(kitFor(table, closet, 5, 0, false)).toStrictEqual(["id-road"]);
  });

  it("falls through to the warm kit at the top band's edge", () => {
    expect(kitFor(table, closet, 10, 1, false)).toStrictEqual([
      "id-tee",
      "id-road",
    ]);
  });
});

describe("buildDenseSeed", () => {
  // Built afresh for every test rather than once for the file: a build at
  // module scope would make every mutant in the builder a static one, which
  // Stryker can only judge by re-running the whole suite.
  let seed: DenseSeed;
  let core: CoreRows;
  let mayaRuns: CoreRows["runs"];
  let mayaEntries: CoreRows["outfitEntries"];
  beforeEach(() => {
    seed = buildDenseSeed(NOW);
    core = seed.core;
    mayaRuns = core.runs.filter((run) => run.userId === MAYA_ID);
    mayaEntries = core.outfitEntries.filter(
      (entry) => entry.userId === MAYA_ID,
    );
  });
  const entryOf = (id: string) =>
    core.outfitEntries.find((row) => row.id === id);
  const kitOf = (entryId: string) =>
    core.outfitEntryItems.filter((row) => row.entryId === entryId);
  const photosOf = (entryId: string) =>
    core.entryPhotos.filter((row) => row.entryId === entryId);

  const photographed = (userId: string) =>
    core.wardrobeItems.filter(
      (row) => row.userId === userId && row.photoKey !== undefined,
    ).length;
  const conditionsOf = (runId: string) =>
    core.runConditions.find((row) => row.runId === runId);

  it("builds the same rows for the same now", () => {
    expect(buildDenseSeed(NOW)).toStrictEqual(seed);
  });

  // The audit compares captures run to run, so the seed is pinned to the
  // byte: any change to the data or to how it combines changes this
  // digest, and updating it is the deliberate step that says so.
  it("builds exactly the pinned rows", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(seed));
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const hex = [...digest]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    expect(hex).toBe(
      "9b9c87e06da09e5dba5a64313d871a84b34ac717e997030bf2fef71a1ee0410f",
    );
  });

  it("moves only timestamps for a now days later", () => {
    const later = buildDenseSeed(NOW + 3 * DAY);
    const compare = (before: unknown, after: unknown, path: string): void => {
      if (before instanceof Date && after instanceof Date) {
        expect(after.getTime() - before.getTime(), path).toBe(3 * DAY * 1000);
      } else if (typeof before === "number" && typeof after === "number") {
        expect([0, 3 * DAY, (3 * DAY) / HOUR], path).toContain(after - before);
      } else if (typeof before === "string" && typeof after === "string") {
        expect(drawn(after), path).toBe(drawn(before));
      } else if (typeof before === "object" && before !== null) {
        expect(Object.keys(after ?? {}), path).toStrictEqual(
          Object.keys(before),
        );
        for (const [key, value] of Object.entries(before)) {
          compare(value, Reflect.get(after ?? {}, key), `${path}.${key}`);
        }
      } else {
        expect(after, path).toBe(before);
      }
    };
    compare(seed, later, "seed");
    expect(later.core.runs[0]?.startedAt).toBe(
      (seed.core.runs[0]?.startedAt ?? 0) + 3 * DAY,
    );
    expect(later.summary.halfZipId).not.toBe(seed.summary.halfZipId);
  });

  it("puts every garment through garmentSchema", () => {
    for (const row of core.wardrobeItems) {
      const option = garmentSchema.options.find(
        (candidate) => candidate.shape.category.value === row.category,
      );
      const fields = Object.fromEntries(
        Object.keys(option?.shape ?? {}).flatMap((key) => {
          const value: unknown = Reflect.get(row, key);
          return value === undefined || value === null ? [] : [[key, value]];
        }),
      );
      expect(garmentSchema.safeParse(fields).success, row.name).toBe(true);
    }
  });

  it("writes a garment's temperatures in Celsius, through the schema", () => {
    const halfZip = garmentOf({
      key: "x",
      garment: { category: "top", name: "Half-zip", layer: "mid" },
      tempF: { low: 32, high: 50 },
    });
    expect(halfZip).toStrictEqual({
      category: "top",
      name: "Half-zip",
      layer: "mid",
      estTempLowC: 0,
      estTempHighC: 10,
    });
    expect(() =>
      garmentOf({ key: "x", garment: { category: "top", name: "" } }),
    ).toThrow();
  });

  it("has the counts the file header documents", () => {
    const closetOf = (userId: string) =>
      core.wardrobeItems.filter((row) => row.userId === userId).length;
    expect(closetOf(MAYA_ID)).toBe(40);
    expect(closetOf("audit-r01")).toBe(16);
    expect(closetOf("audit-r06")).toBe(16);
    expect(mayaRuns).toHaveLength(63);
    expect(mayaEntries).toHaveLength(48);
    const runners = core.userProfiles.filter((row) =>
      row.userId.startsWith("audit-r"),
    );
    expect(runners).toHaveLength(20);
    expect(
      core.outfitEntries.filter((row) => row.userId.startsWith("audit-r")),
    ).toHaveLength(65);
    expect(core.wardrobeItems).toHaveLength(40 + 20 * 16 + 77);
    expect(core.notifications).toHaveLength(30);
    expect(core.reviewQueue).toHaveLength(16);
    expect(seed.queueIds).toStrictEqual(core.reviewQueue.map((row) => row.id));
    expect(core.reports).toHaveLength(10);
    expect(core.productCorrections).toHaveLength(12);
    expect(core.inviteCodes).toHaveLength(8);
    expect(core.accessRequests).toHaveLength(12);
    expect(core.gaveUp).toHaveLength(4);
    expect(core.user).toHaveLength(27);
  });

  it("shares entries with runners and the world, and keeps some private", () => {
    const audiences = new Set(core.outfitEntries.map((row) => row.audience));
    expect(
      [...audiences].toSorted((a, b) => String(a).localeCompare(String(b))),
    ).toStrictEqual(["private", "runners", "world"]);
    for (const row of core.runConditions) {
      const entry = core.outfitEntries.find((item) => item.runId === row.runId);
      const isShared =
        entry !== undefined &&
        ["runners", "world"].includes(entry.audience ?? "");
      expect(row.entryShared, row.runId).toBe(isShared);
      expect(row.verdict, row.runId).toBe(entry?.verdict);
      expect(row.entryCreatedAt, row.runId).toBe(entry?.createdAt);
    }
  });

  it("uses no email address outside example.com", () => {
    const emails = strings(seed)
      .flatMap((value) => value.split(" "))
      .filter((word) => word.indexOf("@") > 0);
    expect(emails.length).toBeGreaterThan(50);
    for (const email of emails) expect(email).toMatch(/(^|\.|@)example\.com$/u);
  });

  it("writes only rows cleanAudit can find again", () => {
    for (const row of core.user) expect(row.id).toMatch(/^audit-/u);
    for (const row of core.wardrobeItems)
      expect(row.userId).toMatch(/^audit-/u);
    for (const row of core.products) expect(row.createdBy).toMatch(/^audit-/u);
    for (const row of core.brands) expect(row.normalized).toMatch(/ audit$/u);
    for (const table of [
      core.reports,
      core.gaveUp,
      core.moderationActions,
      core.inviteCodes,
      core.accessRequests,
      core.productCorrections,
      seed.weather.observations,
    ]) {
      for (const row of table) expect(row.id).toMatch(/^audit-/u);
    }
  });

  it("names brands and products by their lowercased names", () => {
    const halfZip = core.products.find((row) => row.name === "Rover Half-zip");
    expect(halfZip).toMatchObject({
      normalizedName: "rover half-zip",
      fabric: "merino",
      weight: "mid",
      categoryHint: "top",
      type: "halfZip",
      fabricComposition: "52% merino wool, 28% nylon, 20% Tencel lyocell",
      extractionStatus: "done",
      createdBy: MAYA_ID,
      createdAt: NOW - 150 * DAY,
    });
    expect(halfZip?.sourceUrl).toBe(
      `https://example.com/products/${String(halfZip?.id).toLowerCase()}`,
    );
    const shell = core.products.find(
      (row) => row.name === "Norvan Shell Jacket",
    );
    expect(shell).toMatchObject({
      windResistant: true,
      waterResistant: true,
      fabricComposition: "88% recycled polyester, 12% elastane",
    });
    const janji = core.brands.find((row) => row.name === "Janji");
    expect(janji?.normalized).toBe("janji audit");
    // One canonical row per brand and name, however many closets hold it.
    const harrier = core.products.filter((row) => row.name === "Harrier Tee");
    expect(harrier).toHaveLength(1);
    expect(
      core.wardrobeItems.filter((row) => row.productId === harrier[0]?.id),
    ).toHaveLength(20);
  });

  it("files garment photos as an original and three sizes under one version", () => {
    const halfZip = core.wardrobeItems.find(
      (row) => row.id === seed.summary.halfZipId,
    );
    expect(halfZip?.visibility).toBe("pass");
    const version = halfZip?.photoKey ?? "";
    expect(version).toMatch(
      new RegExp(
        `^items/${MAYA_ID}/${seed.summary.halfZipId}/[0-9A-Z]{26}$`,
        "u",
      ),
    );
    const objects = seed.objects.filter((row) =>
      row.key.startsWith(`${version}/`),
    );
    expect(
      objects.map((row) => [
        row.key.slice(version.length),
        row.contentType,
        row.width,
        row.height,
      ]),
    ).toStrictEqual([
      ["/original.jpg", "image/jpeg", 900, 1200],
      ["/thumb.webp", "image/webp", 150, 200],
      ["/card.webp", "image/webp", 450, 600],
      ["/full.webp", "image/webp", 900, 1200],
    ]);
    expect(objects[0]?.art).toStrictEqual({
      width: 900,
      height: 1200,
      from: "#1f2a44",
      to: "#6d83b0",
      label: "HALF-ZIP",
      kind: "garment",
    });
    const plain = core.wardrobeItems.find(
      (row) => row.name === "Hidden Comfort" && row.userId === MAYA_ID,
    );
    expect(plain?.photoKey).toBe(
      `items/${MAYA_ID}/${String(plain?.id)}/${String(plain?.photoKey?.split("/").at(-1))}`,
    );
    const noPhoto = core.wardrobeItems.find(
      (row) => row.name === "Micromesh Performance Tee",
    );
    expect(noPhoto).toMatchObject({ photoKey: undefined, visibility: "ok" });
  });

  it("draws the closet's sizes, and photographs every other garment for some runners", () => {
    expect(Object.keys(PHOTO_SIZES)).toStrictEqual([...photoSizes]);
    expect(photographed("audit-r01")).toBe(13);
    expect(photographed("audit-r03")).toBe(7);
  });

  it("files every entry photo under its entry, with an object to draw", () => {
    const keys = new Set(seed.objects.map((row) => row.key));
    for (const photo of core.entryPhotos) {
      const entry = entryOf(photo.entryId);
      expect(photo.photoKey).toBe(
        `entries/${String(entry?.userId)}/${photo.entryId}/${photo.id}`,
      );
      expect(keys.has(photo.photoKey)).toBe(true);
    }
    for (const item of core.wardrobeItems) {
      if (item.photoKey !== undefined && item.photoKey !== null) {
        expect(keys.has(`${item.photoKey}/original.jpg`)).toBe(true);
      }
    }
    const first = seed.objects.find((row) => row.key.startsWith("entries/"));
    expect(first).toMatchObject({
      contentType: "image/jpeg",
      width: 1200,
      height: 1200,
      art: { label: "NIGHT-LOOP", kind: "entry" },
    });
    const held = core.entryPhotos.filter(
      (row) => row.screenStatus === "hidden_pending_review",
    );
    expect(held.map((row) => row.position)).toStrictEqual([3, 3, 3, 3, 3, 3]);
  });

  it("logs Maya's first run as a five-k easy run from a watch file", () => {
    const run = mayaRuns[0];
    expect(run).toMatchObject({
      source: "file",
      startedAt: NOW - DAY,
      durationS: 1500,
      distanceM: 5000,
      movingS: 1460,
      elevationGainM: 0,
      lat: 41.88,
      lng: -87.63,
      indoor: false,
      effort: "easy",
      rpe: 3,
      effortSource: "watch",
      title: "Morning run",
      weatherStatus: "attached",
    });
    expect(mayaRuns[1]).toMatchObject({
      source: "garmin",
      durationS: 2527,
      elevationGainM: 37,
      effort: "steady",
      rpe: undefined,
      effortSource: undefined,
      deviceName: "Forerunner 265",
      startedAt: Math.floor(NOW - 4.1 * DAY - 5 * HOUR),
    });
    expect(run?.deviceName).toBeNull();
    expect(mayaRuns[7]?.title).toMatch(/^Sunday long run out along/u);
  });

  it("gives indoor runs no place and no weather, and manual runs a typed reading", () => {
    const indoor = mayaRuns.find((run) => run.id === seed.summary.indoorRunId);
    expect(indoor?.lat).toBeUndefined();
    expect(indoor?.lng).toBeUndefined();
    expect(indoor).toMatchObject({
      indoor: true,
      weatherStatus: "none",
    });
    expect(conditionsOf(seed.summary.indoorRunId)).toBeUndefined();
    const manual = seed.weather.manual.find(
      (row) => row.runId === seed.summary.manualRunId,
    );
    const manualRun = mayaRuns.find(
      (run) => run.id === seed.summary.manualRunId,
    );
    expect(manualRun?.weatherStatus).toBe("manual");
    expect(manual?.setAt).toBe((manualRun?.startedAt ?? 0) + HOUR);
    expect(conditionsOf(seed.summary.manualRunId)).toMatchObject({
      source: "manual",
      feelsLikeC: manual?.tempC,
      minFeelsLikeC: manual?.tempC,
      maxFeelsLikeC: manual?.tempC,
    });
    expect(seed.weather.manual).toHaveLength(3);
    const statuses = mayaRuns.map((run) => run.weatherStatus);
    expect(statuses.filter((status) => status === "failed")).toHaveLength(1);
    expect(statuses.filter((status) => status === "pending")).toHaveLength(1);
    expect(statuses.filter((status) => status === "none")).toHaveLength(3);
  });

  it("reads observed runs' conditions from the readings at their hour", () => {
    const run = mayaRuns[0];
    const conditions = core.runConditions.find((row) => row.runId === run?.id);
    const hour = Math.floor((run?.startedAt ?? 0) / HOUR);
    const readings = seed.weather.observations.filter(
      (row) => isAtMaya(row) && row.hourBucket === hour,
    );
    expect(readings).toHaveLength(1);
    expect(readings[0]).toMatchObject({
      feelsLikeC: conditions?.feelsLikeC,
      tempC: (conditions?.feelsLikeC ?? 0) + 2,
      humidity: 62,
      windKph: 9,
      lngR: -87.63,
      source: "visualcrossing",
      fetchedAt: NOW,
      timeZone: undefined,
    });
    expect(conditions).toMatchObject({
      source: "visualcrossing",
      minFeelsLikeC: conditions?.feelsLikeC,
      precipClass: "dry",
    });
    const cells = seed.weather.observations.map(
      (row) =>
        `${String(row.latR)}|${String(row.lngR)}|${String(row.hourBucket)}`,
    );
    expect(new Set(cells).size).toBe(cells.length);
    // A long run spans hours, capped at six readings.
    const longest = mayaRuns.toSorted((a, b) => b.durationS - a.durationS)[0];
    const firstHour = Math.floor((longest?.startedAt ?? 0) / HOUR);
    const span = seed.weather.observations.filter(
      (row) =>
        isAtMaya(row) &&
        row.hourBucket >= firstHour &&
        row.hourBucket < firstHour + 8,
    );
    expect(span.length).toBeLessThanOrEqual(6);
    expect(span.length).toBeGreaterThan(2);
  });

  it("observes Maya's place now, for Your conditions", () => {
    const hour = Math.floor((NOW - HOUR) / HOUR);
    const now = seed.weather.observations.filter(
      (row) => isAtMaya(row) && row.hourBucket >= hour,
    );
    expect(now.map((row) => row.feelsLikeC)).toStrictEqual([3, 4, 5, 6]);
    expect(now.map((row) => row.tempC)).toStrictEqual([5, 6, 7, 8]);
    expect(now.map((row) => row.windKph)).toStrictEqual([9, 11, 13, 15]);
  });

  it("points the summary at rows with the states a spec visits", () => {
    const { summary } = seed;
    const garment = (id: string) =>
      core.wardrobeItems.find((row) => row.id === id);
    expect(garment(summary.halfZipId)?.name).toBe("Rover Half-zip");
    expect(garment(summary.shoeId)?.name).toBe("Endorphin Speed 4");
    expect(garment(summary.retiredShoeId)).toMatchObject({
      retired: true,
      name: "Ghost 14",
    });
    expect(garment(summary.retiredShoeId)?.retiredAt).toBe(
      (garment(summary.retiredShoeId)?.createdAt ?? 0) + 60 * DAY,
    );
    expect(garment(summary.halfZipId)?.retiredAt).toBeUndefined();
    expect(garment(summary.longNameId)?.name).toMatch(/^Classic Thermal/u);
    const full = entryOf(summary.ownPhotoEntryId);
    expect(full?.runId).toBe(summary.fullRunId);
    expect(kitOf(summary.ownPhotoEntryId).length).toBeGreaterThanOrEqual(5);
    expect(photosOf(summary.ownPhotoEntryId)).toHaveLength(4);
    expect(entryOf(summary.unjudgedEntryId)?.verdict).toBeUndefined();
    expect(entryOf(summary.ownEntryId)?.verdict).toBe(-1);
    expect(entryOf(summary.publicEntryId)?.audience).toBe("world");
    expect(entryOf(summary.otherEntryId)?.userId).toBe("audit-r01");
    expect(entryOf(summary.longEntryId)?.userId).toBe("audit-r06");
    expect(
      core.outfitEntries.some((row) => row.runId === summary.backlogRunId),
    ).toBe(false);
    expect(mayaRuns.some((run) => run.id === summary.backlogRunId)).toBe(true);
    expect([summary.busyHandle, summary.longHandle]).toStrictEqual([
      "tomasz_k",
      "bartholomew_runs_far",
    ]);
  });

  it("flags the first garment of an off kit and tags even runs", () => {
    const off = mayaEntries.find(
      (entry) => entry.id === seed.summary.ownEntryId,
    );
    const kit = kitOf(off?.id ?? "");
    expect(kit.length).toBeGreaterThan(1);
    expect(kit.map((row) => row.flag ?? "none")).toStrictEqual([
      "not_enough",
      ...kit.slice(1).map(() => "none"),
    ]);
    expect(
      core.entryTags
        .filter((row) => row.entryId === off?.id)
        .map((row) => row.tag),
    ).toStrictEqual(["cold_first_mile", "hands_cold", "wind_cut_through"]);
  });

  it("follows and reacts without duplicates or follows of oneself", () => {
    const pairs = core.follows.map(
      (row) => `${row.followerId}>${row.followeeId}`,
    );
    expect(new Set(pairs).size).toBe(pairs.length);
    for (const row of core.follows)
      expect(row.followerId).not.toBe(row.followeeId);
    expect(
      core.follows.filter((row) => row.followerId === MAYA_ID),
    ).toHaveLength(8);
    expect(
      core.follows.filter((row) => row.followeeId === MAYA_ID),
    ).toHaveLength(12);
    const useful = core.reactions.map((row) => `${row.entryId}>${row.userId}`);
    expect(new Set(useful).size).toBe(useful.length);
    for (const row of core.reactions) {
      expect(row.kind).toBe("useful");
      expect(entryOf(row.entryId)?.userId).not.toBe(row.userId);
      expect(entryOf(row.entryId)?.audience).not.toBe("private");
    }
    const items = core.outfitEntryItems.map(
      (row) => `${row.entryId}>${row.itemId}`,
    );
    expect(new Set(items).size).toBe(items.length);
  });

  it("fills Maya's inbox, newest first, with followers' handles", () => {
    const [first, second] = core.notifications;
    expect(first).toMatchObject({
      kind: "followed",
      body: "@tomasz_k followed you.",
      linkId: "audit-r01",
      read: false,
      createdAt: NOW - 720,
    });
    expect(second?.subjectId).toBe(
      mayaRuns.find((run) =>
        core.outfitEntries.every((row) => row.runId !== run.id),
      )?.id,
    );
    const correction = core.notifications.find(
      (row) => row.kind === "correction_applied",
    );
    expect(correction?.linkId).toBe(seed.summary.halfZipId);
    for (const row of core.notifications) {
      expect(row.body).not.toContain("{handle}");
      expect(row.userId).toBe(MAYA_ID);
    }
  });

  it("fills the Desk: open and resolved queue rows, reports, held photos", () => {
    const resolved = core.reviewQueue.filter((row) => row.status !== "pending");
    expect(resolved.map((row) => row.status)).toStrictEqual([
      "approved",
      "removed",
    ]);
    for (const row of resolved) {
      expect(row).toMatchObject({
        resolvedBy: "e2e-desk-operator",
        resolvedAt: NOW - HOUR,
      });
    }
    const open = core.reviewQueue.find((row) => row.status === "pending");
    expect(open).toMatchObject({
      resolvedBy: undefined,
      resolvedAt: undefined,
    });
    expect(core.reports[0]).toMatchObject({
      id: "audit-rep01",
      subjectId: core.outfitEntries.filter(
        (row) => row.userId === "audit-r01",
      )[2]?.id,
      createdAt: NOW - 41 * HOUR,
    });
    expect(core.reports[1]?.note).toBeUndefined();
    const photoQueue = core.reviewQueue.filter(
      (row) => row.subjectType === "photo",
    );
    const held = core.entryPhotos.filter(
      (row) => row.screenStatus === "hidden_pending_review",
    );
    expect(photoQueue.slice(1).map((row) => row.subjectId)).toStrictEqual(
      held.map((row) => row.id),
    );
    expect(core.moderationActions.map((row) => row.action)).toStrictEqual([
      "remove",
      "remove",
      "ban",
      "ban",
      "ban",
    ]);
  });

  it("puts runners in every account state", () => {
    const profile = (id: string) =>
      core.userProfiles.find((row) => row.userId === id);
    expect(profile("audit-b02")).toMatchObject({
      bannedAt: NOW - 5 * DAY,
      banReason: "Harassment after a warning.",
    });
    expect(core.accountDeletions[1]).toMatchObject({
      userId: "audit-d02",
      requestedAt: NOW - 2 * DAY,
      purgeAfter: NOW + 5 * DAY,
    });
    const unconfirmed = core.user.find((row) => row.id === "audit-u02");
    expect(unconfirmed?.emailVerified).toBe(false);
    expect(unconfirmed?.createdAt).toStrictEqual(new Date((NOW - DAY) * 1000));
    expect(core.user.find((row) => row.id === "audit-r02")?.emailVerified).toBe(
      true,
    );
    expect(profile("audit-r01")).toMatchObject({
      tempUnit: "c",
      distanceUnit: "km",
      publicProfile: true,
      usernameScreen: "clear",
    });
    expect(profile("audit-r02")).toMatchObject({
      tempUnit: "f",
      distanceUnit: "mi",
      publicProfile: false,
    });
  });

  it("makes near-miss duplicates, each a top in someone's closet", () => {
    const dupes = core.products.filter(
      (row) => row.createdBy === "audit-dupes",
    );
    expect(dupes).toHaveLength(22);
    const pieces = core.wardrobeItems.filter((row) =>
      row.userId.startsWith("audit-dupe-"),
    );
    expect(pieces).toHaveLength(77);
    expect(pieces.at(-1)?.userId).toBe("audit-dupe-77");
    expect(pieces[0]).toMatchObject({
      category: "top",
      name: "Harrier Long Sleeve",
    });
    expect(
      core.brands.filter((row) => row.normalized.endsWith(" dupes audit")),
    ).toHaveLength(8);
  });

  it("files corrections against the canonical product and the right garment", () => {
    const [first] = core.productCorrections;
    expect(first).toMatchObject({
      id: "audit-c01",
      productId: core.products.find((row) => row.name === "Rover Half-zip")?.id,
      garmentId: seed.summary.halfZipId,
      status: "waiting",
      createdAt: NOW - 50 * HOUR,
    });
    expect(core.productCorrections[2]?.note).toBeUndefined();
  });

  it("redeems codes until everyone has one, confirming all but the unconfirmed", () => {
    expect(core.inviteRedemptions).toHaveLength(27);
    const unconfirmed = core.inviteRedemptions.filter(
      (row) => row.confirmedAt === null || row.confirmedAt === undefined,
    );
    expect(unconfirmed.map((row) => row.userId)).toStrictEqual([
      "audit-u01",
      "audit-u02",
    ]);
    const [first] = core.inviteRedemptions;
    expect(first).toMatchObject({
      userId: "audit-r01",
      email: "audit-r01@example.com",
      heldUntil: NOW + DAY,
      redeemedAt: NOW - 20 * DAY,
      confirmedAt: NOW - 20 * DAY + 600,
    });
    expect(core.inviteCodes[6]?.revokedAt).toBe(NOW - 2 * DAY);
    expect(core.inviteCodes[0]?.revokedAt).toBeUndefined();
    expect(core.inviteCodes[2]?.createdAt).toBe(NOW - 24 * DAY);
    expect(core.accessRequests[2]).toMatchObject({
      id: "audit-ask02",
      createdAt: NOW - 9 * HOUR,
      updatedAt: NOW - 5 * HOUR,
    });
  });

  it("records jobs that gave up against real subjects", () => {
    expect(core.gaveUp[1]).toMatchObject({
      id: "audit-gave1",
      kind: "weather",
      firstFailedAt: NOW - 36 * HOUR,
      lastFailedAt: NOW - 3 * HOUR,
    });
    expect(mayaRuns.some((run) => run.id === core.gaveUp[1]?.subjectId)).toBe(
      true,
    );
    expect(
      core.products.some((row) => row.id === core.gaveUp[0]?.subjectId),
    ).toBe(true);
  });

  it("reads every garment in the data through the schema", () => {
    const all = Object.values(garmentsJson).flat();
    expect(all).toHaveLength(72);
  });

  it("is what the gaps seed reads: at least sixty shared photos by other runners", () => {
    expect(sharedByOthers(seed).length).toBeGreaterThanOrEqual(60);
  });
});
