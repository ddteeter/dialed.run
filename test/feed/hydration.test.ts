import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";

import {
  entryPhotos,
  entryTags,
  outfitEntries,
  reactions,
  runs,
  userProfiles,
  wardrobeItems,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { followingFeed } from "../../src/modules/feed/feed";
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
 * What a feed card actually says.
 *
 * `feed.test.ts` proves the *scope* — whose entries appear, in what order,
 * with what query plan. Nothing checked what is on the card, and that is
 * where fifty-three mutants lived: every fallback could be swapped for
 * another, every per-entry filter could be widened to the whole page, and
 * the tests would still pass because they only counted rows.
 *
 * A widened filter is the one to keep in mind. `itemNames`, `photoKeys` and
 * `tags` are each filtered to their own entry out of one batched read; drop
 * the filter and every card in the feed shows every other card's kit.
 */

const DAY = 86_400;

function db() {
  return drizzle(env.DIALED_CORE);
}

/**
The empty value of a nullable column, parsed rather than written.
*/
function sqlNull(): string | null {
  return z.null().parse(JSON.parse("null"));
}

/**
A public entry of `userId`'s, with a resolved observation behind it.
*/
async function publicEntry(params: {
  userId: string;
  lat: number;
  createdAt?: number;
  itemIds?: string[];
  verdict?: number | undefined;
}): Promise<{ entryId: string; runId: string }> {
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
    tempC: 5,
    feelsLikeC: 3,
  });
  const entryId = await makeEntry({
    userId: params.userId,
    runId,
    createdAt: startedAt,
    itemIds: params.itemIds ?? [],
    ...(params.verdict !== undefined && { verdict: params.verdict }),
  });
  return { entryId, runId };
}

beforeEach(async () => {
  await resetTables();
});

describe("a feed card carries its own entry's detail", () => {
  it("keeps each entry's kit, photos and tags to itself", async () => {
    // The batched reads fetch the whole page at once and each card filters
    // its own rows back out. Widening any of those filters shows every
    // runner the contents of everyone else's kit.
    const userId = await makeUser();
    const mine = await makeItem({ userId, name: "My shirt" });
    const other = await makeItem({ userId, name: "Other shirt" });
    const first = await publicEntry({ userId, lat: 41.11, itemIds: [mine] });
    await publicEntry({
      userId,
      lat: 41.12,
      createdAt: NOW - DAY,
      itemIds: [other],
    });
    await db().insert(entryPhotos).values({
      id: newUlid(),
      entryId: first.entryId,
      photoKey: "entries/first/1",
      position: 0,
    });
    await db()
      .insert(entryTags)
      .values({ entryId: first.entryId, tag: "cold_first_mile" });

    const page = await followingFeed(userId);
    const [newest, older] = page.items;

    expect(newest?.itemNames).toStrictEqual(["My shirt"]);
    expect(newest?.photoKeys).toStrictEqual(["entries/first/1"]);
    expect(newest?.tags).toStrictEqual(["cold_first_mile"]);
    expect(older?.itemNames).toStrictEqual(["Other shirt"]);
    expect(older?.photoKeys).toStrictEqual([]);
    expect(older?.tags).toStrictEqual([]);
  });

  it("keeps photos in the order they were arranged", async () => {
    const userId = await makeUser();
    const { entryId } = await publicEntry({ userId, lat: 42.11 });
    for (const [position, key] of ["b", "a", "c"].entries()) {
      await db().insert(entryPhotos).values({
        id: newUlid(),
        entryId,
        photoKey: key,
        position,
      });
    }

    const page = await followingFeed(userId);

    expect(page.items[0]?.photoKeys).toStrictEqual(["b", "a", "c"]);
  });

  it("counts the usefuls on each entry separately", async () => {
    const userId = await makeUser();
    const reactor = await makeUser();
    const popular = await publicEntry({ userId, lat: 43.11 });
    await publicEntry({ userId, lat: 43.12, createdAt: NOW - DAY });
    await db().insert(reactions).values({
      entryId: popular.entryId,
      userId: reactor,
      createdAt: NOW,
    });

    const page = await followingFeed(userId);

    expect(page.items[0]?.usefulCount).toBe(1);
    expect(page.items[1]?.usefulCount).toBe(0);
  });

  it("carries the run's own title, distance and duration", async () => {
    const userId = await makeUser();
    const { entryId, runId } = await publicEntry({ userId, lat: 44.11 });
    await db()
      .update(runs)
      .set({ title: "Tempo", distanceM: 12_000, durationS: 3000 })
      .where(eq(runs.id, runId));

    const page = await followingFeed(userId);

    expect(page.items[0]).toMatchObject({
      entryId,
      runTitle: "Tempo",
      distanceM: 12_000,
      durationS: 3000,
      startedAt: NOW,
    });
  });

  it("carries the conditions the run was logged in", async () => {
    const userId = await makeUser();
    await publicEntry({ userId, lat: 45.11 });

    const page = await followingFeed(userId);

    expect(page.items[0]?.conditions).toMatchObject({
      tempC: 5,
      feelsLikeC: 3,
    });
  });

  it("names the author, and says nothing rather than null when they have not", async () => {
    const named = await makeUser({ displayName: "Dee" });
    await publicEntry({ userId: named, lat: 46.11 });

    const withName = await followingFeed(named);
    expect(withName.items[0]?.authorDisplayName).toBe("Dee");

    await db()
      .update(userProfiles)
      .set({ displayName: sqlNull() })
      .where(eq(userProfiles.userId, named));

    const without = await followingFeed(named);
    expect(without.items[0]?.authorDisplayName).toBeUndefined();
  });
});

