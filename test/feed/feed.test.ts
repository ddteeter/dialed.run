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

  it("pages through entries made in the same instant, by id", async () => {
    const viewer = await makeUser();
    const tied: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const runId = await makeRun({ userId: viewer });
      tied.push(await makeEntry({ userId: viewer, runId, createdAt: NOW }));
    }
    const byIdDescending = tied.toSorted((a, b) => b.localeCompare(a));

    const first = await followingFeed(viewer, undefined, 2);
    expect(first.items.map((item) => item.entryId)).toEqual(
      byIdDescending.slice(0, 2),
    );
    const second = await followingFeed(viewer, first.nextCursor, 2);
    expect(second.items.map((item) => item.entryId)).toEqual(
      byIdDescending.slice(2),
    );
  });

  it("reads each author only to a page, and loses nothing by it", async () => {
    // One prolific followee whose whole page is newer than the quiet one's
    // only entry, then the quiet one's entry must still lead page two.
    const viewer = await makeUser();
    const prolific = await makeUser();
    const quiet = await makeUser();
    await follow(viewer, prolific);
    await follow(viewer, quiet);
    const prolificEntries: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const runId = await makeRun({ userId: prolific });
      prolificEntries.push(
        await makeEntry({
          userId: prolific,
          runId,
          createdAt: NOW + 10 + 2 * index,
        }),
      );
    }
    const quietEntry = await makeEntry({
      userId: quiet,
      runId: await makeRun({ userId: quiet }),
      createdAt: NOW + 13,
    });
    const newestFirst = [
      prolificEntries[3],
      prolificEntries[2],
      quietEntry,
      prolificEntries[1],
      prolificEntries[0],
    ];

    const first = await followingFeed(viewer, undefined, 2);
    expect(first.items.map((item) => item.entryId)).toEqual(
      newestFirst.slice(0, 2),
    );
    const second = await followingFeed(viewer, first.nextCursor, 2);
    expect(second.items.map((item) => item.entryId)).toEqual(
      newestFirst.slice(2, 4),
    );
    const third = await followingFeed(viewer, second.nextCursor, 2);
    expect(third.items.map((item) => item.entryId)).toEqual(
      newestFirst.slice(4),
    );
    expect(third.nextCursor).toBeUndefined();
  });

  it("binds the viewer once however many they follow, and keeps its index seeks", async () => {
    const viewer = await makeUser();
    for (let index = 0; index < 120; index += 1) {
      await follow(viewer, await makeUser());
    }

    const statement = followingFeedStatement(drizzle(env.DIALED_CORE), viewer, {
      createdAt: NOW,
      id: "01ZZZZZZZZZZZZZZZZZZZZZZZZ",
    });
    const { sql, params } = statement.toSQL();
    // The viewer three times (the follows lookup, and their two own author
    // rows — D-67), `is_public` and the under-review arm's status, the two
    // visibility values, the viewer three more times for the viewer rule
    // (a block from either end, and their own reports — SAF-12/13), the
    // three cursor values and the limit twice (per author, and the page):
    // fifteen, at one follow or a thousand.
    expect(params).toHaveLength(15);
    // The followees arm's status discriminator: raw `'ok'` aliased to
    // `"status"` so the outer `eq(outfitEntries.moderationStatus,
    // authors.status)` can name it. Every later reference to `authors.status`
    // is drawn from this exact aliased object (drizzle's selection proxy
    // resolves by object identity, not by re-deriving a name), so renaming or
    // blanking either string here is invisible to a query-*result* test — the
    // definition and every reference rename together and the statement stays
    // internally consistent. Pinning the emitted text is what makes this
    // literal line's shape a checked part of the contract, per this file's
    // own note that `followingFeedStatement` exists so tests can inspect what
    // it builds.
    expect(sql).toMatch(/'ok' as "status"/u);
    const plan = await env.DIALED_CORE.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...params)
      .all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail).join("\n");
    // Driven from the authors: the followees off `follows_pk`, the viewer
    // off their own user row, and each author's entries a seek on
    // `entries_user_public_created` that starts at the cursor. What it
    // scans is at most a page per author, never the site's entries.
    expect(details).toMatch(
      /SEARCH follows USING COVERING INDEX follows_pk \(follower_id=\?\)/u,
    );
    expect(details).toMatch(/SCAN CONSTANT ROW/u);
    expect(details).toMatch(
      /SEARCH outfit_entries USING INDEX entries_user_public_created \(user_id=\? AND is_public=\? AND moderation_status=\? AND created_at<\?\)/u,
    );
    expect(details).not.toMatch(/entries_public_created/u);
    expect(details).not.toMatch(/SCAN\s+(?:outfit_entries|page|follows)/iu);
  });
});
