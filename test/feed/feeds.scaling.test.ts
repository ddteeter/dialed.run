import { describe, expect, it } from "vitest";

import { entryPhotos, entryTags, reactions } from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import {
  unjudgedRunCount,
  verdictBacklog,
} from "../../src/modules/feed/backlog";
import { followingFeed } from "../../src/modules/feed/feed";
import { follow } from "../../src/modules/feed/follows";
import { ownProfile, profileAtHandle } from "../../src/modules/feed/profiles";
import { searchRunners } from "../../src/modules/feed/search";
import {
  core,
  expectFlat,
  locatedEntry,
  measured,
  STARTED,
} from "./feed-scaling";
import { makeItem, makeRun, makeUser, makeVerifiedUser, NOW } from "./helpers";
import { observationWalk, PLACE, seedObservation } from "./scaling-fixture";

/**
 * Design 182: the feed module's list reads, each seeded with one row and
 * then twenty-five of what it lists. The statement count stays the same;
 * rows read may grow. Where the weather side grows, it grows by
 * `observationWalk`'s chunks, never per row.
 */

/**
The page sizes the reads cap at: `PAGE_SIZE` (feed.ts:49), `RECENT_LIMIT` (profiles.ts:41), `RESULT_LIMIT` (search.ts:26).
*/
const PAGE = 20;

/**
A followee's `size` entries, each with a garment, a tag, a photo and a Useful.
*/
async function seedFollowedEntries(size: number) {
  const viewer = await makeUser();
  const author = await makeUser();
  const reactor = await makeUser();
  await follow(viewer, author);
  await seedObservation();
  for (let index = 0; index < size; index += 1) {
    const itemId = await makeItem({ userId: author });
    const entryId = await locatedEntry({
      userId: author,
      index,
      itemIds: [itemId],
    });
    await core().insert(entryTags).values({ entryId, tag: "tempo" });
    await core().insert(reactions).values({
      entryId,
      userId: reactor,
      createdAt: NOW,
    });
    await core()
      .insert(entryPhotos)
      .values({
        id: newUlid(),
        entryId,
        photoKey: `photos/${entryId}/0.jpg`,
        position: 0,
        screenStatus: "pass",
      });
  }
  return () => followingFeed(viewer);
}

async function seedOwnHistory(size: number) {
  const userId = await makeVerifiedUser();
  const itemId = await makeItem({ userId });
  await seedObservation();
  for (let index = 0; index < size; index += 1) {
    await locatedEntry({ userId, index, itemIds: [itemId] });
  }
  return () => ownProfile(userId);
}

async function seedPublicEntries(size: number) {
  const viewer = await makeVerifiedUser();
  const handle = `h_${newUlid().slice(-8).toLowerCase()}`;
  const runner = await makeVerifiedUser({ username: handle });
  await seedObservation();
  for (let index = 0; index < size; index += 1) {
    await locatedEntry({ userId: runner, index });
  }
  return () => profileAtHandle(viewer, handle);
}

async function seedMatchingRunners(size: number) {
  const viewer = await makeVerifiedUser();
  for (let index = 0; index < size; index += 1) {
    const found = await makeVerifiedUser({
      username: `pacer_${String(index).padStart(2, "0")}`,
    });
    if (index % 2 === 0) await follow(viewer, found);
  }
  return () => searchRunners(viewer, "pacer");
}

/**
 * `size` runs with no entry, at the cell and hour of one judged entry
 * wearing one garment — so every row has conditions and a suggestion.
 */
async function seedBacklog(size: number) {
  const userId = await makeUser();
  const itemId = await makeItem({ userId });
  await seedObservation();
  await locatedEntry({ userId, index: 0, itemIds: [itemId] });
  for (let index = 0; index < size; index += 1) {
    await makeRun({ userId, ...PLACE, startedAt: STARTED, durationS: 60 });
  }
  return userId;
}

async function backlogOf(size: number) {
  const userId = await seedBacklog(size);
  return () => verdictBacklog(userId);
}

async function countOf(size: number) {
  const userId = await seedBacklog(size);
  return () => unjudgedRunCount(userId);
}

describe("followingFeed scales by page, not by entry", () => {
  it("asks the same of core and weather for one entry as for a full page", async () => {
    const one = await measured(1, seedFollowedEntries);
    const many = await measured(25, seedFollowedEntries);

    expect(one.result.items).toHaveLength(1);
    expect(many.result.items).toHaveLength(PAGE);
    // Every card was hydrated, weather included.
    for (const item of many.result.items) {
      expect(item.itemNames).toHaveLength(1);
      expect(item.tags).toStrictEqual(["tempo"]);
      expect(item.photoKeys).toHaveLength(1);
      expect(item.usefulCount).toBe(1);
      expect(item.conditions).toBeDefined();
    }
    expectFlat(one.counts, many.counts);
    // A page of twenty runs is one chunk of cells and one of bands.
    expect(many.counts.weather).toBe(observationWalk(PAGE).weather);
  });
});

