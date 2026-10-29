import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { user } from "../../src/db/schema-auth";
import {
  accountDeletions,
  entryPhotos,
  outfitEntries,
  outfitEntryItems,
  publicPhotos,
  runs,
  userProfiles,
  usernameHistory,
  wardrobeItems,
} from "../../src/db/schema-core";
import { coreDb, env } from "../../src/env";
import type { Audience } from "../../src/lib/contracts";
import { newUlid } from "../../src/lib/ids";
import { PUBLIC_PHOTOS_ORIGIN } from "../../src/lib/public-photos";
import { publicRotation } from "../../src/modules/closet";
import { worldVisibleEntry } from "../../src/modules/safety";
import {
  publicProfileForPage,
  publicProfileHeaders,
  publicProfileRead,
} from "../../src/modules/feed/public-profile";

import {
  addAccount,
  makeEntry,
  makeItem,
  makeObservation,
  makeRun,
  makeUser,
  NOW,
  resetTables,
} from "./helpers";

/**
 * The public profile's read (round 41 #86d, #86f; D-149): what `/@handle`
 * shows to anyone — the runner's PUBLIC kits through `worldVisibleEntry()`
 * alone, and the closet's own rotation while they show it.
 */

function core() {
  return drizzle(env.DIALED_CORE);
}

const HANDLE = "maya_runs";

/**
Sat Oct 18 2025, 03:30 UTC — Fri Oct 17 in Chicago, Sat Oct 18 in Tokyo.
*/
const STARTED = Date.UTC(2025, 9, 18, 3, 30) / 1000;
const LAT = 44.98;
const LNG = -93.27;

interface Seeded {
  readonly runner: string;
  /**
  Newest first: the five PUBLIC kits.
  */
  readonly publicKits: readonly string[];
  readonly hiddenKits: readonly string[];
  readonly runIds: readonly string[];
}

async function setItem(
  itemId: string,
  values: Partial<typeof wardrobeItems.$inferInsert>,
): Promise<void> {
  await core()
    .update(wardrobeItems)
    .set(values)
    .where(eq(wardrobeItems.id, itemId));
}

/**
 * A kit on its own run, `minutesAgo` before NOW so the order is known, and
 * the run's distance in metres.
 */
async function kit(
  runner: string,
  params: {
    audience: Audience;
    minutesAgo: number;
    distanceM: number;
    verdict?: number;
    itemIds?: string[];
    startedAt?: number;
  },
): Promise<{ entryId: string; runId: string }> {
  const runId = await makeRun({
    userId: runner,
    lat: LAT,
    lng: LNG,
    startedAt: params.startedAt ?? STARTED - params.minutesAgo * 86_400,
  });
  await core()
    .update(runs)
    .set({ distanceM: params.distanceM })
    .where(eq(runs.id, runId));
  const entryId = await makeEntry({
    userId: runner,
    runId,
    audience: params.audience,
    createdAt: NOW - params.minutesAgo * 60,
    ...(params.verdict !== undefined && { verdict: params.verdict }),
    ...(params.itemIds !== undefined && { itemIds: params.itemIds }),
  });
  await core()
    .update(outfitEntries)
    .set({ caption: `CAPTION-${String(params.minutesAgo)}` })
    .where(eq(outfitEntries.id, entryId));
  return { entryId, runId };
}

/**
 * A runner with a public profile and closet, five PUBLIC kits and every
 * kind of kit and field the profile must not show: shared, private,
 * removed and held kits, captions, flags and notes, start times and
 * coordinates.
 */
