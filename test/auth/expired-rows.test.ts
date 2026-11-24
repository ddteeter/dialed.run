import { eq, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import {
  rateLimit,
  session,
  user,
  verification,
} from "../../src/db/schema-auth";
import { passwordAttempts } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import {
  COUNT_SWEEP_PASSES,
  STATE_SWEEP_BATCH,
  STATE_SWEEP_PASSES,
  sweepExpiredAuthRows,
  sweepExpiredCounts,
  sweepExpiredStates,
} from "../../src/modules/auth/expired-rows/expired-rows";
import { queriesDuring } from "../d1-spy";
import { PASSWORD_ATTEMPT_WINDOW_S } from "../../src/modules/auth/password-check";

/**
 * The daily sweep of auth rows kept past any use: a session thirty days
 * after it expired, and a password-try count a day after its window ended.
 */

const db = drizzle(env.DIALED_CORE);
const DAY = 24 * 60 * 60;
const NOW = 1_800_000_000;

async function aUser(): Promise<string> {
  const id = newUlid();
  await db.insert(user).values({
    id,
    name: "Test Runner",
    email: `${id}@example.test`,
    emailVerified: false,
    createdAt: new Date(NOW * 1000),
    updatedAt: new Date(NOW * 1000),
  });
  return id;
}

/**
A session for `userId` that expires at `expiresAt` (epoch seconds).
*/
async function aSession(userId: string, expiresAt: number): Promise<string> {
  const id = newUlid();
  await db.insert(session).values({
    id,
    token: newUlid(),
    userId,
    expiresAt: new Date(expiresAt * 1000),
    createdAt: new Date((expiresAt - 7 * DAY) * 1000),
    updatedAt: new Date((expiresAt - 7 * DAY) * 1000),
  });
  return id;
}

function byText(a: string, b: string): number {
  return a.localeCompare(b);
}

async function sessionIdsOf(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: session.id })
    .from(session)
    .where(eq(session.userId, userId));
  return rows.map((row) => row.id).toSorted(byText);
}

/**
A password-try count whose window started at `startedAt`.
*/
async function aCount(startedAt: number): Promise<string> {
  const userId = newUlid();
  await db
    .insert(passwordAttempts)
    .values({ userId, windowStartedAt: startedAt, attempts: 3 });
  return userId;
}

async function isCountKept(userId: string): Promise<boolean> {
  const rows = await db
    .select({ userId: passwordAttempts.userId })
    .from(passwordAttempts)
    .where(eq(passwordAttempts.userId, userId));
  return rows.length === 1;
}

describe("sweepExpiredAuthRows: sessions", () => {
  it("deletes a session expired more than thirty days ago, and keeps the rest", async () => {
    const userId = await aUser();
    const long = await aSession(userId, NOW - 30 * DAY - 1);
    const edge = await aSession(userId, NOW - 30 * DAY);
    const recent = await aSession(userId, NOW - DAY);
    const live = await aSession(userId, NOW + 7 * DAY);

    await sweepExpiredAuthRows(db, NOW);

    const kept = await sessionIdsOf(userId);
    expect(kept).not.toContain(long);
    // Exactly thirty days is not more than thirty days.
    expect(kept).toStrictEqual([edge, recent, live].toSorted(byText));
  });

  it("is re-runnable: a second pass changes nothing", async () => {
    const userId = await aUser();
    await aSession(userId, NOW - 40 * DAY);
    const live = await aSession(userId, NOW + DAY);

    await sweepExpiredAuthRows(db, NOW);
    await sweepExpiredAuthRows(db, NOW);

    expect(await sessionIdsOf(userId)).toStrictEqual([live]);
  });

  it("measures from the present when no time is given (the production call)", async () => {
    const now = nowSeconds();
    const userId = await aUser();
    await aSession(userId, now - 31 * DAY);
    const kept = await aSession(userId, now - 29 * DAY);

    await sweepExpiredAuthRows();

    expect(await sessionIdsOf(userId)).toStrictEqual([kept]);
  });
});

