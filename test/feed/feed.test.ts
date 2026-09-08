import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { followingFeed, followingFeedStatement } from "../../src/modules/feed/feed";
import { follow, followeeIdsOf } from "../../src/modules/feed/follows";
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

    const ownEntry = await makeEntry({ userId: viewer, runId: ownRun, createdAt: NOW });
    const followeeEntry = await makeEntry({
      userId: followee,
      runId: followeeRun,
      createdAt: NOW + 1,
    });
    await makeEntry({ userId: stranger, runId: strangerRun, createdAt: NOW + 2 });

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
    const older = await makeEntry({ userId: viewer, runId: olderRun, createdAt: NOW });
    const middle = await makeEntry({ userId: viewer, runId: middleRun, createdAt: NOW + 10 });
    const newest = await makeEntry({ userId: viewer, runId: newestRun, createdAt: NOW + 20 });

    const firstPage = await followingFeed(viewer, undefined, 2);
    expect(firstPage.items.map((i) => i.entryId)).toEqual([newest, middle]);
    expect(firstPage.nextCursor).toBeDefined();

    // Insert a brand-new entry "between" pages — the cursor is keyed off
    // the last row already seen, so it must not reappear or shift the rest.
    const insertedLater = await makeEntry({ userId: viewer, runId: laterRun, createdAt: NOW + 30 });

    const secondPage = await followingFeed(viewer, firstPage.nextCursor, 2);
    expect(secondPage.items.map((i) => i.entryId)).toEqual([older]);
    expect(secondPage.items.map((i) => i.entryId)).not.toContain(insertedLater);
    expect(secondPage.items.map((i) => i.entryId)).not.toContain(middle);
    expect(secondPage.nextCursor).toBeUndefined();
  });

  it("resolves the following feed with index seeks, no table scan", async () => {
    const viewer = await makeUser();
    const followee = await makeUser();
    await follow(viewer, followee);

    const database = drizzle(env.DIALED_CORE);
    const followeeIds = await followeeIdsOf(viewer);
    const entriesStatement = followingFeedStatement(database, [viewer, ...followeeIds], undefined);
    const { sql, params } = entriesStatement.toSQL();
    const plan = await env.DIALED_CORE.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...params)
      .all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail).join("\n");
    expect(details).not.toMatch(/SCAN\s+outfit_entries/i);
    expect(details).not.toMatch(/SCAN\s+follows/i);

    // The follows lookup itself (follower_id, followee_id) is index-backed too.
    const followsPlan = await env.DIALED_CORE.prepare(
      "EXPLAIN QUERY PLAN SELECT followee_id FROM follows WHERE follower_id = ?",
    )
      .bind(viewer)
      .all<{ detail: string }>();
    const followsDetails = followsPlan.results.map((row) => row.detail).join("\n");
    expect(followsDetails).not.toMatch(/SCAN\s+follows/i);
  });
});
