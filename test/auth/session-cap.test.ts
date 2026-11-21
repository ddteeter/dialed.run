import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { session, user } from "../../src/db/schema-auth";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { createAuth } from "../../src/modules/auth/create-auth";
import {
  cutUserAgent,
  endOldestSessions,
  LIVE_SESSIONS_MAX,
  USER_AGENT_MAX,
} from "../../src/modules/auth/session-cap";
import { recordingMail } from "./mail-recorder";
import { OPEN_ACCESS } from "./open-access";

/**
 * A session keeps a User-Agent of at most 512 characters, and an account
 * at most 50 sessions: a sign-in past that ends the oldest.
 */

const db = drizzle(env.DIALED_CORE);
const ORIGIN = "http://localhost";
const NOW = 1_800_000_000;
const password = ["a", "long", "enough", "passphrase"].join("-");

async function aUser(): Promise<string> {
  const id = newUlid();
  await db.insert(user).values({
    id,
    name: "Test Runner",
    email: `${id.toLowerCase()}@example.test`,
    emailVerified: false,
    createdAt: new Date(NOW * 1000),
    updatedAt: new Date(NOW * 1000),
  });
  return id;
}

/**
A session for `userId` made at `createdAt` (epoch seconds).
*/
async function aSession(
  userId: string,
  createdAt: number,
  id = newUlid(),
): Promise<string> {
  await db.insert(session).values({
    id,
    token: newUlid(),
    userId,
    expiresAt: new Date((createdAt + 604_800) * 1000),
    createdAt: new Date(createdAt * 1000),
    updatedAt: new Date(createdAt * 1000),
  });
  return id;
}

async function sessionIdsOf(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: session.id })
    .from(session)
    .where(eq(session.userId, userId));
  return new Set(rows.map((row) => row.id));
}

describe("cutUserAgent", () => {
  it(`cuts a User-Agent longer than ${String(USER_AGENT_MAX)} characters to that`, () => {
    const long = `${"a".repeat(USER_AGENT_MAX)}b`;
    expect(cutUserAgent({ userAgent: long })).toStrictEqual({
      data: { userAgent: "a".repeat(USER_AGENT_MAX) },
    });
  });

  it("changes nothing at or under the length, or with no User-Agent", () => {
    expect(
      cutUserAgent({ userAgent: "a".repeat(USER_AGENT_MAX) }),
    ).toBeUndefined();
    expect(cutUserAgent({ userAgent: "Mozilla/5.0" })).toBeUndefined();
    expect(cutUserAgent({})).toBeUndefined();
  });
});

describe("endOldestSessions", () => {
  it(`keeps the new session and the ${String(LIVE_SESSIONS_MAX - 1)} newest others`, async () => {
    const userId = await aUser();
    const older: string[] = [];
    for (let n = 0; n < LIVE_SESSIONS_MAX + 1; n += 1) {
      older.push(await aSession(userId, NOW + n));
    }
    // Made in the same second as the newest other, so only its id keeps it.
    const created = await aSession(userId, NOW - 10);
    const other = await aUser();
    const othersSession = await aSession(other, NOW - 100);

    await endOldestSessions(db, { id: created, userId });

    const kept = await sessionIdsOf(userId);
    expect(kept.size).toBe(LIVE_SESSIONS_MAX);
    expect(kept.has(created)).toBe(true);
    for (const id of older.slice(0, 2)) expect(kept.has(id)).toBe(false);
    for (const id of older.slice(2)) expect(kept.has(id)).toBe(true);
    expect(await sessionIdsOf(other)).toStrictEqual(new Set([othersSession]));
  });

  it("breaks a tie on the time made by the id, newest first", async () => {
    const userId = await aUser();
    const ids = Array.from({ length: LIVE_SESSIONS_MAX }, () => newUlid());
    const sorted = ids.toSorted((a, b) => a.localeCompare(b));
    for (const id of sorted) await aSession(userId, NOW, id);
    const created = await aSession(userId, NOW + 1);

    await endOldestSessions(db, { id: created, userId });

    const kept = await sessionIdsOf(userId);
    expect(kept.has(sorted[0] ?? "")).toBe(false);
    expect(kept.has(sorted[1] ?? "")).toBe(true);
    expect(kept.size).toBe(LIVE_SESSIONS_MAX);
  });

  it("ends nothing for an account at or under the cap", async () => {
    const userId = await aUser();
    const ids = new Set<string>();
    for (let n = 0; n < LIVE_SESSIONS_MAX; n += 1) {
      ids.add(await aSession(userId, NOW + n));
    }
    const created = [...ids].at(-1) ?? "";

    await endOldestSessions(db, { id: created, userId });

    expect(await sessionIdsOf(userId)).toStrictEqual(ids);
  });
});

describe("a sign-in through Better Auth", () => {
  const auth = createAuth({
    db,
    secret: "test-secret-not-for-production",
    baseUrl: ORIGIN,
    mail: recordingMail(),
    access: OPEN_ACCESS,
    passwordScreen: {
      verdict: () => Promise.resolve("clean" as const),
      report: () => {
        // this screen always answers
      },
    },
  });

  function post(path: string, body: unknown, userAgent: string): Request {
    return new Request(`${ORIGIN}/api/auth/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "user-agent": userAgent,
      },
      body: JSON.stringify(body),
    });
  }

  it("keeps a cut User-Agent, and ends the oldest session past the cap", async () => {
    const email = `runner-${newUlid().toLowerCase()}@example.com`;
    const signedUp = await auth.handler(
      post("sign-up/email", { email, password, name: "" }, "x"),
    );
    expect(signedUp.status).toBe(200);
    const [account] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email));
    const userId = account?.id ?? "";
    const oldest = await aSession(userId, NOW - 1000);
    for (let n = 1; n < LIVE_SESSIONS_MAX; n += 1) {
      await aSession(userId, NOW + n);
    }

    const signedIn = await auth.handler(
      post("sign-in/email", { email, password }, "u".repeat(50_000)),
    );
    expect(signedIn.status).toBe(200);

    const rows = await db
      .select({ id: session.id, userAgent: session.userAgent })
      .from(session)
      .where(eq(session.userId, userId));
    expect(rows).toHaveLength(LIVE_SESSIONS_MAX);
    expect(rows.some((row) => row.id === oldest)).toBe(false);
    const made = rows
      .map((row) => row.userAgent)
      .filter((userAgent) => userAgent?.startsWith("u"));
    expect(made).toStrictEqual(["u".repeat(USER_AGENT_MAX)]);
  });
});
