import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  blocks,
  followNotices,
  notifications,
  userProfiles,
  usernameHistory,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { follow, unfollow } from "../../src/modules/feed/following/follows";
import {
  followBody,
  RING_QUIET_SECONDS,
  ringFollow,
  ringFollowQuietly,
} from "../../src/modules/feed/following/follow-notices";
import { nowSeconds } from "../../src/lib/now";
import { forceRename } from "../../src/modules/account/handles/username";
import { banUser } from "../../src/modules/safety/runners/bans";
import { noPurge } from "../purge-spy";
import {
  deleteAllFrom,
  makeUser,
  makeVerifiedUser,
  resetTables,
} from "./helpers";

const NO_LINK = z.null().parse(JSON.parse("null"));

function core() {
  return drizzle(env.DIALED_CORE);
}

beforeEach(async () => {
  await deleteAllFrom(core(), [followNotices, blocks]);
  await resetTables();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Thirty days, written out rather than read from the module.
 */
const THIRTY_DAYS = 30 * 86_400;

/**
 * Stops the clock at `seconds`, so a test can stand on an exact second.
 */
function clockAt(seconds: number): void {
  vi.spyOn(Date, "now").mockReturnValue(seconds * 1000);
}

/**
 * A runner followed you and was rung at `rungAt`; then they unfollowed, the row
 * was read, and they follow again. Answers how many unread rows you have.
 */
async function refollowRungAt(rungAt: number): Promise<number> {
  const you = await makeVerifiedUser();
  const ada = await makeUser();
  await follow(ada, you);
  await markRead(you);
  await unfollow(ada, you);
  await core()
    .update(followNotices)
    .set({ rungAt })
    .where(eq(followNotices.followerId, ada));
  await follow(ada, you);
  const rows = await bellOf(you);
  return rows.filter((row) => !row.read).length;
}

async function bellOf(userId: string) {
  return core()
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId));
}

async function markRead(userId: string): Promise<void> {
  await core()
    .update(notifications)
    .set({ read: true })
    .where(eq(notifications.userId, userId));
}

describe("the bell row's words (R48·131a–b)", () => {
  it("names one follower, then the newest and the rest", () => {
    expect(followBody("ada", 0)).toBe("@ada followed you.");
    expect(followBody("ada", 1)).toBe("@ada and 1 other followed you.");
    expect(followBody("ada", 3)).toBe("@ada and 3 others followed you.");
  });
});

