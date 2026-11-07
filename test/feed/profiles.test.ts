import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";

import { outfitEntries, runs, userProfiles } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { follow } from "../../src/modules/feed/follows";
import { otherProfile, ownProfile } from "../../src/modules/feed/profiles";
import {
  makeEntry,
  makeItem,
  makeObservation,
  makeRun,
  makeVerifiedUser,
  resetTables,
  NOW,
} from "./helpers";
import type { Audience } from "../../src/lib/contracts";

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
  audience?: Audience;
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
    audience: params.audience ?? "runners",
  });
}

beforeEach(async () => {
  await resetTables();
});

describe("ownProfile: the empty case", () => {
  it("answers for a runner with no entries at all", async () => {
    const userId = await makeVerifiedUser({ username: "Fresh runner" });

    const profile = await ownProfile(userId);

    expect(profile).toMatchObject({
      userId,
      username: "Fresh runner",
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
    expect(profile.username).toBeUndefined();
    expect(profile.cityLabel).toBeUndefined();
  });
});

describe("ownProfile: coverage bands", () => {
  it("counts a verdict into the band its conditions fall in", async () => {
    const userId = await makeVerifiedUser();
    await ratedEntry({ userId, lat: 41.11, feelsLikeC: 3, verdict: 0 });

    const profile = await ownProfile(userId);
    const [band] = profile.coverage;

    expect(band).toMatchObject({ cold: 0, dialed: 1, warm: 0 });
    expect(band?.label.length).toBeGreaterThan(0);
  });

  it("splits cold, dialed and warm by the sign of the verdict", async () => {
    // −2..+2 with 0 = dialed. A verdict counted on the wrong side turns
    // "I get this band right" into its opposite.
    const userId = await makeVerifiedUser();
    await ratedEntry({ userId, lat: 42.11, feelsLikeC: 3, verdict: -2 });
    await ratedEntry({ userId, lat: 42.12, feelsLikeC: 3, verdict: 0 });
    await ratedEntry({ userId, lat: 42.13, feelsLikeC: 3, verdict: 2 });

    const profile = await ownProfile(userId);
    const [band] = profile.coverage;

    expect(band).toMatchObject({ cold: 1, dialed: 1, warm: 1 });
  });

  it("ignores an entry with no verdict", async () => {
    const userId = await makeVerifiedUser();
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
    const userId = await makeVerifiedUser();
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
  it("counts wear across a history longer than D1 binds in one statement", async () => {
    // D1 refuses more than 100 bound parameters in one statement, and the
    // history is up to 200 entries: read as one list, a runner with more
    // than a hundred runs had no profile at all.
    const userId = await makeVerifiedUser();
    const shell = await makeItem({ userId, name: "Shell" });
    await makeObservation({
      lat: 47.11,
      lng: -93.27,
      startedAt: NOW,
      tempC: 5,
      feelsLikeC: 3,
    });
    for (let index = 0; index < 150; index += 1) {
      const runId = await makeRun({ userId, lat: 47.11, lng: -93.27 });
      await makeEntry({
        userId,
        runId,
        verdict: 0,
        itemIds: [shell],
        createdAt: NOW + index,
      });
    }

    const profile = await ownProfile(userId);

    expect(profile.mostWornItems).toStrictEqual([
      { itemId: shell, name: "Shell", wearCount: 150 },
    ]);
  });

  it("ranks items by how often they were worn", async () => {
    const userId = await makeVerifiedUser();
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
    const userId = await makeVerifiedUser();
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
    const me = await makeVerifiedUser();
    const follower = await makeVerifiedUser();
    const followed = await makeVerifiedUser();
    await follow(follower, me);
    await follow(me, followed);

    const profile = await ownProfile(me);

    expect(profile.followerCount).toBe(1);
    expect(profile.followingCount).toBe(1);
  });

  it("counts every run logged, with an entry or without, and only this runner's", async () => {
    // G's first count (round 22). A run nobody has dressed yet is still a
    // run — counting entries would call a runner with a backlog new.
    const me = await makeVerifiedUser();
    await makeRun({ userId: me });
    const dressed = await makeRun({ userId: me });
    await makeEntry({ userId: me, runId: dressed });
    await makeRun({ userId: await makeVerifiedUser() });

    const profile = await ownProfile(me);

    expect(profile.runCount).toBe(2);
    expect(profile.entryCount).toBe(1);
  });

  it("counts no runs on day one", async () => {
    const profile = await ownProfile(await makeVerifiedUser());
    expect(profile.runCount).toBe(0);
  });

  it("counts runs and follows in SQL, never reading the rows it counts", async () => {
    // PR #102 review: the run count read every run id to take `.length`,
    // and the follow counts did the same with every follower id — a
    // runner with a few thousand runs shipped all of them on each view.
    const me = await makeVerifiedUser();
    await makeRun({ userId: me });
    await follow(await makeVerifiedUser(), me);
    const prepare = vi.spyOn(env.DIALED_CORE, "prepare");

    const profile = await ownProfile(me);

    const statements = prepare.mock.calls.map(([sql]) => sql);
    prepare.mockRestore();
    expect(profile.runCount).toBe(1);
    expect(profile.followerCount).toBe(1);
    expect(statements).toContain(
      'select count(*) from "runs" where "runs"."user_id" = ?',
    );
    expect(statements).toContain(
      'select count(*) from "follows" where "follows"."followee_id" = ?',
    );
    expect(statements).toContain(
      'select count(*) from "follows" where "follows"."follower_id" = ?',
    );
    expect(statements.join("\n")).not.toMatch(
      /select "(?:id|follower_id|followee_id)" from "(?:runs|follows)"/u,
    );
  });
});

describe("otherProfile", () => {
  it("answers with nothing for a runner who has no profile", async () => {
    expect(
      await otherProfile("01JNOBODY000000000000000", await makeVerifiedUser()),
    ).toBeUndefined();
  });

  it("shows public entries and hides private ones", async () => {
    // The privacy boundary. A private entry never appears in feeds or on
    // anyone else's screen.
    const userId = await makeVerifiedUser({ username: "Public runner" });
    const shown = await ratedEntry({
      userId,
      lat: 47.11,
      feelsLikeC: 3,
      verdict: 0,
      audience: "runners",
    });
    await ratedEntry({
      userId,
      lat: 47.12,
      feelsLikeC: 3,
      verdict: 0,
      audience: "private",
    });

    const profile = await otherProfile(userId, await makeVerifiedUser());

    expect(profile?.username).toBe("Public runner");
    expect(
      profile?.recentPublicEntries.map((entry) => entry.entryId),
    ).toStrictEqual([shown]);
  });

  it("shows the newest entries first", async () => {
    const userId = await makeVerifiedUser();
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

    const profile = await otherProfile(userId, await makeVerifiedUser());

    expect(
      profile?.recentPublicEntries.map((entry) => entry.entryId),
    ).toStrictEqual([newer, older]);
  });

  it("carries the verdict and not the caption the row still holds (D-167), and nothing aggregated", async () => {
    const userId = await makeVerifiedUser();
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

    const profile = await otherProfile(userId, await makeVerifiedUser());

    expect(profile?.recentPublicEntries[0]).toStrictEqual({
      entryId,
      // No zone anywhere: the run's day in UTC.
      day: "Thu Sep 4",
      verdict: -1,
    });
    expect(Object.hasOwn(profile ?? {}, "coverage")).toBe(false);
  });

  it("dates each run where it was run: its observation's zone, else the runner's own place's (R-96)", async () => {
    const userId = await makeVerifiedUser();
    await db()
      .update(userProfiles)
      .set({ timeZone: "Asia/Tokyo" })
      .where(eq(userProfiles.userId, userId));
    // 03:30 UTC on Sep 4: Thu in Tokyo, still Wed in Chicago, where it ran.
    const observedAt = Date.UTC(2025, 8, 4, 3, 30) / 1000;
    const observedRun = await makeRun({
      userId,
      lat: 41.88,
      lng: -87.63,
      startedAt: observedAt,
    });
    await makeObservation({
      lat: 41.88,
      lng: -87.63,
      startedAt: observedAt,
      tempC: 10,
      feelsLikeC: 8,
      timeZone: "America/Chicago",
    });
    const observed = await makeEntry({
      userId,
      runId: observedRun,
      verdict: 0,
      createdAt: observedAt,
      audience: "runners",
    });
    // 20:30 UTC on Sep 4, no observation: already Fri in Tokyo.
    const unobservedAt = Date.UTC(2025, 8, 4, 20, 30) / 1000;
    const unobserved = await makeEntry({
      userId,
      runId: await makeRun({ userId, lat: 35.68, startedAt: unobservedAt }),
      verdict: 0,
      createdAt: unobservedAt,
      audience: "runners",
    });

    const profile = await otherProfile(userId, await makeVerifiedUser());

    expect(
      profile?.recentPublicEntries.map(({ entryId, day }) => ({
        entryId,
        day,
      })),
    ).toStrictEqual([
      { entryId: unobserved, day: "Fri Sep 5" },
      { entryId: observed, day: "Wed Sep 3" },
    ]);
  });

  it("shows the city label a runner chose to publish", async () => {
    const userId = await makeVerifiedUser();
    await db()
      .update(userProfiles)
      .set({ cityLabel: "Minneapolis" })
      .where(eq(userProfiles.userId, userId));

    const profile = await otherProfile(userId, await makeVerifiedUser());
    expect(profile?.cityLabel).toBe("Minneapolis");
  });
});

describe("ownProfile: what it leaves out", () => {
  it("skips an entry whose conditions were never resolved", async () => {
    // A rated run with no observation cannot be placed in a band. Reading
    // one anyway is a crash on the profile screen.
    const userId = await makeVerifiedUser();
    const runId = await makeRun({ userId, lat: 51.11, lng: -93.27 });
    await makeEntry({ userId, runId, verdict: 0 });

    const profile = await ownProfile(userId);

    expect(profile.entryCount).toBe(1);
    expect(profile.coverage).toStrictEqual([]);
  });

  it("labels a band in Fahrenheit", async () => {
    // The profile is the runner's own record and reads in their units; an
    // unlabelled band is a bar with no axis.
    const userId = await makeVerifiedUser();
    await ratedEntry({ userId, lat: 52.11, feelsLikeC: 0, verdict: 0 });

    const profile = await ownProfile(userId);
    const [band] = profile.coverage;

    expect(band?.label).toMatch(/^-?\d+–-?\d+°$/);
  });

  it("reports an unset city and thermal level as unset, not as null", async () => {
    // These reach a component that renders "—" for `undefined`; `null`
    // renders as the word.
    const userId = await makeVerifiedUser();

    const profile = await ownProfile(userId);

    expect(profile.cityLabel).toBeUndefined();
    expect(profile.thermalLevel).toBeUndefined();
  });

  it("shows the most recent twenty entries, newest first", async () => {
    const userId = await makeVerifiedUser();
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
    expect(profile.recentEntries[0]).toMatchObject({ createdAt: NOW });
  });

  it("names each recent entry's run: its day, distance and conditions (round 35 #53b)", async () => {
    const userId = await makeVerifiedUser();
    const outdoors = await ratedEntry({
      userId,
      lat: 54.4,
      feelsLikeC: 3,
      verdict: 0,
      createdAt: NOW,
    });
    // 02:00 UTC on Fri 5 Sep is still Thu 4 Sep in the runner's zone, and
    // an indoor run has no observation to date it by.
    const lateStart = 1_757_037_600;
    const indoorRun = await makeRun({ userId, startedAt: lateStart });
    await db()
      .update(runs)
      .set({ indoor: true, distanceM: 8046.72 })
      .where(eq(runs.id, indoorRun));
    const indoors = await makeEntry({
      userId,
      runId: indoorRun,
      verdict: 0,
      createdAt: NOW - DAY,
      itemIds: [],
      audience: "runners",
    });
    await db()
      .update(userProfiles)
      .set({ timeZone: "America/Chicago" })
      .where(eq(userProfiles.userId, userId));

    const profile = await ownProfile(userId);

    expect(profile.units).toEqual({ temp: "f", distance: "mi" });
    const [first, second] = profile.recentEntries;
    expect(first).toMatchObject({
      entryId: outdoors,
      day: "Thu, Sep 4",
      distanceM: 5000,
      indoor: false,
      conditions: { feelsLikeC: 3, tempC: 5, condition: "clear" },
    });
    expect(second).toMatchObject({
      entryId: indoors,
      day: "Thu, Sep 4",
      distanceM: 8046.72,
      indoor: true,
    });
    expect(second?.conditions).toBeUndefined();
  });

  it("dates a recent entry in UTC for a runner with no profile row", async () => {
    // Nothing creates a profile row at signup (contracts §users).
    const userId = await makeVerifiedUser();
    const indoorRun = await makeRun({ userId, startedAt: 1_757_037_600 });
    await makeEntry({
      userId,
      runId: indoorRun,
      verdict: 0,
      createdAt: NOW,
      itemIds: [],
      audience: "runners",
    });
    await db().delete(userProfiles).where(eq(userProfiles.userId, userId));

    const profile = await ownProfile(userId);

    expect(profile.recentEntries[0]?.day).toBe("Fri, Sep 5");
  });

  it("marks a recent entry reports have hidden, and only that one (round 28 #6)", async () => {
    const userId = await makeVerifiedUser();
    const hidden = await ratedEntry({
      userId,
      lat: 54.1,
      feelsLikeC: 3,
      verdict: 0,
      createdAt: NOW,
    });
    const removed = await ratedEntry({
      userId,
      lat: 54.2,
      feelsLikeC: 3,
      verdict: 0,
      createdAt: NOW - DAY,
    });
    await ratedEntry({
      userId,
      lat: 54.3,
      feelsLikeC: 3,
      verdict: 0,
      createdAt: NOW - 2 * DAY,
    });
    await db()
      .update(outfitEntries)
      .set({ moderationStatus: "hidden_pending_review" })
      .where(eq(outfitEntries.id, hidden));
    await db()
      .update(outfitEntries)
      .set({ moderationStatus: "removed" })
      .where(eq(outfitEntries.id, removed));

    const profile = await ownProfile(userId);

    expect(profile.recentEntries.map((entry) => entry.underReview)).toEqual([
      true,
      false,
      false,
    ]);
  });
});
