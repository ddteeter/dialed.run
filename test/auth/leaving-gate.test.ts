import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { BetterAuthPlugin } from "better-auth";
import { describe, expect, it } from "vitest";

import { session } from "../../src/db/schema-auth";
import { accountDeletions, userProfiles } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { keepAccount } from "../../src/modules/account/data/deletion";
import { AUTH_REQUIRED_CODE } from "../../src/modules/auth/auth-error";
import { createAuth } from "../../src/modules/auth/create-auth";
import {
  activeUserId,
  deletionGate,
  keepableUserId,
  standingOf,
} from "../../src/modules/auth/leaving-gate";
import { recordingMail } from "./mail-recorder";
import { OPEN_ACCESS } from "./open-access";

/**
 * ACC-9 at the one auth gate (review of PR #130): the server refuses a
 * runner whose account is set to be deleted, rather than trusting the
 * root route's redirect to keep them on "Keep your account?".
 */
const db = drizzle(env.DIALED_CORE);

const CLEAN_SCREEN = {
  verdict: () => Promise.resolve("clean" as const),
  report: () => {
    // this screen always answers
  },
};

const auth = createAuth({
  db,
  secret: "test-secret-not-for-production",
  // See test/safety/ban-gate.test.ts: requests come from http://localhost.
  baseUrl: "http://localhost",
  passwordScreen: CLEAN_SCREEN,
  mail: recordingMail(),
  access: OPEN_ACCESS,
  plugins: [deletionGate(db)],
});

// Not a secret — fixture credentials for a throwaway in-memory D1.
const PASSWORD = ["leaving", "account", "fixture"].join("-");

async function runner(): Promise<{ userId: string; email: string }> {
  const email = `${newUlid().toLowerCase()}@example.test`;
  const signUp = await auth.api.signUpEmail({
    body: { name: "Runner", email, password: PASSWORD },
  });
  await db.insert(userProfiles).values({ userId: signUp.user.id });
  return { userId: signUp.user.id, email };
}

/**
A deletion asked for: inside its week, or with its purge started.
*/
async function leaving(userId: string, purgeStartedAt?: number) {
  await db.insert(accountDeletions).values({
    userId,
    requestedAt: 1,
    purgeAfter: 2,
    purgeStartedAt,
  });
}

async function signIn(email: string, through = auth): Promise<Response> {
  return through.handler(
    new Request("http://localhost/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
      },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );
}

async function sessionsOf(userId: string) {
  return db
    .select({ id: session.id })
    .from(session)
    .where(eq(session.userId, userId));
}

describe("standingOf", () => {
  it("is active with no deletion, leaving inside the week, purging once the purge starts", async () => {
    const active = newUlid();
    const inTheWeek = newUlid();
    const purging = newUlid();
    await leaving(inTheWeek);
    await leaving(purging, 3);
    expect(await standingOf(db, active)).toBe("active");
    expect(await standingOf(db, inTheWeek)).toBe("leaving");
    expect(await standingOf(db, purging)).toBe("purging");
  });
});

describe("activeUserId — every server function's rule", () => {
  it("lets a runner with no deletion through", async () => {
    const userId = newUlid();
    await expect(activeUserId(db, userId)).resolves.toBe(userId);
  });

  it("refuses a runner inside their deletion's week, and one being purged — so nothing is written behind the purge", async () => {
    const inTheWeek = newUlid();
    const purging = newUlid();
    await leaving(inTheWeek);
    await leaving(purging, 3);
    for (const userId of [inTheWeek, purging]) {
      await expect(activeUserId(db, userId)).rejects.toMatchObject({
        // Written out: the client tells this refusal apart by these words.
        code: "ACCOUNT_LEAVING",
        message: "This account is set to be deleted.",
        name: "AccountLeavingError",
      });
    }
  });
});

describe("keepableUserId — Keep my account's rule", () => {
  it("lets a runner inside the week keep it, and then everything is theirs again", async () => {
    const userId = newUlid();
    await leaving(userId);

    const keeper = await keepableUserId(db, userId);
    expect(keeper).toBe(userId);
    expect(await keepAccount(db, keeper)).toBe("kept");

    await expect(activeUserId(db, userId)).resolves.toBe(userId);
  });

  it("lets a runner with no deletion through, as Keep answers them kept", async () => {
    const userId = newUlid();
    await expect(keepableUserId(db, userId)).resolves.toBe(userId);
  });

  it("treats a runner whose purge has started as nobody", async () => {
    const userId = newUlid();
    await leaving(userId, 3);
    await expect(keepableUserId(db, userId)).rejects.toMatchObject({
      code: AUTH_REQUIRED_CODE,
    });
  });
});

