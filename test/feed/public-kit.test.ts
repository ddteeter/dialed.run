import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  accountDeletions,
  domainDenylist,
  follows,
  outfitEntries,
  outfitEntryItems,
  reactions,
  runs,
  userProfiles,
  wardrobeItems,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import type { Audience } from "../../src/lib/contracts";
import { newUlid } from "../../src/lib/ids";
import {
  entryCardOf,
  publicKitCardResponse,
  publicKitForPage,
  publicKitHeaders,
  publicKitRead,
} from "../../src/modules/feed/public-kit";

import {
  makeEntry,
  makeItem,
  makeObservation,
  makeRun,
  makeUser,
  NOW,
  resetTables,
} from "./helpers";

/**
 * The public kit's read (round 41 #86c, D-149): what `/k/<id>` and its card
 * show to anyone, through `worldVisibleEntry()` alone.
 */

function core() {
  return drizzle(env.DIALED_CORE);
}

/**
Sat Oct 18 2025, 03:30 UTC — Fri Oct 17 in Chicago, Sat Oct 18 in Tokyo.
*/
const STARTED = Date.UTC(2025, 9, 18, 3, 30) / 1000;
const LAT = 44.98;
const LNG = -93.27;

interface Seeded {
  readonly runner: string;
  readonly handle: string;
  readonly runId: string;
  readonly entryId: string;
}

/**
 * A runner with every field the page shows, and every field it must not:
 * a start time, coordinates, flags and notes, a Useful and a follow.
 */
async function fullyPopulated(
  overrides: { audience?: Audience; profileZone?: string } = {},
): Promise<Seeded> {
  const handle = `maya_${newUlid().slice(-6).toLowerCase()}`;
  const runner = await makeUser({
    username: handle,
    tempUnit: "f",
    distanceUnit: "mi",
  });
  await core()
    .update(userProfiles)
    .set({ timeZone: overrides.profileZone ?? "Asia/Tokyo" })
    .where(eq(userProfiles.userId, runner));
  const runId = await makeRun({
    userId: runner,
    lat: LAT,
    lng: LNG,
    startedAt: STARTED,
    durationS: 3400,
  });
  await core()
    .update(runs)
    .set({ distanceM: 9978, movingS: 3130, elevationGainM: 64 })
    .where(eq(runs.id, runId));
  await makeObservation({
    lat: LAT,
    lng: LNG,
    startedAt: STARTED,
    tempC: 5,
    feelsLikeC: 3.3,
    precipMm: 1,
    timeZone: "America/Chicago",
  });
  const tight = await makeItem({ userId: runner, category: "bottom" });
  const beanie = await makeItem({ userId: runner, category: "headwear" });
  const layer = await makeItem({ userId: runner, category: "top" });
  const shoes = await makeItem({ userId: runner, category: "shoes" });
  await core()
    .update(wardrobeItems)
    .set({
      brand: "Janji",
      name: "AFO Middle Tight",
      type: "tights",
      productUrl: "https://janji.com/afo",
    })
    .where(eq(wardrobeItems.id, tight));
  await core()
    .update(wardrobeItems)
    .set({ name: "Old black beanie" })
    .where(eq(wardrobeItems.id, beanie));
  await core()
    .update(wardrobeItems)
    .set({
      brand: "Tracksmith",
      name: "Brighton Base Layer",
      type: "longSleeve",
      productUrl: "https://spam.example/buy",
    })
    .where(eq(wardrobeItems.id, layer));
  await core()
    .update(wardrobeItems)
    // A type its category does not allow is no type: the category's word.
    .set({
      brand: "Nike",
      name: "Pegasus 41",
      type: "tights",
      productUrl: "not a url",
    })
    .where(eq(wardrobeItems.id, shoes));
  await core()
    .insert(domainDenylist)
    .values({ domain: "spam.example", addedBy: "op", createdAt: NOW });
  // Attached out of their id order, which is the order the table's index
  // would hand them back in: the page keeps the order they were put on.
  const entryId = await makeEntry({
    userId: runner,
    runId,
    audience: overrides.audience ?? "world",
    verdict: -1,
    itemIds: [layer, tight, beanie, shoes],
  });
  await core()
    .update(outfitEntries)
    .set({ caption: "First frosty one." })
    .where(eq(outfitEntries.id, entryId));
  await core()
    .update(outfitEntryItems)
    .set({ flag: "too_much", note: "SECRET-NOTE gloves came off" })
    .where(eq(outfitEntryItems.itemId, layer));
  await core()
    .update(outfitEntryItems)
    .set({ flag: "not_enough" })
    .where(eq(outfitEntryItems.itemId, tight));
  const fan = await makeUser();
  await core()
    .insert(reactions)
    .values({ entryId, userId: fan, kind: "useful", createdAt: NOW });
  await core()
    .insert(follows)
    .values({ followerId: fan, followeeId: runner, createdAt: NOW });
  return { runner, handle, runId, entryId };
}