describe("following rings the bell (D-168)", () => {
  it("rings once for a follow, linking to the follower", async () => {
    const you = await makeVerifiedUser();
    const ada = await makeUser({ username: "ada" });
    await follow(ada, you);
    const [row] = await bellOf(you);
    expect(row).toMatchObject({
      kind: "followed",
      linkId: ada,
      body: "@ada followed you.",
      read: false,
    });
    expect(row?.subjectId).toBeTypeOf("string");
  });

  it("groups follows while the row is unread, naming the newest, with no one to link to", async () => {
    const you = await makeVerifiedUser();
    const ada = await makeUser({ username: "ada" });
    const bo = await makeUser({ username: "bo" });
    const cy = await makeUser({ username: "cy" });
    await follow(ada, you);
    await follow(bo, you);
    await follow(cy, you);
    const rows = await bellOf(you);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      body: "@cy and 2 others followed you.",
      linkId: NO_LINK,
      read: false,
    });
  });

  it("starts a new row once the last one is read", async () => {
    const you = await makeVerifiedUser();
    const ada = await makeUser({ username: "ada" });
    const bo = await makeUser({ username: "bo" });
    await follow(ada, you);
    await markRead(you);
    await follow(bo, you);
    const rows = await bellOf(you);
    const bodies = rows.map((row) => [row.body, row.read]);
    expect(bodies).toContainEqual(["@ada followed you.", true]);
    expect(bodies).toContainEqual(["@bo followed you.", false]);
  });

  it("does not ring twice for an unfollow and refollow within 30 days (R48·131e)", async () => {
    const you = await makeVerifiedUser();
    const ada = await makeUser({ username: "ada" });
    await follow(ada, you);
    await markRead(you);
    await unfollow(ada, you);
    await follow(ada, you);
    expect(await bellOf(you)).toHaveLength(1);
  });

  it("rings again for a refollow 30 days on", async () => {
    const you = await makeVerifiedUser();
    const ada = await makeUser({ username: "ada" });
    await follow(ada, you);
    await markRead(you);
    await unfollow(ada, you);
    await core()
      .update(followNotices)
      .set({ rungAt: nowSeconds() - RING_QUIET_SECONDS - 1 })
      .where(eq(followNotices.followerId, ada));
    await follow(ada, you);
    const rows = await bellOf(you);
    const unread = rows.filter((row) => !row.read);
    expect(unread).toHaveLength(1);
  });

  it("stays quiet a moment short of 30 days", async () => {
    const you = await makeVerifiedUser();
    const ada = await makeUser({ username: "ada" });
    await follow(ada, you);
    await markRead(you);
    await unfollow(ada, you);
    await core()
      .update(followNotices)
      .set({ rungAt: nowSeconds() - RING_QUIET_SECONDS + 60 })
      .where(eq(followNotices.followerId, ada));
    await follow(ada, you);
    const rows = await bellOf(you);
    expect(rows.filter((row) => !row.read)).toHaveLength(0);
  });

  it("is quiet for 30 days to the second, and rings on the second they end", async () => {
    clockAt(1_800_000_000);
    expect(await refollowRungAt(1_800_000_000 - THIRTY_DAYS + 1)).toBe(0);
    expect(await refollowRungAt(1_800_000_000 - THIRTY_DAYS)).toBe(1);
  });

  it("stays quiet 29 days on", async () => {
    clockAt(1_800_000_000);
    expect(await refollowRungAt(1_800_000_000 - 29 * 86_400)).toBe(0);
  });

  it("rings a first follow whatever the clock reads", async () => {
    // Within 30 days of the epoch, a never-rung follower must not be read
    // as rung at zero.
    clockAt(1000);
    const you = await makeUser();
    const ada = await makeUser({ username: "ada" });
    await ringFollow(ada, you);
    expect(await bellOf(you)).toHaveLength(1);
  });

  it("rings nothing for a follower with no handle yet", async () => {
    const you = await makeUser();
    const ada = await makeUser({ username: "ada" });
    await core()
      .update(userProfiles)
      .set({ username: NO_LINK })
      .where(eq(userProfiles.userId, ada));
    await ringFollow(ada, you);
    expect(await bellOf(you)).toHaveLength(0);
    // The positive control: the same follower rings once they have one.
    await core()
      .update(userProfiles)
      .set({ username: "ada" })
      .where(eq(userProfiles.userId, ada));
    await ringFollow(ada, you);
    expect(await bellOf(you)).toHaveLength(1);
  });

  it("rings nothing for a follow that was already there", async () => {
    const you = await makeVerifiedUser();
    const ada = await makeUser({ username: "ada" });
    await follow(ada, you);
    await markRead(you);
    await core().delete(followNotices);
    await follow(ada, you);
    const rows = await bellOf(you);
    expect(rows.filter((row) => !row.read)).toHaveLength(0);
  });

  it("rings nothing when either runner blocked the other", async () => {
    const you = await makeUser();
    const ada = await makeUser({ username: "ada" });
    const bo = await makeUser({ username: "bo" });
    await core()
      .insert(blocks)
      .values([
        { blockerId: you, blockedId: ada, createdAt: 1 },
        { blockerId: bo, blockedId: you, createdAt: 1 },
      ]);
    await ringFollow(ada, you);
    await ringFollow(bo, you);
    expect(await bellOf(you)).toHaveLength(0);
  });

  it("rings nothing for a follower with no profile", async () => {
    const you = await makeUser();
    await ringFollow("01NOPROFILE0000000000000000", you);
    expect(await bellOf(you)).toHaveLength(0);
  });
});

