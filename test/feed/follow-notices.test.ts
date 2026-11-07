import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { blocks, followNotices, notifications } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { follow, unfollow } from "../../src/modules/feed/follows";
import {
  followBody,
  RING_QUIET_SECONDS,
  ringFollow,
  ringFollowQuietly,
} from "../../src/modules/feed/follow-notices";
import { nowSeconds } from "../../src/lib/now";
import { deleteAllFrom, makeUser, resetTables } from "./helpers";

const NO_LINK = z.null().parse(JSON.parse("null"));

function core() {
  return drizzle(env.DIALED_CORE);
}

beforeEach(async () => {
  await deleteAllFrom(core(), [followNotices, blocks]);
  await resetTables();
});

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
    const you = await makeUser();
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
    const you = await makeUser();
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
    const you = await makeUser();
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
    const you = await makeUser();
    const ada = await makeUser({ username: "ada" });
    await follow(ada, you);
    await markRead(you);
    await unfollow(ada, you);
    await follow(ada, you);
    expect(await bellOf(you)).toHaveLength(1);
  });

  it("rings again for a refollow 30 days on", async () => {
    const you = await makeUser();
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
    const you = await makeUser();
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

  it("rings nothing for a follow that was already there", async () => {
    const you = await makeUser();
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