describe("deletionGate — signing in", () => {
  it("lets a runner inside their deletion's week sign in, to be asked", async () => {
    const { userId, email } = await runner();
    await leaving(userId);
    const signedIn = await signIn(email);
    expect(signedIn.status).toBe(200);
    expect(await sessionsOf(userId)).toHaveLength(1);
  });

  it("refuses a runner whose purge has started, as a wrong password is refused, and makes no session", async () => {
    const { userId, email } = await runner();
    await leaving(userId, 3);

    const refused = await signIn(email);

    expect(refused.status).toBe(401);
    expect(await refused.json()).toMatchObject({
      code: "INVALID_EMAIL_OR_PASSWORD",
    });
    expect(await sessionsOf(userId)).toStrictEqual([]);
  });

  it("refuses every way a session is made once the purge has started", async () => {
    const { userId } = await runner();
    await leaving(userId, 3);
    const context = await auth.$context;
    await expect(
      context.internalAdapter.createSession(userId),
    ).rejects.toMatchObject({ body: { code: "INVALID_EMAIL_OR_PASSWORD" } });
  });

  it("writes no session at all once the purge has started, so nothing that follows a session's making runs", async () => {
    const made: string[] = [];
    const afterMade: BetterAuthPlugin = {
      id: "after-made",
      init: () => ({
        options: {
          databaseHooks: {
            session: {
              create: {
                after: (row: { userId: string }) => {
                  made.push(row.userId);
                  return Promise.resolve();
                },
              },
            },
          },
        },
      }),
    };
    const watched = createAuth({
      db,
      secret: "test-secret-not-for-production",
      baseUrl: "http://localhost",
      passwordScreen: CLEAN_SCREEN,
      mail: recordingMail(),
      access: OPEN_ACCESS,
      plugins: [afterMade, deletionGate(db)],
    });
    const { userId, email } = await runner();
    await leaving(userId, 3);
    const other = await runner();

    const refused = await signIn(email, watched);
    expect(refused.status).toBe(401);
    expect(made).toStrictEqual([]);

    // The watcher does see a session that is made.
    const signedIn = await signIn(other.email, watched);
    expect(signedIn.status).toBe(200);
    expect(made).toStrictEqual([other.userId]);
  });

  it("deletes the session when the purge starts while it is being made", async () => {
    const { userId, email } = await runner();
    // Starts the purge after the gate's first read and before the insert.
    const purgeStarts: BetterAuthPlugin = {
      id: "purge-starts",
      init: () => ({
        options: {
          databaseHooks: {
            session: {
              create: {
                before: async (made: { userId: string }) => {
                  await leaving(made.userId, 3);
                },
              },
            },
          },
        },
      }),
    };
    const racing = createAuth({
      db,
      secret: "test-secret-not-for-production",
      baseUrl: "http://localhost",
      passwordScreen: CLEAN_SCREEN,
      mail: recordingMail(),
      access: OPEN_ACCESS,
      plugins: [deletionGate(db), purgeStarts],
    });

    const refused = await signIn(email, racing);

    expect(refused.status).toBe(401);
    expect(await refused.json()).toMatchObject({
      code: "INVALID_EMAIL_OR_PASSWORD",
    });
    expect(refused.headers.getSetCookie()).toStrictEqual([]);
    expect(await sessionsOf(userId)).toStrictEqual([]);
  });

  it("keeps the session when the second read still finds the week, not the purge", async () => {
    const { userId } = await runner();
    await leaving(userId);
    const context = await auth.$context;
    const made = await context.internalAdapter.createSession(userId);
    expect(await sessionsOf(userId)).toStrictEqual([{ id: made.id }]);
  });

  it("lets a runner with no deletion straight in", async () => {
    const { email } = await runner();
    const signedIn = await signIn(email);
    expect(signedIn.status).toBe(200);
  });
});