describe("a feed card copes with what is missing", () => {
  it("says so when a garment has since been deleted", async () => {
    // Entries outlive garments. A blank name in the kit list is worse than
    // saying the piece is gone.
    const userId = await makeUser();
    const itemId = await makeItem({ userId, name: "Doomed shirt" });
    await publicEntry({ userId, lat: 47.11, itemIds: [itemId] });
    await db().delete(wardrobeItems).where(eq(wardrobeItems.id, itemId));

    const page = await followingFeed(userId);

    expect(page.items[0]?.itemNames).toStrictEqual(["[removed item]"]);
  });

  it("falls back to a named run when the run row is gone", async () => {
    const userId = await makeUser();
    const { runId } = await publicEntry({ userId, lat: 48.11 });
    await db().delete(runs).where(eq(runs.id, runId));

    const page = await followingFeed(userId);

    expect(page.items[0]).toMatchObject({
      runTitle: "Run",
      distanceM: 0,
      durationS: 0,
      startedAt: NOW,
    });
    expect(page.items[0]?.conditions).toBeUndefined();
  });

  it("reports an unrated entry as unrated, not as dialed", async () => {
    // Verdict 0 means "dialed". Turning a missing verdict into 0 would put
    // a badge on a card nobody rated.
    const userId = await makeUser();
    await publicEntry({ userId, lat: 49.11 });

    const page = await followingFeed(userId);

    expect(page.items[0]?.verdict).toBeUndefined();
  });

  it("keeps a real verdict of zero", async () => {
    const userId = await makeUser();
    await publicEntry({ userId, lat: 49.22, verdict: 0 });

    const page = await followingFeed(userId);

    expect(page.items[0]?.verdict).toBe(0);
  });

  it("reports a captionless entry as captionless", async () => {
    const userId = await makeUser();
    const { entryId } = await publicEntry({ userId, lat: 50.11 });
    await db()
      .update(outfitEntries)
      .set({ caption: "Windy out" })
      .where(eq(outfitEntries.id, entryId));

    const withCaption = await followingFeed(userId);
    expect(withCaption.items[0]?.caption).toBe("Windy out");

    await db()
      .update(outfitEntries)
      .set({ caption: sqlNull() })
      .where(eq(outfitEntries.id, entryId));

    const without = await followingFeed(userId);
    expect(without.items[0]?.caption).toBeUndefined();
  });

  it("answers an empty feed without asking for detail about nothing", async () => {
    const page = await followingFeed(await makeUser());
    expect(page).toStrictEqual({ items: [], nextCursor: undefined });
  });
});

describe("paging", () => {
  it("takes the last entry of the page as the cursor, not the first", async () => {
    // `page.at(-1)`: a cursor built from the *first* row re-serves the page
    // it just sent, and the feed loops forever.
    // A page of three, so "the last one" and "the second one" are
    // different rows — with a page of two they are the same and the
    // mistake hides.
    const userId = await makeUser();
    for (let index = 0; index < 4; index += 1) {
      await publicEntry({
        userId,
        lat: 55 + index / 100,
        createdAt: NOW - index * DAY,
      });
    }

    const firstPage = await followingFeed(userId, undefined, 3);
    const secondPage = await followingFeed(userId, firstPage.nextCursor, 3);

    const firstIds = firstPage.items.map((item) => item.entryId);
    const secondIds = secondPage.items.map((item) => item.entryId);
    expect(firstIds).toHaveLength(3);
    expect(secondIds).toHaveLength(1);
    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
  });

  it("offers no cursor when the last page is exactly full", async () => {
    // `rows.length > limit`, not `>=`: the query asks for one more than the
    // page, so equality means there was nothing extra to find.
    const userId = await makeUser();
    for (let index = 0; index < 2; index += 1) {
      await publicEntry({
        userId,
        lat: 56 + index / 100,
        createdAt: NOW - index * DAY,
      });
    }

    const page = await followingFeed(userId, undefined, 2);

    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeUndefined();
  });

  it("offers a cursor only when there is another page", async () => {
    const userId = await makeUser();
    for (let index = 0; index < 3; index += 1) {
      await publicEntry({
        userId,
        lat: 51 + index / 100,
        createdAt: NOW - index * DAY,
      });
    }

    const full = await followingFeed(userId, undefined, 10);
    expect(full.nextCursor).toBeUndefined();

    const firstPage = await followingFeed(userId, undefined, 2);
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).toMatchObject({ createdAt: NOW - DAY });

    const secondPage = await followingFeed(userId, firstPage.nextCursor, 2);
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.nextCursor).toBeUndefined();
  });
});
