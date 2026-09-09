import { beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";

import { outfitEntries, userProfiles } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { follow } from "../../src/modules/feed/follows";
import { otherProfile, ownProfile } from "../../src/modules/feed/profiles";
import {
  makeEntry,
  makeItem,
  makeObservation,
  makeRun,
  makeUser,
  resetTables,
  NOW,
} from "./helpers";

/**
 * Screens G (own profile) and H (someone else's). A hundred and eleven
 * mutants, all but one uncovered — nothing imported this file.
 *
 * Two things here are not merely display. The coverage bands are the
 * runner's own record of where they get it right and where they do not,
 * built from verdicts against the conditions each run actually had. And
 * the *other* profile is a privacy boundary: public info and public
 * entries, nothing else.
 */

const DAY = 86_400;

function db() {
  return drizzle(env.DIALED_CORE);
}

/**
An entry of the runner's own, with a resolved observation and a verdict.
*/
async function ratedEntry(params: {
  userId: string;
  lat: number;
  feelsLikeC: number;
  verdict: number;
  createdAt?: number;
  itemIds?: string[];
  isPublic?: boolean;
}): Promise<string> {
  const startedAt = params.createdAt ?? NOW;
  const runId = await makeRun({
    userId: params.userId,
    lat: params.lat,
    lng: -93.27,
    startedAt,
  });
  await makeObservation({
    lat: params.lat,
    lng: -93.27,
    startedAt,
    tempC: params.feelsLikeC + 2,
    feelsLikeC: params.feelsLikeC,
  });
  return makeEntry({
    userId: params.userId,
    runId,
    verdict: params.verdict,
    createdAt: startedAt,
    itemIds: params.itemIds ?? [],
    isPublic: params.isPublic ?? true,
  });
}

beforeEach(async () => {
  await resetTables();
});

describe("ownProfile: the empty case", () => {
  it("answers for a runner with no entries at all", async () => {
    const userId = await makeUser({ displayName: "Fresh runner" });

    const profile = await ownProfile(userId);

    expect(profile).toMatchObject({
      userId,
      displayName: "Fresh runner",
      entryCount: 0,
      coverage: [],
      mostWornItems: [],
      recentEntries: [],
      followerCount: 0,
      followingCount: 0,
    });
  });

  it("answers for a user id with no profile row", async () => {
    // A signed-up account that has not filled anything in is not an error.
    const profile = await ownProfile("01JNOPROFILE0000000000000");
    expect(profile.displayName).toBeUndefined();
    expect(profile.cityLabel).toBeUndefined();
  });
});

describe("ownProfile: coverage bands", () => {
  it("counts a verdict into the band its conditions fall in", async () => {
    const userId = await makeUser();
    await ratedEntry({ userId, lat: 41.11, feelsLikeC: 3, verdict: 0 });

    const profile = await ownProfile(userId);
    const [band] = profile.coverage;

    expect(band).toMatchObject({ cold: 0, dialed: 1, warm: 0 });
    expect(band?.label.length).toBeGreaterThan(0);
  });

  it("splits cold, dialed and warm by the sign of the verdict", async () => {
    // −2..+2 with 0 = dialed. A verdict counted on the wrong side turns
    // "I get this band right" into its opposite.
    const userId = await makeUser();
    await ratedEntry({ userId, lat: 42.11, feelsLikeC: 3, verdict: -2 });
    await ratedEntry({ userId, lat: 42.12, feelsLikeC: 3, verdict: 0 });
    await ratedEntry({ userId, lat: 42.13, feelsLikeC: 3, verdict: 2 });

    const profile = await ownProfile(userId);
    const [band] = profile.coverage;

    expect(band).toMatchObject({ cold: 1, dialed: 1, warm: 1 });
  });

  it("ignores an entry with no verdict", async () => {
    const userId = await makeUser();
    const runId = await makeRun({ userId, lat: 43.11, lng: -93.27 });
    await makeObservation({
      lat: 43.11,
      lng: -93.27,
      startedAt: NOW,
      tempC: 5,
      feelsLikeC: 3,
    });
    await makeEntry({ userId, runId });

    const profile = await ownProfile(userId);

    expect(profile.entryCount).toBe(1);
    expect(profile.coverage).toStrictEqual([]);
  });

  it("returns the bands coldest first", async () => {
    // The profile draws them as a scale; out of order it is not a scale.
    const userId = await makeUser();
    await ratedEntry({ userId, lat: 44.11, feelsLikeC: 18, verdict: 0 });
    await ratedEntry({ userId, lat: 44.12, feelsLikeC: -8, verdict: 0 });

    const profile = await ownProfile(userId);
    const floors = profile.coverage.map((band) => band.bandFloorC);

    expect(floors.length).toBeGreaterThanOrEqual(2);
    for (const [index, floor] of floors.entries()) {
      const next = floors[index + 1];
      if (next !== undefined) expect(floor).toBeLessThan(next);
    }
  });
});

describe("ownProfile: most worn", () => {
  it("ranks items by how often they were worn", async () => {
    const userId = await makeUser();
    const often = await makeItem({ userId, name: "Favourite" });
    const once = await makeItem({ userId, name: "Occasional" });
    await ratedEntry({
      userId,
      lat: 45.11,
      feelsLikeC: 3,
      verdict: 0,
      itemIds: [often, once],
    });
    await ratedEntry({
      userId,
      lat: 45.12,
      feelsLikeC: 3,
      verdict: 0,
      itemIds: [often],
    });

    const profile = await ownProfile(userId);
    const [first, second] = profile.mostWornItems;

    expect(first).toStrictEqual({
      itemId: often,
      name: "Favourite",
      wearCount: 2,
    });
    expect(second?.wearCount).toBe(1);
  });

  it("names an item that has since been deleted", async () => {
    // Entries outlive garments — "retire, don't delete" covers referenced
    // items, but an unreferenced one is hard-deleted and the entry keeps
    // the id. A blank line in the list is worse than saying so.
    const userId = await makeUser();
    await ratedEntry({
      userId,
      lat: 46.11,
      feelsLikeC: 3,
      verdict: 0,
      itemIds: ["01JGONEITEM00000000000000"],
    });

    const profile = await ownProfile(userId);
    const [worn] = profile.mostWornItems;

    expect(worn).toStrictEqual({
      itemId: "01JGONEITEM00000000000000",
      name: "[removed item]",
      wearCount: 1,
    });
  });
});

describe("ownProfile: the social counts", () => {
  it("counts followers and following separately", async () => {
    const me = await makeUser();
    const follower = await makeUser();
    const followed = await makeUser();
    await follow(follower, me);
    await follow(me, followed);

    const profile = await ownProfile(me);

    expect(profile.followerCount).toBe(1);
    expect(profile.followingCount).toBe(1);
  });
});

describe("otherProfile", () => {
  it("answers with nothing for a runner who has no profile", async () => {
    expect(await otherProfile("01JNOBODY000000000000000")).toBeUndefined();
  });

  it("shows public entries and hides private ones", async () => {
    // The privacy boundary. A private entry never appears in feeds or on
    // anyone else's screen.
    const userId = await makeUser({ displayName: "Public runner" });
    const shown = await ratedEntry({
      userId,
      lat: 47.11,
      feelsLikeC: 3,
      verdict: 0,
      isPublic: true,
    });
    await ratedEntry({
      userId,
      lat: 47.12,
      feelsLikeC: 3,
      verdict: 0,
      isPublic: false,
    });

    const profile = await otherProfile(userId);

    expect(profile?.displayName).toBe("Public runner");
    expect(profile?.recentPublicEntries.map((entry) => entry.entryId)).toStrictEqual(
      [shown],
    );
  });

  it("shows the newest entries first", async () => {
    const userId = await makeUser();
    const older = await ratedEntry({
      userId,
      lat: 48.11,
      feelsLikeC: 3,
      verdict: 0,
      createdAt: NOW - 10 * DAY,
    });
    const newer = await ratedEntry({
      userId,
      lat: 48.12,
      feelsLikeC: 3,
      verdict: 0,
      createdAt: NOW,
    });

    const profile = await otherProfile(userId);

    expect(profile?.recentPublicEntries.map((entry) => entry.entryId)).toStrictEqual(
      [newer, older],
    );
  });

  it("carries the caption and the verdict, and nothing aggregated", async () => {
    const userId = await makeUser();
    const entryId = await ratedEntry({
      userId,
      lat: 49.11,
      feelsLikeC: 3,
      verdict: -1,
    });
    await db()
      .update(outfitEntries)
      .set({ caption: "Cold first mile" })
      .where(eq(outfitEntries.id, entryId));

    const profile = await otherProfile(userId);

    expect(profile?.recentPublicEntries[0]).toStrictEqual({
      entryId,
      createdAt: NOW,
      verdict: -1,
      caption: "Cold first mile",
    });
    expect(Object.hasOwn(profile ?? {}, "coverage")).toBe(false);
  });

  it("shows the city label a runner chose to publish", async () => {
    const userId = await makeUser();
    await db()
      .update(userProfiles)
      .set({ cityLabel: "Minneapolis" })
      .where(eq(userProfiles.userId, userId));

    const profile = await otherProfile(userId);
    expect(profile?.cityLabel).toBe("Minneapolis");
  });
});

describe("ownProfile: what it leaves out", () => {
  it("skips an entry whose conditions were never resolved", async () => {
    // A rated run with no observation cannot be placed in a band. Reading
    // one anyway is a crash on the profile screen.
    const userId = await makeUser();
    const runId = await makeRun({ userId, lat: 51.11, lng: -93.27 });
    await makeEntry({ userId, runId, verdict: 0 });

    const profile = await ownProfile(userId);

    expect(profile.entryCount).toBe(1);
    expect(profile.coverage).toStrictEqual([]);
  });

  it("labels a band in Fahrenheit", async () => {
    // The profile is the runner's own record and reads in their units; an
    // unlabelled band is a bar with no axis.
    const userId = await makeUser();
    await ratedEntry({ userId, lat: 52.11, feelsLikeC: 0, verdict: 0 });

    const profile = await ownProfile(userId);
    const [band] = profile.coverage;

    expect(band?.label).toMatch(/^-?\d+–-?\d+°$/);
  });

  it("reports an unset city and thermal level as unset, not as null", async () => {
    // These reach a component that renders "—" for `undefined`; `null`
    // renders as the word.
    const userId = await makeUser();

    const profile = await ownProfile(userId);

    expect(profile.cityLabel).toBeUndefined();
    expect(profile.thermalLevel).toBeUndefined();
  });

  it("shows the most recent twenty entries, and their verdicts", async () => {
    const userId = await makeUser();
    for (let index = 0; index < 21; index += 1) {
      await ratedEntry({
        userId,
        lat: 53 + index / 100,
        feelsLikeC: 3,
        verdict: 0,
        createdAt: NOW - index * DAY,
      });
    }

    const profile = await ownProfile(userId);

    expect(profile.entryCount).toBe(21);
    expect(profile.recentEntries).toHaveLength(20);
    expect(profile.recentEntries[0]).toMatchObject({
      createdAt: NOW,
      verdict: 0,
    });
  });
});
