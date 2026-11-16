import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import {
  accountDeletions,
  follows as followsTable,
  reactions as reactionsTable,
  userProfiles,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";

import {
  follow,
  followerCount,
  followingCount,
  isFollowing,
  unfollow,
} from "../../src/modules/feed/follows";
import {
  hasReacted,
  setUsefulReaction,
  usefulCount,
} from "../../src/modules/feed/reactions";
import { searchRunners } from "../../src/modules/feed/search";
import { blockRunner } from "../../src/modules/safety";
import {
  makeEntry,
  makeRun,
  makeUser,
  makeVerifiedUser,
  resetTables,
} from "./helpers";
import { nowSeconds } from "../../src/lib/now";

function core() {
  return drizzle(env.DIALED_CORE);
}

/**
The follow rows pointing at `userId`: what a refused follow must not leave.
*/
async function followRowsOf(userId: string) {
  return core()
    .select()
    .from(followsTable)
    .where(eq(followsTable.followeeId, userId));
}

/**
A SHARED entry by `author` that `reactor` has marked Useful.
*/
async function markedEntry(author: string, reactor: string): Promise<string> {
  const runId = await makeRun({ userId: author });
  const entryId = await makeEntry({ userId: author, runId });
  await setUsefulReaction(entryId, reactor, true);
  return entryId;
}

describe("useful reactions (D-11)", () => {
  beforeEach(resetTables);

  it("marks, then unmarks, answering with the state and count it left", async () => {
    const author = await makeUser();
    const reactor = await makeVerifiedUser();
    const runId = await makeRun({ userId: author });
    const entryId = await makeEntry({
      userId: author,
      runId,
      audience: "runners",
    });

    expect(await usefulCount(entryId)).toBe(0);
    expect(await setUsefulReaction(entryId, reactor, true)).toStrictEqual({
      status: "set",
      useful: true,
      count: 1,
    });
    expect(await usefulCount(entryId)).toBe(1);
    expect(await hasReacted(entryId, reactor)).toBe(true);

    expect(await setUsefulReaction(entryId, reactor, false)).toStrictEqual({
      status: "set",
      useful: false,
      count: 0,
    });
    expect(await usefulCount(entryId)).toBe(0);
    expect(await hasReacted(entryId, reactor)).toBe(false);
  });

  it("counts everyone's marks, and answers with this viewer's own", async () => {
    const author = await makeUser();
    const [first, second] = [
      await makeVerifiedUser(),
      await makeVerifiedUser(),
    ];
    const runId = await makeRun({ userId: author });
    const entryId = await makeEntry({
      userId: author,
      runId,
      audience: "runners",
    });

    await setUsefulReaction(entryId, first, true);

    expect(await setUsefulReaction(entryId, second, true)).toStrictEqual({
      status: "set",
      useful: true,
      count: 2,
    });
    expect(await setUsefulReaction(entryId, second, false)).toStrictEqual({
      status: "set",
      useful: false,
      count: 1,
    });
  });
});

describe("follows", () => {
  beforeEach(resetTables);

  it("follows and unfollows", async () => {
    const follower = await makeUser();
    const followee = await makeVerifiedUser();

    expect(await isFollowing(follower, followee)).toBe(false);
    await follow(follower, followee);
    expect(await isFollowing(follower, followee)).toBe(true);
    expect(await followingCount(follower)).toBe(1);

    await unfollow(follower, followee);
    expect(await isFollowing(follower, followee)).toBe(false);
    expect(await followingCount(follower)).toBe(0);
  });

  it("is idempotent under a repeated follow (queue-redelivery-safe)", async () => {
    const follower = await makeUser();
    const followee = await makeVerifiedUser();

    await follow(follower, followee);
    await follow(follower, followee);
    expect(await followingCount(follower)).toBe(1);
  });

  it("ignores a runner following themselves, though they may see themselves", async () => {
    const runner = await makeVerifiedUser();

    await follow(runner, runner);

    expect(await isFollowing(runner, runner)).toBe(false);
    expect(await followRowsOf(runner)).toHaveLength(0);
  });

  it("does not follow across a block, from either end", async () => {
    const blocker = await makeVerifiedUser();
    const blocked = await makeVerifiedUser();
    await blockRunner(blocker, blocked);

    await follow(blocker, blocked);
    await follow(blocked, blocker);

    expect(await followerCount(blocked)).toBe(0);
    expect(await followerCount(blocker)).toBe(0);
  });

  it("ignores a follow of an unconfirmed runner", async () => {
    const follower = await makeVerifiedUser();
    const unconfirmed = await makeUser();

    await follow(follower, unconfirmed);

    expect(await followRowsOf(unconfirmed)).toHaveLength(0);
  });

  it("ignores a follow of a banned runner", async () => {
    const follower = await makeVerifiedUser();
    const banned = await makeVerifiedUser();
    await core()
      .update(userProfiles)
      .set({ bannedAt: nowSeconds() })
      .where(eq(userProfiles.userId, banned));

    await follow(follower, banned);

    expect(await followRowsOf(banned)).toHaveLength(0);
  });
});

describe("username search", () => {
  beforeEach(resetTables);

  it("prefix-matches display names (public profiles only, per MVP)", async () => {
    await makeVerifiedUser({ username: "Ana Runner" });
    await makeVerifiedUser({ username: "Andy Trails" });
    await makeVerifiedUser({ username: "Beth Miles" });

    const viewer = await makeUser({ username: "Viewer" });
    const results = await searchRunners(viewer, "An");
    expect(results.map((r) => r.username)).toEqual(
      expect.arrayContaining(["Ana Runner", "Andy Trails"]),
    );
    expect(results).toHaveLength(2);

    expect(await searchRunners(viewer, "Beth")).toHaveLength(1);
    expect(await searchRunners(viewer, "zzz")).toHaveLength(0);
  });
});

describe("useful reactions: who may react", () => {
  beforeEach(resetTables);

  it("refuses a reaction to an entry that does not exist, and says why", async () => {
    await expect(
      setUsefulReaction(newUlid(), await makeVerifiedUser(), true),
    ).rejects.toThrow(/not visible/);
  });

  it("refuses a stranger's reaction to a private entry", async () => {
    // Private entries never appear in feeds; reacting to one by id is the
    // way around that, and this is what closes it.
    const owner = await makeUser();
    const stranger = await makeVerifiedUser();
    const runId = await makeRun({ userId: owner });
    const entryId = await makeEntry({
      userId: owner,
      runId,
      audience: "private",
    });

    await expect(setUsefulReaction(entryId, stranger, true)).rejects.toThrow(
      /not visible/,
    );
  });

  it("lets the owner react to their own private entry", async () => {
    const owner = await makeVerifiedUser();
    const runId = await makeRun({ userId: owner });
    const entryId = await makeEntry({
      userId: owner,
      runId,
      audience: "private",
    });

    expect(await setUsefulReaction(entryId, owner, true)).toStrictEqual({
      status: "set",
      useful: true,
      count: 1,
    });
  });

  it("stamps the reaction as useful, in epoch seconds", async () => {
    // `kind` is what a second reaction type would be told apart by, and
    // the timestamp is what any later ordering reads.
    const owner = await makeUser();
    const reactor = await makeVerifiedUser();
    const runId = await makeRun({ userId: owner });
    const entryId = await makeEntry({
      userId: owner,
      runId,
      audience: "runners",
    });
    const before = nowSeconds();

    await setUsefulReaction(entryId, reactor, true);

    const [row] = await drizzle(env.DIALED_CORE)
      .select()
      .from(reactionsTable)
      .where(eq(reactionsTable.entryId, entryId));
    expect(row?.kind).toBe("useful");
    expect(row?.createdAt).toBeGreaterThanOrEqual(before - 5);
    expect(row?.createdAt).toBeLessThanOrEqual(before + 5);
  });
});

describe("useful reactions: whose marks count", () => {
  beforeEach(resetTables);

  it("does not count a banned runner's Useful", async () => {
    const author = await makeVerifiedUser();
    const reactor = await makeVerifiedUser();
    const entryId = await markedEntry(author, reactor);
    expect(await usefulCount(entryId)).toBe(1);

    await core()
      .update(userProfiles)
      .set({ bannedAt: nowSeconds() })
      .where(eq(userProfiles.userId, reactor));

    expect(await usefulCount(entryId)).toBe(0);
  });

  it("does not count a leaving runner's Useful", async () => {
    const author = await makeVerifiedUser();
    const reactor = await makeVerifiedUser();
    const entryId = await markedEntry(author, reactor);
    expect(await usefulCount(entryId)).toBe(1);

    const now = nowSeconds();
    await core()
      .insert(accountDeletions)
      .values({ userId: reactor, requestedAt: now, purgeAfter: now + 1 });

    expect(await usefulCount(entryId)).toBe(0);
  });

  it("takes a mark back across a block", async () => {
    const author = await makeVerifiedUser();
    const reactor = await makeVerifiedUser();
    const entryId = await markedEntry(author, reactor);
    await blockRunner(author, reactor);

    expect(await setUsefulReaction(entryId, reactor, false)).toStrictEqual({
      status: "set",
      useful: false,
      count: 0,
    });
    expect(await hasReacted(entryId, reactor)).toBe(false);
    const marking = setUsefulReaction(entryId, reactor, true);
    await expect(marking).rejects.toBeInstanceOf(Error);
    await expect(marking).rejects.toThrow(
      "entry is not visible to this viewer",
    );
    expect(await hasReacted(entryId, reactor)).toBe(false);
  });
});
