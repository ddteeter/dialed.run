import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { userProfiles } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import {
  BOOKMARK_MAX_AGE_S,
  runInD1Scope,
  scopedDb,
  scopeOutcome,
} from "../../src/lib/sql/d1-session";
import {
  storedBookmarkOf,
  storeRunnerBookmark,
} from "../../src/modules/auth/d1-bookmark";
import {
  agreedUserId,
  confirmedUserId,
} from "../../src/modules/auth/terms-gate";
import { spiedBinding } from "../d1-spy";

/**
 * Design 143's per-runner bookmark: stored only forwards, and read by the
 * auth gate so a request's replica session starts from it. And D-123's
 * carve-out: the gate for writes others can see pins the primary.
 */
const db = drizzle(env.DIALED_CORE);

const EARLY = "00000000-00000010-00000000-" + "0".repeat(32);
const LATE = "00000000-00000020-00000000-" + "0".repeat(32);

async function runner(
  bookmark?: string,
  storedAt = nowSeconds(),
): Promise<string> {
  const userId = newUlid();
  await db.insert(userProfiles).values({
    userId,
    d1Bookmark: bookmark,
    d1BookmarkAt: bookmark === undefined ? undefined : storedAt,
  });
  return userId;
}

async function storedFor(userId: string): Promise<string | null | undefined> {
  const [row] = await storedBookmarkOf(db, userId);
  return row?.value;
}

describe("storedBookmarkOf", () => {
  const NOW = 2_000_000_000;

  async function storedAt(userId: string): Promise<string | null | undefined> {
    const [row] = await storedBookmarkOf(db, userId, NOW);
    return row?.value;
  }

  it("reads one stored up to a day ago", async () => {
    const userId = await runner(EARLY, NOW - BOOKMARK_MAX_AGE_S);
    expect(await storedAt(userId)).toBe(EARLY);
  });

  it("ignores one stored longer ago than that", async () => {
    const userId = await runner(EARLY, NOW - BOOKMARK_MAX_AGE_S - 1);
    expect(await storedAt(userId)).toBeUndefined();
  });

  it("reads by the clock when not told the time", async () => {
    expect(await storedFor(await runner(EARLY))).toBe(EARLY);
    const stale = await runner(EARLY, nowSeconds() - BOOKMARK_MAX_AGE_S - 60);
    expect(await storedFor(stale)).toBeUndefined();
  });
});

describe("storeRunnerBookmark", () => {
  it("records when it stored the bookmark", async () => {
    const userId = await runner();
    await storeRunnerBookmark(db, userId, EARLY, 1234);
    const [row] = await db
      .select({ at: userProfiles.d1BookmarkAt })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    expect(row?.at).toBe(1234);
  });

  it("records the clock's time when not told it", async () => {
    const userId = await runner();
    const before = nowSeconds();
    await storeRunnerBookmark(db, userId, EARLY);
    const [row] = await db
      .select({ at: userProfiles.d1BookmarkAt })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    expect(row?.at).toBeGreaterThanOrEqual(before);
    expect(row?.at).toBeLessThanOrEqual(nowSeconds());
  });

  it("records a first bookmark", async () => {
    const userId = await runner();
    await storeRunnerBookmark(db, userId, EARLY);
    expect(await storedFor(userId)).toBe(EARLY);
  });

  it("moves forward, never back", async () => {
    const userId = await runner(EARLY);
    await storeRunnerBookmark(db, userId, LATE);
    expect(await storedFor(userId)).toBe(LATE);
    await storeRunnerBookmark(db, userId, EARLY);
    expect(await storedFor(userId)).toBe(LATE);
  });

  it("touches only that runner", async () => {
    const other = await runner(EARLY);
    await storeRunnerBookmark(db, await runner(), LATE);
    expect(await storedFor(other)).toBe(EARLY);
  });

  it("does nothing for a runner with no profile yet", async () => {
    const userId = newUlid();
    await storeRunnerBookmark(db, userId, LATE);
    const rows = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    expect(rows).toEqual([]);
  });
});

function session(userId: string) {
  return { user: { id: userId } };
}

describe("the auth gate and the request's session", () => {
  it("starts the replica session from the runner's stored bookmark", async () => {
    const userId = await runner(LATE);
    const spy = spiedBinding();
    await runInD1Scope(EARLY, async () => {
      await agreedUserId(db, session(userId));
      await scopedDb(spy.binding, "core").all(sql`select 1`);
    });
    expect(spy.opened).toEqual([LATE]);
  });

  it("makes the runner the request's writer", async () => {
    const userId = await runner();
    const outcome = await runInD1Scope(undefined, async () => {
      await agreedUserId(db, session(userId));
      await scopedDb(env.DIALED_CORE, "core").run(
        sql`update user_profiles set thermal_level = 1 where user_id = ${userId}`,
      );
      return scopeOutcome();
    });
    expect(outcome.writerId).toBe(userId);
  });

  it("leaves the device's bookmark alone for a runner with none stored", async () => {
    const userId = await runner();
    const spy = spiedBinding();
    await runInD1Scope(EARLY, async () => {
      await agreedUserId(db, session(userId));
      await scopedDb(spy.binding, "core").all(sql`select 1`);
    });
    expect(spy.opened).toEqual([EARLY]);
  });

  it("pins the primary for the gate of writes others can see", async () => {
    const userId = await runner(LATE);
    const spy = spiedBinding();
    await runInD1Scope(undefined, async () => {
      // No account row, so the gate refuses as unconfirmed; the pin is
      // already in place, as it must be before any check it guards.
      await expect(confirmedUserId(db, session(userId))).rejects.toMatchObject({
        code: "EMAIL_UNCONFIRMED",
      });
      await scopedDb(spy.binding, "core").all(sql`select 1`);
    });
    expect(spy.opened).toEqual(["first-primary"]);
  });
});
