import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { reactions as reactionsTable } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";

import { follow, followeeIdsOf, isFollowing, unfollow } from "../../src/modules/feed/follows";
import { hasReacted, toggleUsefulReaction, usefulCount } from "../../src/modules/feed/reactions";
import { searchByDisplayName } from "../../src/modules/feed/search";
import { makeEntry, makeRun, makeUser, resetTables } from "./helpers";

describe("useful reactions (D-11)", () => {
  beforeEach(resetTables);

  it("toggles on then off, and the count follows", async () => {
    const author = await makeUser();
    const reactor = await makeUser();
    const runId = await makeRun({ userId: author });
    const entryId = await makeEntry({ userId: author, runId, isPublic: true });

    expect(await usefulCount(entryId)).toBe(0);
    expect(await toggleUsefulReaction(entryId, reactor)).toEqual({ useful: true });
    expect(await usefulCount(entryId)).toBe(1);
    expect(await hasReacted(entryId, reactor)).toBe(true);

    expect(await toggleUsefulReaction(entryId, reactor)).toEqual({ useful: false });
    expect(await usefulCount(entryId)).toBe(0);
    expect(await hasReacted(entryId, reactor)).toBe(false);
  });
});

describe("follows", () => {
  beforeEach(resetTables);

  it("follows and unfollows", async () => {
    const follower = await makeUser();
    const followee = await makeUser();

    expect(await isFollowing(follower, followee)).toBe(false);
    await follow(follower, followee);
    expect(await isFollowing(follower, followee)).toBe(true);
    expect(await followeeIdsOf(follower)).toEqual([followee]);

    await unfollow(follower, followee);
    expect(await isFollowing(follower, followee)).toBe(false);
    expect(await followeeIdsOf(follower)).toEqual([]);
  });

  it("is idempotent under a repeated follow (queue-redelivery-safe)", async () => {
    const follower = await makeUser();
    const followee = await makeUser();

    await follow(follower, followee);
    await follow(follower, followee);
    expect(await followeeIdsOf(follower)).toEqual([followee]);
  });
});

describe("username search", () => {
  beforeEach(resetTables);

  it("prefix-matches display names (public profiles only, per MVP)", async () => {
    await makeUser({ displayName: "Ana Runner" });
    await makeUser({ displayName: "Andy Trails" });
    await makeUser({ displayName: "Beth Miles" });

    const results = await searchByDisplayName("An");
    expect(results.map((r) => r.displayName)).toEqual(
      expect.arrayContaining(["Ana Runner", "Andy Trails"]),
    );
    expect(results).toHaveLength(2);

    expect(await searchByDisplayName("Beth")).toHaveLength(1);
    expect(await searchByDisplayName("zzz")).toHaveLength(0);
  });
});

describe("useful reactions: who may react", () => {
  beforeEach(resetTables);

  it("refuses a reaction to an entry that does not exist, and says why", async () => {
    await expect(
      toggleUsefulReaction(newUlid(), await makeUser()),
    ).rejects.toThrow(/not visible/);
  });

  it("refuses a stranger's reaction to a private entry", async () => {
    // Private entries never appear in feeds; reacting to one by id is the
    // way around that, and this is what closes it.
    const owner = await makeUser();
    const stranger = await makeUser();
    const runId = await makeRun({ userId: owner });
    const entryId = await makeEntry({ userId: owner, runId, isPublic: false });

    await expect(toggleUsefulReaction(entryId, stranger)).rejects.toThrow(
      /not visible/,
    );
  });

  it("lets the owner react to their own private entry", async () => {
    const owner = await makeUser();
    const runId = await makeRun({ userId: owner });
    const entryId = await makeEntry({ userId: owner, runId, isPublic: false });

    expect(await toggleUsefulReaction(entryId, owner)).toStrictEqual({
      useful: true,
    });
  });

  it("stamps the reaction as useful, in epoch seconds", async () => {
    // `kind` is what a second reaction type would be told apart by, and
    // the timestamp is what any later ordering reads.
    const owner = await makeUser();
    const reactor = await makeUser();
    const runId = await makeRun({ userId: owner });
    const entryId = await makeEntry({ userId: owner, runId, isPublic: true });
    const before = Math.floor(Date.now() / 1000);

    await toggleUsefulReaction(entryId, reactor);

    const [row] = await drizzle(env.DIALED_CORE)
      .select()
      .from(reactionsTable)
      .where(eq(reactionsTable.entryId, entryId));
    expect(row?.kind).toBe("useful");
    expect(row?.createdAt).toBeGreaterThanOrEqual(before - 5);
    expect(row?.createdAt).toBeLessThanOrEqual(before + 5);
  });
});