describe("a ring never fails the follow (law 5)", () => {
  it("reports a failed ring with both runners and goes on", async () => {
    const seen: Record<string, string>[] = [];
    await ringFollowQuietly(
      "01FOLLOWER",
      "01FOLLOWEE",
      () => Promise.reject(new Error("down")),
      (_error, context) => {
        seen.push(context);
      },
    );
    expect(seen).toStrictEqual([
      {
        area: "follow-notice",
        followerId: "01FOLLOWER",
        followeeId: "01FOLLOWEE",
      },
    ]);
  });

  it("reports nothing when the ring works", async () => {
    const seen: unknown[] = [];
    await ringFollowQuietly(
      "01FOLLOWER",
      "01FOLLOWEE",
      () => Promise.resolve(),
      (error) => {
        seen.push(error);
      },
    );
    expect(seen).toHaveLength(0);
  });
});

/**
 * A moderator's rename of `userId` to a placeholder; nothing recorded.
 */
function renamed(userId: string) {
  return forceRename(core(), {
    userId,
    typed: "runner_4821",
    reason: "Offensive or sexual",
    recordedAs: () => core().select().from(userProfiles).limit(0),
  });
}

/**
A handle no other test holds, so the history's key never collides.
*/
function freshHandle(prefix: string): string {
  handles.made += 1;
  return `${prefix}_${String(Date.now() % 1e6)}${String(handles.made)}`;
}

const handles = { made: 0 };

/**
The runner gives up `before` for `after` themselves, as Settings does.
*/
async function changesHandle(
  userId: string,
  before: string,
  after: string,
): Promise<void> {
  await core().batch([
    core()
      .insert(usernameHistory)
      .values({ username: before, userId, retiredAt: nowSeconds() }),
    core()
      .update(userProfiles)
      .set({ username: after })
      .where(eq(userProfiles.userId, userId)),
  ]);
}