async function fullyPopulated(
  overrides: { publicCloset?: boolean; handle?: string } = {},
): Promise<Seeded> {
  const runner = await makeUser({
    username: overrides.handle ?? HANDLE,
    tempUnit: "f",
    distanceUnit: "mi",
  });
  await addAccount(runner, true);
  await core()
    .update(userProfiles)
    .set({
      timeZone: "Asia/Tokyo",
      publicProfile: true,
      publicCloset: overrides.publicCloset ?? true,
    })
    .where(eq(userProfiles.userId, runner));

  const pegasus = await makeItem({ userId: runner, category: "shoes" });
  const oldPegasus = await makeItem({ userId: runner, category: "shoes" });
  const layer = await makeItem({ userId: runner, category: "top" });
  const tight = await makeItem({ userId: runner, category: "bottom" });
  const tee = await makeItem({ userId: runner, category: "top" });
  await setItem(pegasus, {
    brand: "Nike",
    name: "Pegasus 41",
    createdAt: NOW - 10,
  });
  await setItem(oldPegasus, {
    brand: "Nike",
    name: "Pegasus 40",
    retired: true,
    retiredAt: NOW - 5,
    createdAt: NOW - 50,
  });
  await setItem(layer, {
    brand: "Tracksmith",
    name: "Brighton Base Layer",
    type: "longSleeve",
    createdAt: NOW - 20,
  });
  // A type its category does not admit reads as the category.
  await setItem(tight, {
    name: "AFO Middle Tight",
    type: "beanie",
    createdAt: NOW - 30,
  });
  await setItem(tee, {
    name: "Grey tee",
    type: "tee",
    retired: true,
    createdAt: NOW - 40,
  });

  // The observation is the oldest public kit's hour, so one row has
  // conditions and the rest do not.
  await makeObservation({
    lat: LAT,
    lng: LNG,
    startedAt: STARTED,
    tempC: 5,
    feelsLikeC: 3.3,
    precipMm: 1,
    timeZone: "America/Chicago",
  });
  const newest = await kit(runner, {
    audience: "world",
    minutesAgo: 1,
    distanceM: 9978,
    verdict: 0,
    itemIds: [pegasus, layer],
  });
  const second = await kit(runner, {
    audience: "world",
    minutesAgo: 2,
    distanceM: 5000,
  });
  const third = await kit(runner, {
    audience: "world",
    minutesAgo: 3,
    distanceM: 21_097,
    verdict: 2,
  });
  const fourth = await kit(runner, {
    audience: "world",
    minutesAgo: 4,
    distanceM: 8000,
  });
  const oldest = await kit(runner, {
    audience: "world",
    minutesAgo: 9,
    distanceM: 9978,
    verdict: -1,
    startedAt: STARTED,
    itemIds: [tight],
  });
  // Newer than every public kit, so a leak would lead the list.
  const shared = await kit(runner, {
    audience: "runners",
    minutesAgo: 0,
    distanceM: 3000,
    itemIds: [pegasus],
  });
  const secret = await kit(runner, {
    audience: "private",
    minutesAgo: 0,
    distanceM: 10_000,
    itemIds: [pegasus, tee],
  });
  const removed = await kit(runner, {
    audience: "world",
    minutesAgo: 0,
    distanceM: 4000,
  });
  const held = await kit(runner, {
    audience: "world",
    minutesAgo: 0,
    distanceM: 4000,
  });
  await core()
    .update(outfitEntries)
    .set({ moderationStatus: "removed" })
    .where(eq(outfitEntries.id, removed.entryId));
  await core()
    .update(outfitEntries)
    .set({ moderationStatus: "hidden_pending_review" })
    .where(eq(outfitEntries.id, held.entryId));
  await core()
    .update(outfitEntryItems)
    .set({ flag: "too_much", note: "SECRET-NOTE gloves came off" })
    .where(eq(outfitEntryItems.itemId, layer));
  await core()
    .update(outfitEntryItems)
    .set({ flag: "not_enough" })
    .where(eq(outfitEntryItems.itemId, tight));

  const publicOnes = [newest, second, third, fourth, oldest];
  const hiddenOnes = [shared, secret, removed, held];
  return {
    runner,
    publicKits: publicOnes.map((one) => one.entryId),
    hiddenKits: hiddenOnes.map((one) => one.entryId),
    runIds: [...publicOnes, ...hiddenOnes].map((one) => one.runId),
  };
}

async function resetAll(): Promise<void> {
  await resetTables();
  await core().delete(accountDeletions);
  await core().delete(usernameHistory);
}

beforeEach(resetAll);