describe("sweepExpiredAuthRows: password-try counts", () => {
  it("deletes a count a day past its window, and keeps the rest", async () => {
    const windowEnded = NOW - PASSWORD_ATTEMPT_WINDOW_S;
    const long = await aCount(windowEnded - DAY - 1);
    const edge = await aCount(windowEnded - DAY);
    const current = await aCount(NOW - 60);

    await sweepExpiredAuthRows(db, NOW);

    expect(await isCountKept(long)).toBe(false);
    // A day exactly is not more than a day.
    expect(await isCountKept(edge)).toBe(true);
    expect(await isCountKept(current)).toBe(true);
  });

  it("measures from the present when no time is given", async () => {
    const now = nowSeconds();
    const long = await aCount(now - 2 * DAY);
    const kept = await aCount(now - DAY);

    await sweepExpiredAuthRows();

    expect(await isCountKept(long)).toBe(false);
    expect(await isCountKept(kept)).toBe(true);
  });
});

/**
A Better Auth rate-limit count whose last request was at `lastRequest`, in seconds.
*/
async function aLimit(lastRequest: number): Promise<string> {
  const id = newUlid();
  await db.insert(rateLimit).values({
    id,
    key: `203.0.113.7|/sign-in/email|${id}`,
    count: 1,
    lastRequest: lastRequest * 1000,
  });
  return id;
}

async function isLimitKept(id: string): Promise<boolean> {
  const rows = await db
    .select({ id: rateLimit.id })
    .from(rateLimit)
    .where(eq(rateLimit.id, id));
  return rows.length === 1;
}

describe("sweepExpiredCounts: Better Auth's rate-limit counts", () => {
  it("deletes a count a day past its last request, and keeps the rest", async () => {
    const long = await aLimit(NOW - DAY - 1);
    const edge = await aLimit(NOW - DAY);
    const recent = await aLimit(NOW - 30);

    await sweepExpiredCounts(db, NOW);

    expect(await isLimitKept(long)).toBe(false);
    // A day exactly is not more than a day; the cutoff is in milliseconds.
    expect(await isLimitKept(edge)).toBe(true);
    expect(await isLimitKept(recent)).toBe(true);
  });

  it("measures from the present when no time is given", async () => {
    const now = nowSeconds();
    const long = await aLimit(now - 2 * DAY);
    const kept = await aLimit(now - DAY + 60);

    await sweepExpiredCounts();

    expect(await isLimitKept(long)).toBe(false);
    expect(await isLimitKept(kept)).toBe(true);
  });

  it("deletes in batches until a statement finds fewer", async () => {
    await db.delete(rateLimit);
    const old = await Promise.all(
      [1, 2, 3, 4, 5].map((ago) => aLimit(NOW - 2 * DAY - ago)),
    );
    const recent = await aLimit(NOW);

    const tally = await queriesDuring(() => sweepExpiredCounts(db, NOW, 2));

    const deletes = tally.statements.filter((sql) =>
      /^delete from/iu.test(sql),
    );
    expect(deletes).toHaveLength(3);
    for (const id of old) expect(await isLimitKept(id)).toBe(false);
    expect(await isLimitKept(recent)).toBe(true);
  });

  it("stops after its passes, and the next firing finishes the work", async () => {
    await db.delete(rateLimit);
    const old = await Promise.all(
      [1, 2, 3, 4, 5].map((ago) => aLimit(NOW - 2 * DAY - ago)),
    );

    await sweepExpiredCounts(db, NOW, 2, 2);
    const left = await Promise.all(old.map((id) => isLimitKept(id)));
    expect(left.filter(Boolean)).toHaveLength(1);

    await sweepExpiredCounts(db, NOW, 2, 2);
    const after = await Promise.all(old.map((id) => isLimitKept(id)));
    expect(after.filter(Boolean)).toHaveLength(0);
  });

  it("takes ten thousand rows a statement and twenty statements a call by default", () => {
    expect(COUNT_SWEEP_PASSES).toBe(20);
    expect(STATE_SWEEP_BATCH).toBe(10_000);
  });

  it("is not part of the sessions' sweep, which leaves the counts alone", async () => {
    const long = await aLimit(NOW - 2 * DAY);

    await sweepExpiredAuthRows(db, NOW);

    expect(await isLimitKept(long)).toBe(true);
  });
});

