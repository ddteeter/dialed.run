import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { env } from "../../src/env";
import {
  followingFeed,
  followingFeedStatement,
} from "../../src/modules/feed/feed";
import { follow } from "../../src/modules/feed/follows";
import { makeEntry, makeRun, makeUser, NOW } from "./helpers";

describe("following feed (E1)", () => {
  it("shows a followee's public entries, self's own, and never a non-follow's", async () => {
    const viewer = await makeUser();
    const followee = await makeUser();
    const stranger = await makeUser();
    await follow(viewer, followee);

    const ownRun = await makeRun({ userId: viewer });
    const followeeRun = await makeRun({ userId: followee });
    const strangerRun = await makeRun({ userId: stranger });

    const ownEntry = await makeEntry({
      userId: viewer,
      runId: ownRun,
      createdAt: NOW,
    });
    const followeeEntry = await makeEntry({
      userId: followee,
      runId: followeeRun,
      createdAt: NOW + 1,
    });
    await makeEntry({
      userId: stranger,
      runId: strangerRun,
      createdAt: NOW + 2,
    });

    const page = await followingFeed(viewer);
    const entryIds = page.items.map((item) => item.entryId);
    expect(entryIds).toEqual(expect.arrayContaining([ownEntry, followeeEntry]));
    expect(entryIds).toHaveLength(2);
  });

  it("keeps the cursor stable across inserts made between pages", async () => {
    const viewer = await makeUser();
    // outfit_entries.run_id is UNIQUE (at most one entry per run) — each
    // entry needs its own run.
    const olderRun = await makeRun({ userId: viewer });
    const middleRun = await makeRun({ userId: viewer });
    const newestRun = await makeRun({ userId: viewer });
    const laterRun = await makeRun({ userId: viewer });
    const older = await makeEntry({
      userId: viewer,
      runId: olderRun,
      createdAt: NOW,
    });
    const middle = await makeEntry({
      userId: viewer,
      runId: middleRun,
      createdAt: NOW + 10,
    });
    const newest = await makeEntry({
      userId: viewer,
      runId: newestRun,
      createdAt: NOW + 20,
    });

    const firstPage = await followingFeed(viewer, undefined, 2);
    expect(firstPage.items.map((i) => i.entryId)).toEqual([newest, middle]);
    expect(firstPage.nextCursor).toBeDefined();

    // Insert a brand-new entry "between" pages — the cursor is keyed off
    // the last row already seen, so it must not reappear or shift the rest.
    const insertedLater = await makeEntry({
      userId: viewer,
      runId: laterRun,
      createdAt: NOW + 30,
    });

    const secondPage = await followingFeed(viewer, firstPage.nextCursor, 2);
    expect(secondPage.items.map((i) => i.entryId)).toEqual([older]);
    expect(secondPage.items.map((i) => i.entryId)).not.toContain(insertedLater);
    expect(secondPage.items.map((i) => i.entryId)).not.toContain(middle);
    expect(secondPage.nextCursor).toBeUndefined();
  });

  it("pages a viewer who follows 150 runners, newest first, by cursor (D-101)", async () => {
    const viewer = await makeUser();
    const followees: string[] = [];
    for (let index = 0; index < 150; index += 1) {
      const followee = await makeUser();
      await follow(viewer, followee);
      followees.push(followee);
    }
    // One entry each from the first, the last and a middle follow — the
    // last is one a bound list would have put past D1's cap — plus the
    // viewer's own.
    const posters = [followees[0], followees[149], followees[92], viewer];
    const posted: string[] = [];
    for (const [offset, userId] of posters.entries()) {
      if (userId === undefined) throw new Error("no poster");
      const runId = await makeRun({ userId });
      posted.push(await makeEntry({ userId, runId, createdAt: NOW + offset }));
    }
    const newestFirst = posted.toReversed();

    const first = await followingFeed(viewer, undefined, 3);
    expect(first.items.map((item) => item.entryId)).toEqual(
      newestFirst.slice(0, 3),
    );
    expect(first.followeeCount).toBe(150);
    const second = await followingFeed(viewer, first.nextCursor, 3);
    expect(second.items.map((item) => item.entryId)).toEqual(
      newestFirst.slice(3),
    );
    expect(second.nextCursor).toBeUndefined();
  });

  it("binds the viewer once however many they follow, and keeps its index seeks", async () => {
    const viewer = await makeUser();
    for (let index = 0; index < 120; index += 1) {
      await follow(viewer, await makeUser());
    }

    const statement = followingFeedStatement(
      drizzle(env.DIALED_CORE),
      viewer,
      { createdAt: NOW, id: "01ZZZZZZZZZZZZZZZZZZZZZZZZ" },
    );
    const { sql, params } = statement.toSQL();
    // The viewer twice (own entries, and the follows lookup), the two
    // visibility values, the three cursor values and the limit: eight, at
    // one follow or a thousand.
    expect(params).toHaveLength(8);
    const plan = await env.DIALED_CORE.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...params)
      .all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail).join("\n");
    expect(details).toMatch(
      /SEARCH outfit_entries USING INDEX entries_public_created/u,
    );
    expect(details).toMatch(
      /SEARCH follows USING COVERING INDEX follows_pk \(follower_id=\?\)/u,
    );
    expect(details).not.toMatch(/SCAN\s+outfit_entries/iu);
    expect(details).not.toMatch(/SCAN\s+follows/iu);
  });
});