async function digestOf(response: Response): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", await response.arrayBuffer()),
  );
  return [...bytes].join(",");
}

/**
The kit alone, for a test that reads one field of it.
*/
async function kitOf(entryId: string) {
  const read = await publicKitRead(entryId);
  return read?.kit;
}

async function resetAll(): Promise<void> {
  await resetTables();
  await core().delete(domainDenylist);
  await core().delete(accountDeletions);
}

beforeEach(resetAll);

describe("publicKitRead: a public kit", () => {
  it("shows exactly the fields D-149 lists, in the runner's units, on the run's day", async () => {
    const { runner, handle, entryId } = await fullyPopulated();

    const read = await publicKitRead(entryId);

    expect(read?.runnerId).toBe(runner);
    expect(read?.kit.cardVersion).toMatch(/^[0-9a-f]{16}$/u);
    expect(read?.kit).toStrictEqual({
      entryId,
      handle,
      // The observation's zone wins over the runner's place: the day is
      // where the run was (R-96).
      day: "Fri Oct 17",
      // A bit cold: judged at the coldest hour, 3.3 °C feels-like.
      conditions: { feelsLike: "38°", sky: "damp", isProviders: true },
      verdict: -1,
      distance: { value: "6.2", unit: "mi" },
      time: { value: "52:10", isMoving: true },
      pace: { value: "8:25", unit: "/mi" },
      gain: { value: "210", unit: "ft" },
      caption: "First frosty one.",
      pieces: [
        // Denied since it was saved: no link to the open web.
        {
          name: "Tracksmith Brighton Base Layer",
          model: "Brighton Base Layer",
          // The closet's TYPE chip (round 42 #90).
          kind: "L/S crew",
        },
        {
          name: "Janji AFO Middle Tight",
          model: "AFO Middle Tight",
          kind: "Tights",
          url: "https://janji.com/afo",
        },
        // No brand: its own name, and no link to drop. No type: the
        // category's word.
        {
          name: "Old black beanie",
          model: "Old black beanie",
          kind: "Headwear",
        },
        // A link that does not parse is no link.
        { name: "Nike Pegasus 41", model: "Pegasus 41", kind: "Shoes" },
      ],
      cardVersion: read?.kit.cardVersion,
    });
  });

  it("never carries a start time, coordinates, the route, flags, notes, Useful, follows or the runner's id", async () => {
    const { runner, runId, entryId } = await fullyPopulated();

    const serialized = JSON.stringify(await publicKitForPage(entryId, vi.fn()));

    for (const forbidden of [
      String(STARTED),
      // 22:30 in Chicago, 12:30 in Tokyo, 03:30 UTC: no time of day.
      "22:30",
      "10:30",
      "12:30",
      "03:30",
      "3:30",
      String(LAT),
      String(LNG),
      "too_much",
      "not_enough",
      "SECRET-NOTE",
      "useful",
      "follow",
      runner,
      runId,
      "Test run",
      "lat",
      "lng",
      "startedAt",
      "flag",
      "note",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it("reads in kilometres, metres and Celsius for a runner who counts them", async () => {
    const { runner, entryId } = await fullyPopulated();
    await core()
      .update(userProfiles)
      .set({ tempUnit: "c", distanceUnit: "km" })
      .where(eq(userProfiles.userId, runner));

    const kit = await kitOf(entryId);

    expect(kit?.conditions?.feelsLike).toBe("3°");
    expect(kit?.distance).toStrictEqual({ value: "10.0", unit: "km" });
    expect(kit?.pace).toStrictEqual({ value: "5:14", unit: "/km" });
    expect(kit?.gain).toStrictEqual({ value: "64", unit: "m" });
  });

  it("dates a run with no observation in the runner's own zone, then UTC", async () => {
    const chicago = await bareKit("America/Chicago");
    const inChicago = await kitOf(chicago);
    expect(inChicago?.day).toBe("Fri Oct 17");
    const nowhere = await bareKit(undefined);
    const inUtc = await kitOf(nowhere);
    expect(inUtc?.day).toBe("Sat Oct 18");
    const garbled = await bareKit("Not/AZone");
    const inGarbled = await kitOf(garbled);
    expect(inGarbled?.day).toBe("Sat Oct 18");
  });

  it("leaves out what the run does not have, and times it by its own clock", async () => {
    const entryId = await bareKit(undefined);

    const kit = await kitOf(entryId);

    expect(kit).not.toHaveProperty("conditions");
    expect(kit).not.toHaveProperty("verdict");
    expect(kit).not.toHaveProperty("gain");
    expect(kit).not.toHaveProperty("caption");
    // A manual run's time is its own, not moving time; 5 km in 30:00.
    expect(kit?.time).toStrictEqual({ value: "30:00", isMoving: false });
    expect(kit?.pace).toStrictEqual({ value: "9:39", unit: "/mi" });
    expect(kit?.pieces).toStrictEqual([]);
  });

  it("has no pace for a run with no distance", async () => {
    const entryId = await bareKit(undefined);
    const [entry] = await core()
      .select({ runId: outfitEntries.runId })
      .from(outfitEntries)
      .where(eq(outfitEntries.id, entryId));
    await core()
      .update(runs)
      .set({ distanceM: 0 })
      .where(eq(runs.id, entry?.runId ?? ""));

    const kit = await kitOf(entryId);

    expect(kit).not.toHaveProperty("pace");
    expect(kit?.distance).toStrictEqual({ value: "0.0", unit: "mi" });
    expect(kit === undefined ? undefined : entryCardOf(kit).stats).toBe(
      "0.0 mi · 30:00",
    );
  });

  it("credits a reading only when it is Visual Crossing's", async () => {
    const { entryId } = await fullyPopulated();
    const kit = await kitOf(entryId);
    expect(kit?.conditions?.isProviders).toBe(true);
  });
});

/**
 * A PUBLIC kit with nothing but a run: no observation (no coordinates),
 * no verdict, caption, pieces, moving time or gain.
 */
async function bareKit(profileZone: string | undefined): Promise<string> {
  const runner = await makeUser();
  await core()
    .update(userProfiles)
    .set({ timeZone: profileZone ?? sql`NULL` })
    .where(eq(userProfiles.userId, runner));
  const runId = await makeRun({ userId: runner, startedAt: STARTED });
  await core()
    .update(runs)
    .set({ lat: sql`NULL`, lng: sql`NULL` })
    .where(eq(runs.id, runId));
  return makeEntry({ userId: runner, runId, audience: "world" });
}

/**
 * Each way a kit is not public, as the open web meets it (round 41 #86f).
 */
const NOT_PUBLIC: readonly (readonly [
  string,
  (seeded: Seeded) => Promise<void>,
])[] = [
  [
    "private",
    async ({ entryId }) => {
      await setAudience(entryId, "private");
    },
  ],
  [
    "shared with runners",
    async ({ entryId }) => {
      await setAudience(entryId, "runners");
    },
  ],
  [
    "shared with groups",
    async ({ entryId }) => {
      await setAudience(entryId, "groups");
    },
  ],
  [
    "removed",
    async ({ entryId }) => {
      await setModeration(entryId, "removed");
    },
  ],
  [
    "held for review",
    async ({ entryId }) => {
      await setModeration(entryId, "hidden_pending_review");
    },
  ],
  [
    "deleted",
    async ({ entryId }) => {
      await core()
        .delete(outfitEntryItems)
        .where(eq(outfitEntryItems.entryId, entryId));
      await core().delete(outfitEntries).where(eq(outfitEntries.id, entryId));
    },
  ],
  [
    "by a banned runner",
    async ({ runner }) => {
      await core()
        .update(userProfiles)
        .set({ bannedAt: NOW })
        .where(eq(userProfiles.userId, runner));
    },
  ],
  [
    "by a runner who is leaving",
    async ({ runner }) => {
      await core()
        .insert(accountDeletions)
        .values({ userId: runner, requestedAt: NOW, purgeAfter: NOW + 1 });
    },
  ],
  [
    "by a runner with no profile at all",
    async ({ runner }) => {
      await core().delete(userProfiles).where(eq(userProfiles.userId, runner));
    },
  ],
  [
    "by a runner with no handle",
    async ({ runner }) => {
      await core()
        .update(userProfiles)
        .set({ username: sql`NULL` })
        .where(eq(userProfiles.userId, runner));
    },
  ],
  [
    "of a run that is gone",
    async ({ runId }) => {
      await core().delete(runs).where(eq(runs.id, runId));
    },
  ],
];

async function setAudience(entryId: string, audience: Audience) {
  await core()
    .update(outfitEntries)
    .set({ audience })
    .where(eq(outfitEntries.id, entryId));
}

async function setModeration(
  entryId: string,
  moderationStatus: "removed" | "hidden_pending_review",
) {
  await core()
    .update(outfitEntries)
    .set({ moderationStatus })
    .where(eq(outfitEntries.id, entryId));
}

/**
 * What the page's server function gives and sets for an id: the kit, and
 * the headers handed to the framework.
 */
async function pageFor(entryId: string) {
  const setHeaders = vi.fn();
  const kit = await publicKitForPage(entryId, setHeaders);
  return { kit, headers: setHeaders.mock.calls };
}

describe("not public (round 41 #86f): one answer for every reason", () => {
  it.each(NOT_PUBLIC)("is nothing for a kit %s", async (_reason, make) => {
    const seeded = await fullyPopulated();
    // Public first, so each reason is what takes it away.
    expect(await publicKitRead(seeded.entryId)).toBeDefined();
    await make(seeded);

    expect(await publicKitRead(seeded.entryId)).toBeUndefined();
  });

  it("gives the same page and the same headers whatever the reason, and for a kit that never existed", async () => {
    const answers = [];
    for (const [, make] of NOT_PUBLIC) {
      // One cache cell and one denylist row per seed, so each starts clean.
      await resetAll();
      const seeded = await fullyPopulated();
      await make(seeded);
      answers.push(await pageFor(seeded.entryId));
    }
    const neverExisted = await pageFor(newUlid());

    // The headers name the kit's own id, so compare them with it put back
    // to a placeholder: what differs between two answers is only the path.
    const normalise = (answer: Awaited<ReturnType<typeof pageFor>>) =>
      JSON.stringify(answer).replaceAll(/entry:[0-9A-Z]{26}/gu, "entry:ID");
    for (const answer of answers) {
      expect(normalise(answer)).toBe(normalise(neverExisted));
    }
    expect(neverExisted.kit).toBeUndefined();
    expect(neverExisted.headers).toHaveLength(1);
  });

  it("is never-existed for a path that is not an id, without naming it in a tag", async () => {
    expect(await publicKitRead("not-an-id")).toBeUndefined();
    expect(await pageFor("not-an-id")).toStrictEqual({
      kit: undefined,
      headers: [[{ "Cache-Control": "public, max-age=60" }]],
    });
  });
});

describe("publicKitHeaders (design 160, D-152)", () => {
  it("keeps a public kit a minute, tagged with the kit and its runner", async () => {
    const { runner, entryId } = await fullyPopulated();

    expect(await pageFor(entryId)).toMatchObject({
      headers: [
        [
          {
            "Cache-Control": "public, max-age=60",
            "Cache-Tag": `entry:${entryId},runner:${runner}`,
          },
        ],
      ],
    });
  });

  it("tags a kit that is not public with the kit alone", () => {
    const entryId = newUlid();

    expect(publicKitHeaders(entryId, undefined)).toStrictEqual({
      "Cache-Control": "public, max-age=60",
      "Cache-Tag": `entry:${entryId}`,
    });
  });
});

describe("the card (round 41 #86e)", () => {
  it("shows the handle, day, conditions, verdict, stats, models and credit — never the caption", async () => {
    const { entryId } = await fullyPopulated();
    const kit = await kitOf(entryId);
    if (kit === undefined) throw new Error("expected a public kit");

    expect(entryCardOf(kit)).toStrictEqual({
      handle: kit.handle,
      day: "Fri Oct 17",
      conditions: { feelsLike: "38°", sky: "damp" },
      verdict: -1,
      stats: "6.2 mi · 52:10 · 8:25 /mi · 210 ft",
      kit: [
        "Brighton Base Layer",
        "AFO Middle Tight",
        "Old black beanie",
        "Pegasus 41",
      ],
      isCredited: true,
    });
  });

  it("drops the stats a run does not have, and owes no credit without conditions", async () => {
    const entryId = await bareKit(undefined);
    const kit = await kitOf(entryId);
    if (kit === undefined) throw new Error("expected a public kit");

    const card = entryCardOf(kit);
    expect(card.stats).toBe("3.1 mi · 30:00 · 9:39 /mi");
    expect(card).not.toHaveProperty("conditions");
    expect(card).not.toHaveProperty("verdict");
    expect(card.isCredited).toBe(false);
  });

  it("gets a new version when what it shows changes, and keeps it when the caption does", async () => {
    const { entryId } = await fullyPopulated();
    const before = await kitOf(entryId);

    await core()
      .update(outfitEntries)
      .set({ caption: "Edited." })
      .where(eq(outfitEntries.id, entryId));
    const captioned = await kitOf(entryId);
    expect(captioned?.cardVersion).toBe(before?.cardVersion);

    await core()
      .update(outfitEntries)
      .set({ verdict: 0 })
      .where(eq(outfitEntries.id, entryId));
    const judged = await kitOf(entryId);
    expect(judged?.cardVersion).not.toBe(before?.cardVersion);
  });

  it("serves a public kit's own card, tagged with the kit and its runner", async () => {
    const { runner, entryId } = await fullyPopulated();

    const response = await publicKitCardResponse(
      new Request(`https://dialed.test/og/k/${entryId}?v=x`),
      entryId,
    );

    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
    // The kit's own card, not the default one.
    const fallback = await publicKitCardResponse(
      new Request(`https://dialed.test/og/k/${newUlid()}`),
      newUlid(),
    );
    expect(await digestOf(response)).not.toBe(await digestOf(fallback));
    expect(response.headers.get("Cache-Tag")).toBe(
      `entry:${entryId},runner:${runner}`,
    );
  });

  it("serves the default card for a kit that is not public, kept a minute", async () => {
    const { entryId } = await fullyPopulated({ audience: "runners" });

    const response = await publicKitCardResponse(
      new Request(`https://dialed.test/og/k/${entryId}?v=x`),
      entryId,
    );

    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(response.headers.get("Cache-Tag")).toBe(`entry:${entryId}`);
  });
});

const publicKitSource: Record<string, string> = import.meta.glob(
  "../../src/modules/feed/public-kit.ts",
  { query: "?raw", import: "default", eager: true },
);

describe("one gate for the open web (design 160's test plan)", () => {
  it("reads the kit through worldVisibleEntry, and through no signed-in rule", () => {
    const [source = ""] = Object.values(publicKitSource);

    expect(source).toMatch(/\bworldVisibleEntry\(\)/u);
    expect(source).not.toMatch(/\bpubliclyVisibleEntry\b/u);
    expect(source).not.toMatch(/\bentryVisibleTo\b/u);
    expect(source).not.toMatch(/\bgetEntryDetail\b|\bentryDetailForViewer\b/u);
  });
});