async function planOf(sql: string, params: unknown[]): Promise<string> {
  const plan = await env.DIALED_CORE.prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...params)
    .all<{ detail: string }>();
  return plan.results.map((row) => row.detail).join("\n");
}

describe("the sweep reads by index, not by scanning (D1 bills rows scanned)", () => {
  it("finds expired sessions and spent counts through their indexes", async () => {
    const sessions = db
      .delete(session)
      .where(lt(session.expiresAt, new Date(NOW * 1000)))
      .toSQL();
    const counts = db
      .delete(passwordAttempts)
      .where(lt(passwordAttempts.windowStartedAt, NOW))
      .toSQL();

    const limits = db
      .delete(rateLimit)
      .where(lt(rateLimit.lastRequest, NOW * 1000))
      .toSQL();

    const sessionsPlan = await planOf(sessions.sql, sessions.params);
    const limitsPlan = await planOf(limits.sql, limits.params);
    expect(limitsPlan).toMatch(/rate_limit_last_request/u);
    expect(limitsPlan).not.toMatch(/SCAN\s+rate_limit\b/iu);
    const countsPlan = await planOf(counts.sql, counts.params);

    expect(sessionsPlan).toMatch(/session_expires_at/u);
    expect(sessionsPlan).not.toMatch(/SCAN\s+session\b/iu);
    expect(countsPlan).toMatch(/password_attempts_window/u);
    expect(countsPlan).not.toMatch(/SCAN\s+password_attempts\b/iu);
  });

  it("finds expired verification rows through verification_expires_at", async () => {
    const states = db
      .delete(verification)
      .where(lt(verification.expiresAt, new Date(NOW * 1000)))
      .toSQL();

    const statesPlan = await planOf(states.sql, states.params);
    expect(statesPlan).toMatch(/verification_expires_at/u);
    expect(statesPlan).not.toMatch(/SCAN\s+verification\b/iu);
  });
});

/**
A verification row that expires at `expiresAt` (epoch seconds).
*/
async function aState(expiresAt: number): Promise<string> {
  const id = newUlid();
  await db.insert(verification).values({
    id,
    identifier: `state-${id}`,
    value: "{}",
    expiresAt: new Date(expiresAt * 1000),
    createdAt: new Date((expiresAt - 600) * 1000),
    updatedAt: new Date((expiresAt - 600) * 1000),
  });
  return id;
}

async function stateIds(ids: readonly string[]): Promise<string[]> {
  const rows = await db.select({ id: verification.id }).from(verification);
  return rows
    .map((row) => row.id)
    .filter((id) => ids.includes(id))
    .toSorted(byText);
}

describe("sweepExpiredStates", () => {
  it("deletes a state whose expiry has passed, and keeps one still live or expiring now", async () => {
    const expired = await aState(NOW - 1);
    const expiringNow = await aState(NOW);
    const live = await aState(NOW + 600);

    await sweepExpiredStates(db, NOW);

    expect(await stateIds([expired, expiringNow, live])).toStrictEqual(
      [expiringNow, live].toSorted(byText),
    );
  });

  it("deletes every expired state in batches, however many there are", async () => {
    const expired = await Promise.all(
      [1, 2, 3, 4, 5].map((ago) => aState(NOW - ago)),
    );
    const live = await aState(NOW + 600);

    await sweepExpiredStates(db, NOW, 2);

    expect(await stateIds([...expired, live])).toStrictEqual([live]);
  });

  it("stops after its passes, and the next firing finishes the work", async () => {
    await db.delete(verification);
    const expired = await Promise.all(
      [1, 2, 3, 4, 5].map((ago) => aState(NOW - ago)),
    );

    await sweepExpiredStates(db, NOW, 2, 2);
    expect(await stateIds(expired)).toHaveLength(1);

    await sweepExpiredStates(db, NOW, 2, 2);
    expect(await stateIds(expired)).toStrictEqual([]);
  });

  it("takes ten thousand rows a statement and twenty statements a call by default", () => {
    expect(STATE_SWEEP_BATCH).toBe(10_000);
    expect(STATE_SWEEP_PASSES).toBe(20);
  });
});
