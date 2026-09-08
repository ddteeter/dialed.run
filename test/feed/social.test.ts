import { beforeEach, describe, expect, it } from "vitest";

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
    const entryId = await makeEntry({ userId: author, runId, isPublic: 1 });

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