describe("a handle taken away leaves the bells it rang", () => {
  it("deletes a moderator-renamed runner's rows, and one naming them newest, and leaves the rest", async () => {
    const you = await makeVerifiedUser();
    const them = await makeVerifiedUser();
    const ada = await makeUser({ username: "ada" });
    const bo = await makeUser({ username: "bo" });
    await follow(ada, you);
    await follow(bo, them);
    await follow(ada, them);

    expect(await renamed(ada)).toMatchObject({ kind: "renamed" });

    expect(await bellOf(you)).toStrictEqual([]);
    expect(await bellOf(them)).toStrictEqual([]);
  });

  it("leaves a group row that names another follower newest", async () => {
    const you = await makeVerifiedUser();
    const ada = await makeUser({ username: "ada" });
    const bo = await makeUser({ username: "bo" });
    await follow(ada, you);
    await follow(bo, you);

    await renamed(ada);

    const rows = await bellOf(you);
    expect(rows.map((row) => row.body)).toStrictEqual([
      "@bo and 1 other followed you.",
    ]);
  });

  it("deletes nothing when the rename did not land", async () => {
    const you = await makeVerifiedUser();
    const ada = await makeUser({ username: "ada" });
    await follow(ada, you);

    await Promise.all([
      renamed(ada),
      core()
        .update(userProfiles)
        .set({ username: "ada_now" })
        .where(eq(userProfiles.userId, ada)),
    ]);

    expect(await bellOf(you)).toHaveLength(1);
  });

  it("deletes a closed account's rows on the bells they rang", async () => {
    const you = await makeVerifiedUser();
    const them = await makeVerifiedUser();
    const ada = await makeUser({ username: "ada" });
    const bo = await makeUser({ username: "bo" });
    await follow(ada, you);
    await follow(bo, them);

    await banUser(
      { userId: ada, reason: "Spam", rule: "spam", bannedBy: "op" },
      noPurge,
    );

    expect(await bellOf(you)).toStrictEqual([]);
    expect(await bellOf(them)).toHaveLength(1);
  });

  it("deletes a closed account's group row that names them newest", async () => {
    const you = await makeVerifiedUser();
    const ada = await makeUser({ username: "ada" });
    const bo = await makeUser({ username: "bo" });
    await follow(bo, you);
    await follow(ada, you);

    await banUser(
      { userId: ada, reason: "Spam", rule: "spam", bannedBy: "op" },
      noPurge,
    );

    expect(await bellOf(you)).toStrictEqual([]);
  });

  it("deletes a group row that names a handle they gave up, on a rename and on a ban", async () => {
    for (const takeAway of [
      (userId: string) => renamed(userId),
      (userId: string) =>
        banUser(
          { userId, reason: "Spam", rule: "spam", bannedBy: "op" },
          noPurge,
        ),
    ]) {
      const you = await makeVerifiedUser();
      const old = freshHandle("old");
      const ada = await makeUser({ username: old });
      const bo = await makeUser({ username: freshHandle("bo") });
      await follow(bo, you);
      await follow(ada, you);
      await changesHandle(ada, old, freshHandle("now"));

      await takeAway(ada);

      expect(await bellOf(you)).toStrictEqual([]);
    }
  });

  it("takes the shown handle off the bells when the runner moved to another, and locks it", async () => {
    const you = await makeVerifiedUser();
    const them = await makeVerifiedUser();
    const old = freshHandle("old");
    const now = freshHandle("now");
    const ada = await makeUser({ username: old });
    await follow(ada, you);
    await changesHandle(ada, old, now);
    await follow(ada, them);

    expect(
      await forceRename(core(), {
        userId: ada,
        shown: old,
        typed: "runner_4821",
        reason: "Offensive or sexual",
        recordedAs: () => core().select().from(userProfiles).limit(0),
      }),
    ).toStrictEqual({ kind: "moved", username: now });

    expect(await bellOf(you)).toStrictEqual([]);
    const theirs = await bellOf(them);
    expect(theirs.map((row) => row.body)).toStrictEqual([
      `@${now} followed you.`,
    ]);
    const [locked] = await core()
      .select({ lockedAt: usernameHistory.lockedAt })
      .from(usernameHistory)
      .where(eq(usernameHistory.username, old));
    expect(locked?.lockedAt).not.toBeNull();
  });

  it("takes nothing off the bells for a shown handle that is not theirs", async () => {
    const you = await makeVerifiedUser();
    const other = freshHandle("other");
    const bo = await makeUser({ username: other });
    const ada = await makeUser({ username: freshHandle("ada") });
    // A group holding ada's ring, whose words name bo's old handle.
    await follow(ada, you);
    await follow(bo, you);
    await changesHandle(bo, other, freshHandle("bo"));

    await forceRename(core(), {
      userId: ada,
      shown: other,
      typed: "runner_4821",
      reason: "Offensive or sexual",
      recordedAs: () => core().select().from(userProfiles).limit(0),
    });

    expect(await bellOf(you)).toHaveLength(1);
  });

  it("on a ban of a runner with no handle now, deletes the rows linking to them and leaves a group naming someone else", async () => {
    const you = await makeVerifiedUser();
    const them = await makeVerifiedUser();
    const ada = await makeUser({ username: freshHandle("ada") });
    const boHandle = freshHandle("bo");
    const bo = await makeUser({ username: boHandle });
    // A group on your bell holding ada's ring, naming bo newest; a row on
    // theirs that ada alone rang.
    await follow(ada, you);
    await follow(bo, you);
    await follow(ada, them);
    await core()
      .update(userProfiles)
      .set({ username: sql`NULL` })
      .where(eq(userProfiles.userId, ada));

    await banUser(
      { userId: ada, reason: "Spam", rule: "spam", bannedBy: "op" },
      noPurge,
    );

    const rows = await bellOf(you);
    expect(rows.map((row) => row.body)).toStrictEqual([
      `@${boHandle} and 1 other followed you.`,
    ]);
    expect(await bellOf(them)).toStrictEqual([]);
  });
});