describe("ownProfile walks its history in chunks", () => {
  it("asks core the same, and weather only by the observation walk's chunks", async () => {
    const one = await measured(1, seedOwnHistory);
    const many = await measured(25, seedOwnHistory);

    expect(one.result.entryCount).toBe(1);
    expect(many.result.entryCount).toBe(25);
    expect(many.result.recentEntries).toHaveLength(PAGE);
    expect(many.result.mostWornItems[0]?.wearCount).toBe(25);
    // Core: the history's runs and garments are read in `IN_LIST_CHUNK`
    // (src/lib/chunked.ts) chunks, one chunk for anything up to 80 — the
    // same statements for one entry as for twenty-five.
    expect(many.counts.core).toBe(one.counts.core);
    expect(many.counts.coreRowsRead).toBeGreaterThan(one.counts.coreRowsRead);
    // Weather: coverage needs every entry's conditions, so the cells grow
    // twenty to a statement (`observationWalk`, scaling-fixture.ts).
    expect(one.counts.weather).toBe(observationWalk(1).weather);
    expect(many.counts.weather).toBe(observationWalk(25).weather);
  });
});

describe("profileAtHandle (H) reads a capped page of public entries", () => {
  it("asks the same of core and weather for one entry as for twenty-five", async () => {
    const one = await measured(1, seedPublicEntries);
    const many = await measured(25, seedPublicEntries);

    if (one.result.kind !== "runner" || many.result.kind !== "runner") {
      throw new Error("the runner should be visible");
    }
    expect(one.result.profile.recentPublicEntries).toHaveLength(1);
    expect(many.result.profile.recentPublicEntries).toHaveLength(PAGE);
    expectFlat(one.counts, many.counts);
  });
});

describe("searchRunners", () => {
  it("asks the same for one match as for a full page of them", async () => {
    const one = await measured(1, seedMatchingRunners);
    const many = await measured(25, seedMatchingRunners);

    expect(one.result).toHaveLength(1);
    expect(many.result).toHaveLength(PAGE);
    expect(many.result.filter((row) => row.following)).toHaveLength(PAGE / 2);
    expectFlat(one.counts, many.counts);
    expect(many.counts.weather).toBe(0);
  });
});

describe("the verdict backlog", () => {
  it("verdictBacklog asks core the same, and weather only by the walk's chunks", async () => {
    const one = await measured(1, backlogOf);
    const many = await measured(25, backlogOf);

    expect(one.result.rows).toHaveLength(1);
    expect(many.result.rows).toHaveLength(25);
    for (const row of [...one.result.rows, ...many.result.rows]) {
      expect(row.conditions).toBeDefined();
      expect(row.suggestion?.itemNames).toHaveLength(1);
    }
    expect(many.counts.core).toBe(one.counts.core);
    expect(many.counts.coreRowsRead).toBeGreaterThan(one.counts.coreRowsRead);
    // Weather: the rows' conditions (`observationsForRuns`, backlog.ts:228)
    // walk the cells twenty to a statement, and the one-entry history's
    // walk is constant.
    const history = observationWalk(1).weather;
    expect(one.counts.weather).toBe(observationWalk(1).weather + history);
    expect(many.counts.weather).toBe(observationWalk(25).weather + history);
  });

  it("unjudgedRunCount is one read however many runs wait", async () => {
    const one = await measured(1, countOf);
    const many = await measured(25, countOf);

    expect(one.result).toBe(1);
    expect(many.result).toBe(25);
    expectFlat(one.counts, many.counts);
    expect(many.counts.weather).toBe(0);
  });
});

/**
 * #507: rows the read must not return cost it nothing. Each world holds
 * one row the read shows and `noise` rows it must not; the rows read are
 * the same for 1 of them as for 25. (One, not none: a range seek reads
 * the row just past its range, so an empty neighbourhood reads one fewer
 * for a reason that has nothing to do with scaling.)
 */
function followedBeside(noise: "strangers" | "private") {
  return async (count: number) => {
    const viewer = await makeUser();
    const author = await makeUser();
    await follow(viewer, author);
    await seedObservation();
    await locatedEntry({ userId: author, index: 0 });
    for (let index = 1; index <= count; index += 1) {
      await locatedEntry(
        noise === "strangers"
          ? { userId: await makeUser(), index }
          : { userId: author, index, audience: "private" },
      );
    }
    return () => followingFeed(viewer);
  };
}

async function oneHandleBeside(count: number) {
  const viewer = await makeVerifiedUser();
  await makeVerifiedUser({ username: "pacer_00" });
  for (let index = 0; index < count; index += 1) {
    await makeVerifiedUser({
      username: `zulu_${String(index).padStart(2, "0")}`,
    });
  }
  return () => searchRunners(viewer, "pacer");
}

describe("the feed's reads beside rows they must not return (#507)", () => {
  it("followingFeed reads no more for 25 strangers' shared entries", async () => {
    const one = await measured(1, followedBeside("strangers"));
    const many = await measured(25, followedBeside("strangers"));
    expect(many.result.items).toHaveLength(1);
    expect(many.counts.coreRowsRead).toBe(one.counts.coreRowsRead);
    expect(many.counts.weatherRowsRead).toBe(one.counts.weatherRowsRead);
  });

  it("followingFeed reads no more for 25 of a followee's private entries", async () => {
    const one = await measured(1, followedBeside("private"));
    const many = await measured(25, followedBeside("private"));
    expect(many.result.items).toHaveLength(1);
    expect(many.counts.coreRowsRead).toBe(one.counts.coreRowsRead);
    expect(many.counts.weatherRowsRead).toBe(one.counts.weatherRowsRead);
  });

  it("searchRunners reads no more for 25 handles that do not match", async () => {
    const one = await measured(1, oneHandleBeside);
    const many = await measured(25, oneHandleBeside);
    expect(many.result).toHaveLength(1);
    expect(many.counts.coreRowsRead).toBe(one.counts.coreRowsRead);
  });
});