/**
 * The rotation the fixture's closet gives: shoes carry their mileage
 * (the closet's sum over every run they were on, here 9,978 m public, 3 km
 * shared and 10 km private: 14.3 mi), nothing else does.
 */
const ROTATION = {
  inUse: [
    { name: "Brighton Base Layer", detail: "L/S crew" },
    { name: "AFO Middle Tight", detail: "Bottom" },
  ],
  shoes: [{ name: "Pegasus 41", detail: "14 mi" }],
  retired: [
    { name: "Grey tee", detail: "Tee" },
    { name: "Pegasus 40", detail: "0 mi" },
  ],
};

describe("publicProfileRead: a public profile", () => {
  it("shows the handle, the PUBLIC kits newest first (three of them) and the rotation", async () => {
    const { runner, publicKits } = await fullyPopulated();

    const read = await publicProfileRead(HANDLE, false);

    expect(read?.runnerId).toBe(runner);
    expect(read?.profile).toStrictEqual({
      handle: HANDLE,
      kitCount: 5,
      kits: [
        {
          entryId: publicKits[0],
          // No observation: the runner's own zone (Tokyo) dates it.
          day: "Fri Oct 17",
          verdict: 0,
          distance: { value: "6.2", unit: "mi" },
        },
        {
          entryId: publicKits[1],
          day: "Thu Oct 16",
          distance: { value: "3.1", unit: "mi" },
        },
        {
          entryId: publicKits[2],
          day: "Wed Oct 15",
          verdict: 2,
          distance: { value: "13.1", unit: "mi" },
        },
      ],
      rotation: ROTATION,
    });
  });

  it("lists every PUBLIC kit when asked for all, and dates a run where it was run", async () => {
    const { publicKits } = await fullyPopulated();

    const read = await publicProfileRead(HANDLE, true);

    expect(read?.profile.kitCount).toBe(5);
    expect(read?.profile.kits.map((row) => row.entryId)).toStrictEqual(
      publicKits,
    );
    expect(read?.profile.kits[4]).toStrictEqual({
      entryId: publicKits[4],
      // The observation's zone wins over the runner's place (R-96).
      day: "Fri Oct 17",
      conditions: { feelsLike: "38°", sky: "damp", isProviders: true },
      verdict: -1,
      distance: { value: "6.2", unit: "mi" },
    });
  });

  it("finds the runner however the handle is typed, and names them as they hold it", async () => {
    await fullyPopulated();

    const read = await publicProfileRead("Maya_Runs", false);

    expect(read?.profile.handle).toBe(HANDLE);
  });

  it("has no Rotation while the closet is not shown", async () => {
    await fullyPopulated({ publicCloset: false });

    const read = await publicProfileRead(HANDLE, true);

    expect(read?.profile).not.toHaveProperty("rotation");
    expect(read?.profile.kitCount).toBe(5);
  });

  it("is a profile with no kits for a runner who has made none public", async () => {
    const runner = await makeUser({ username: HANDLE });
    await addAccount(runner, true);
    await core()
      .update(userProfiles)
      .set({ publicProfile: true })
      .where(eq(userProfiles.userId, runner));

    const read = await publicProfileRead(HANDLE, false);

    expect(read?.profile).toStrictEqual({
      handle: HANDLE,
      kitCount: 0,
      kits: [],
    });
  });

  it("shows a kit's first public photo in its row, as /k serves it, and the tile for a kit with none", async () => {
    const { runner, publicKits } = await fullyPopulated();
    const [withNone, withPhotos] = publicKits;
    await core().delete(publicPhotos);
    await core().delete(entryPhotos);
    for (const [position, key] of ["first", "second"].entries()) {
      const photoId = newUlid();
      await core()
        .insert(entryPhotos)
        .values({
          id: photoId,
          entryId: withPhotos ?? "",
          photoKey: `entries/${runner}/${withPhotos ?? ""}/${photoId}`,
          position,
          screenStatus: "pass",
        });
      await core()
        .insert(publicPhotos)
        .values({
          key,
          photoId,
          entryId: withPhotos ?? "",
          userId: runner,
          createdAt: NOW,
          publishedAt: NOW,
        });
    }

    const read = await publicProfileRead(HANDLE, false);

    expect(read?.profile.kits[0]?.entryId).toBe(withNone);
    expect(read?.profile.kits[0]).not.toHaveProperty("photo");
    expect(read?.profile.kits[1]).toStrictEqual({
      entryId: withPhotos,
      photo: `${PUBLIC_PHOTOS_ORIGIN}/first`,
      day: "Thu Oct 16",
      distance: { value: "3.1", unit: "mi" },
    });
  });

  it("never carries a time, a place, a caption, a flag, a note, a hidden kit or the runner's id", async () => {
    const { runner, hiddenKits, runIds } = await fullyPopulated();

    const serialized = JSON.stringify(
      await publicProfileForPage(HANDLE, true, vi.fn()),
    );

    for (const forbidden of [
      runner,
      ...hiddenKits,
      ...runIds,
      String(STARTED),
      "03:30",
      "12:30",
      "22:30",
      String(LAT),
      String(LNG),
      "CAPTION",
      "too_much",
      "not_enough",
      "SECRET-NOTE",
      "Test run",
      "Nike",
      "Tracksmith",
      "lat",
      "lng",
      "startedAt",
      "flag",
      "note",
      "runCount",
      "mileageM",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});

describe("publicRotation", () => {
  it("adds up a shoe's miles or kilometres to the whole unit", async () => {
    const { runner } = await fullyPopulated();

    // 22,978 m in all: 14.3 mi, 23.0 km.
    const rotation = await publicRotation(coreDb(), runner, "km");

    expect(rotation.shoes).toStrictEqual([
      { name: "Pegasus 41", detail: "23 km" },
    ]);
  });

  it("is empty for a runner with an empty closet", async () => {
    const runner = await makeUser();

    expect(await publicRotation(coreDb(), runner, "mi")).toStrictEqual({
      inUse: [],
      shoes: [],
      retired: [],
    });
  });
});

/**
 * Every reason a profile is not public (round 41 #86f), each applied to a
 * fully populated public one.
 */
const NOT_PUBLIC: readonly (readonly [
  string,
  (seeded: Seeded) => Promise<void>,
])[] = [
  [
    "whose runner turned it off",
    async ({ runner }) => {
      await core()
        .update(userProfiles)
        .set({ publicProfile: false })
        .where(eq(userProfiles.userId, runner));
    },
  ],
  [
    "whose runner is banned",
    async ({ runner }) => {
      await core()
        .update(userProfiles)
        .set({ bannedAt: NOW })
        .where(eq(userProfiles.userId, runner));
    },
  ],
  [
    "whose runner is leaving",
    async ({ runner }) => {
      await core()
        .insert(accountDeletions)
        .values({ userId: runner, requestedAt: NOW, purgeAfter: NOW + 1 });
    },
  ],
  [
    "whose runner has not confirmed their address",
    async ({ runner }) => {
      await core()
        .update(user)
        .set({ emailVerified: false })
        .where(eq(user.id, runner));
    },
  ],
  [
    "at a handle its runner gave up",
    async ({ runner }) => {
      await core()
        .update(userProfiles)
        .set({ username: "maya_new" })
        .where(eq(userProfiles.userId, runner));
      await core()
        .insert(usernameHistory)
        .values({ username: HANDLE, userId: runner, retiredAt: NOW });
    },
  ],
  [
    "whose runner's account is gone",
    async ({ runner }) => {
      await core().delete(userProfiles).where(eq(userProfiles.userId, runner));
      await core()
        .insert(usernameHistory)
        .values({ username: HANDLE, userId: runner, retiredAt: NOW });
    },
  ],
  [
    "at a handle nobody ever held",
    async ({ runner }) => {
      await core().delete(userProfiles).where(eq(userProfiles.userId, runner));
    },
  ],
];

/**
 * What the page's server function gives and sets for a handle: the
 * profile, and the headers handed to the framework.
 */
async function pageFor(handle: string) {
  const setHeaders = vi.fn();
  const profile = await publicProfileForPage(handle, false, setHeaders);
  return { profile, headers: setHeaders.mock.calls };
}

describe("not public (round 41 #86f): one answer for every reason", () => {
  it.each(NOT_PUBLIC)("is nothing for a profile %s", async (_reason, make) => {
    const seeded = await fullyPopulated();
    // Public first, so each reason is what takes it away.
    expect(await publicProfileRead(HANDLE, false)).toBeDefined();
    await make(seeded);

    expect(await publicProfileRead(HANDLE, false)).toBeUndefined();
  });

  it("gives the same answer and the same headers whatever the reason", async () => {
    const answers = [];
    for (const [, make] of NOT_PUBLIC) {
      await resetAll();
      await make(await fullyPopulated());
      answers.push(await pageFor(HANDLE));
    }

    for (const answer of answers) {
      expect(answer).toStrictEqual({
        profile: undefined,
        // The handle's path, never the runner: nothing says whether
        // anyone holds it.
        headers: [
          [
            {
              "Cache-Control": "public, max-age=60",
              "Cache-Tag": `handle:${HANDLE}`,
            },
          ],
        ],
      });
    }
  });

  it("is nothing for a segment that is not a handle, without naming it in a tag", async () => {
    expect(await pageFor("not a handle!")).toStrictEqual({
      profile: undefined,
      headers: [[{ "Cache-Control": "public, max-age=60" }]],
    });
  });
});

describe("publicProfileHeaders (design 160, D-152)", () => {
  it("keeps a public profile a minute, tagged with its path and its runner", async () => {
    const { runner } = await fullyPopulated();

    const page = await pageFor(HANDLE);

    expect(page.headers).toStrictEqual([
      [
        {
          "Cache-Control": "public, max-age=60",
          "Cache-Tag": `handle:${HANDLE},runner:${runner}`,
        },
      ],
    ]);
  });

  it("tags the handle as the runner holds it, whatever its case", () => {
    expect(publicProfileHeaders("Maya_Runs", undefined)).toStrictEqual({
      "Cache-Control": "public, max-age=60",
      "Cache-Tag": `handle:${HANDLE}`,
    });
  });
});

describe("the read's cost", () => {
  it("reads one runner's PUBLIC kits with their runs by index, never a scan", async () => {
    const owner = newUlid();
    const { sql: statement, params } = core()
      .select({ id: outfitEntries.id, distanceM: runs.distanceM })
      .from(outfitEntries)
      .innerJoin(runs, eq(runs.id, outfitEntries.runId))
      .where(and(eq(outfitEntries.userId, owner), worldVisibleEntry()))
      .orderBy(desc(outfitEntries.createdAt))
      .limit(3)
      .toSQL();
    const plan = await env.DIALED_CORE.prepare(
      `EXPLAIN QUERY PLAN ${statement}`,
    )
      .bind(...params)
      .all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail).join("\n");

    expect(details).toMatch(/USING INDEX entries_user_world_created/u);
    expect(details).toMatch(/SEARCH runs USING INDEX sqlite_autoindex_runs_1/u);
    expect(details).not.toMatch(/SCAN\s+(outfit_entries|runs|user_profiles)/iu);
    expect(details).not.toMatch(/TEMP B-TREE/u);
  });
});

const publicProfileSource: Record<string, string> = import.meta.glob(
  "../../src/modules/feed/public-profile.ts",
  { query: "?raw", import: "default", eager: true },
);

describe("one gate for the open web (design 160's test plan)", () => {
  it("reads the kits through worldVisibleEntry, and through no signed-in rule", () => {
    const [source = ""] = Object.values(publicProfileSource);

    expect(source).toMatch(/\bworldVisibleEntry\(\)/u);
    expect(source).toMatch(/\brunnerInStanding\(\)/u);
    expect(source).not.toMatch(/\bpubliclyVisibleEntry\b/u);
    expect(source).not.toMatch(/\bentryVisibleTo\b/u);
    expect(source).not.toMatch(/\brunnerVisibleToViewer\b/u);
  });
});
