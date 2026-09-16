import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { session, user } from "../../src/db/schema-auth";
import { userProfiles } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  banStateOf,
  bannedAmong,
  banUser,
  unbanUser,
} from "../../src/modules/safety";

import { makeUser, NOW, resetSafetyTables } from "./helpers";

function core() {
  return drizzle(env.DIALED_CORE);
}

/**
 * A signed-in user: a profile row (from `makeUser`) plus the auth rows a
 * real session needs. Sessions live in `schema-auth`, which the feed
 * helpers have no reason to know about.
 */
async function signedInUser(sessions = 2): Promise<string> {
  const userId = await makeUser();
  await core().insert(user).values({
    id: userId,
    name: "Test Runner",
    email: `${userId}@example.test`,
    emailVerified: false,
    createdAt: new Date(NOW * 1000),
    updatedAt: new Date(NOW * 1000),
  });
  for (let n = 0; n < sessions; n += 1) {
    await core()
      .insert(session)
      .values({
        id: newUlid(),
        token: newUlid(),
        userId,
        expiresAt: new Date((NOW + 86_400) * 1000),
        createdAt: new Date(NOW * 1000),
        updatedAt: new Date(NOW * 1000),
      });
  }
  return userId;
}

/**
 * How many sessions a user holds.
 *
 * Asked here rather than exported from the module: this is a fact only a
 * test wants, and a production export nothing in production calls is the
 * kind of code that looks load-bearing to the next reader. (It also made
 * `bans.ts` a clone of `feed/reactions.ts`'s count — a shape that shows up
 * whenever a query exists only to be counted.)
 */
async function sessionCountOf(userId: string): Promise<number> {
  const rows = await core()
    .select({ token: session.token })
    .from(session)
    .where(eq(session.userId, userId));
  return rows.length;
}

async function resetAuthTables(): Promise<void> {
  await core().delete(session);
  await core().delete(user);
  await resetSafetyTables();
}

describe("banning", () => {
  beforeEach(resetAuthTables);

  it("records the ban and revokes every session in one step", async () => {
    const userId = await signedInUser(3);
    expect(await sessionCountOf(userId)).toBe(3);

    await banUser({ userId, reason: "spam", bannedBy: await makeUser() });

    // All three effects, because any two of them looks like it works: a
    // banned account with live sessions is still posting.
    const state = await banStateOf(userId);
    expect(state).toEqual({ banned: true, reason: "spam" });
    expect(await sessionCountOf(userId)).toBe(0);

    // The moment itself, in seconds. The notice quotes the reason back
    // and any appeal reads this column; a millisecond value dates the
    // ban to the year 57000 and still passes a one-sided check.
    const now = Math.floor(Date.now() / 1000);
    const [row] = await core()
      .select({ bannedAt: userProfiles.bannedAt })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    expect(row?.bannedAt).toBeGreaterThanOrEqual(now - 5);
    expect(row?.bannedAt).toBeLessThanOrEqual(now + 5);
  });

  it("leaves other people's sessions alone", async () => {
    const banned = await signedInUser(2);
    const bystander = await signedInUser(2);

    await banUser({ userId: banned, reason: "spam", bannedBy: await makeUser() });

    expect(await sessionCountOf(bystander)).toBe(2);
    const bystanderState = await banStateOf(bystander);
    expect(bystanderState.banned).toBe(false);
  });

  it("is idempotent, so a moderator's second click is not an error", async () => {
    const userId = await signedInUser(1);
    const bannedBy = await makeUser();

    await banUser({ userId, reason: "harassment", bannedBy });
    await banUser({ userId, reason: "harassment", bannedBy });

    const userState = await banStateOf(userId);
    expect(userState.banned).toBe(true);
    expect(await sessionCountOf(userId)).toBe(0);
  });
});

describe("unbanning", () => {
  beforeEach(resetAuthTables);

  it("actually clears the ban", async () => {
    const userId = await signedInUser(1);
    await banUser({ userId, reason: "mistake", bannedBy: await makeUser() });
    const banState = await banStateOf(userId);
    expect(banState.banned).toBe(true);

    await unbanUser(userId);

    // This is the regression guard for a real bug: `.set({ bannedAt:
    // undefined })` type-checks and drizzle DROPS the undefined, so the
    // update ran, touched nothing, reported no error, and left the user
    // banned. Only a test that unbans and then re-reads catches it.
    expect(await banStateOf(userId)).toEqual({
      banned: false,
      reason: undefined,
    });
  });

  it("does not restore the revoked sessions", async () => {
    const userId = await signedInUser(2);
    await banUser({ userId, reason: "mistake", bannedBy: await makeUser() });
    await unbanUser(userId);

    // They sign in again, which is correct — the rows were deleted, not
    // suspended, and inventing new ones would be forging a login.
    expect(await sessionCountOf(userId)).toBe(0);
  });
});

describe("filtering banned authors out of a page", () => {
  beforeEach(resetAuthTables);

  it("returns only the banned ones among the candidates", async () => {
    const banned = await makeUser();
    const fine = await makeUser();
    const alsoBanned = await makeUser();
    const bannedBy = await makeUser();
    await banUser({ userId: banned, reason: "spam", bannedBy });
    await banUser({ userId: alsoBanned, reason: "spam", bannedBy });

    const result = await bannedAmong([banned, fine, alsoBanned]);

    expect(result).toEqual(new Set([banned, alsoBanned]));
  });

  it("does not report someone banned who was not asked about", async () => {
    const banned = await makeUser();
    const fine = await makeUser();
    await banUser({
      userId: banned,
      reason: "spam",
      bannedBy: await makeUser(),
    });

    // The query is scoped to the candidates, not "everyone banned" — the
    // banned set grows without bound and a page only cares about the
    // authors actually on it.
    expect(await bannedAmong([fine])).toEqual(new Set());
  });

  it("asks nothing of the database for an empty candidate list", async () => {
    expect(await bannedAmong([])).toEqual(new Set());
  });

  it("treats a user with no profile row as not banned", async () => {
    // A brand-new account has no profile until onboarding writes one.
    // Failing closed here would lock out every first-time signup.
    expect(await banStateOf(newUlid())).toEqual({
      banned: false,
      reason: undefined,
    });
  });
});
