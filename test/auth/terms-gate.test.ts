import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { accountDeletions, termsAcceptances } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { accessGate } from "../../src/modules/account/access";
import {
  acceptTerms,
  acceptanceOf,
} from "../../src/modules/account/terms-acceptance";
import { createAuth } from "../../src/modules/auth/create-auth";
import {
  activeUserId,
  keepableUserId,
} from "../../src/modules/auth/leaving-gate";
import { sessionFromRequest } from "../../src/modules/auth/session";
import { agreedUserId } from "../../src/modules/auth/terms-gate";
import { recordingMail } from "./mail-recorder";
import { OPEN_ACCESS } from "./open-access";

/**
 * ACC-6 at the one auth gate: `requireUserId`'s whole decision, which
 * never reads the request's method; the exempt gates a runner behind on
 * the terms still passes; and sign-up recording the published terms — and
 * nothing while none are published (D-93).
 */
const db = drizzle(env.DIALED_CORE);

/**
 * The terms' version in these tests, as if published. The shipped draft is
 * not, and `undefined` stands for that.
 */
const PUBLISHED = 3;

const REFUSAL = {
  // Written out: the client tells this refusal apart by these words.
  code: "TERMS_NOT_ACCEPTED",
  message: "Accept the current terms first.",
  name: "TermsNotAcceptedError",
};

const LEAVING = { code: "ACCOUNT_LEAVING", name: "AccountLeavingError" };

/**
A session for `userId`, in the shape Better Auth's `getSession` returns.
*/
function sessionOf(userId: string) {
  return { user: { id: userId } };
}

async function leaving(userId: string, purgeStartedAt?: number) {
  await db
    .insert(accountDeletions)
    .values({ userId, requestedAt: 1, purgeAfter: 2, purgeStartedAt });
}

describe("agreedUserId — requireUserId's whole decision", () => {
  it("refuses nobody signed in as the unauthenticated signal", async () => {
    // What Better Auth hands back for a request with no cookie.
    const nobody = await sessionFromRequest(
      new Request("https://dialed.run/closet"),
    );
    await expect(agreedUserId(db, nobody, PUBLISHED)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("refuses a runner with no acceptance, or an older version's", async () => {
    const never = newUlid();
    const older = newUlid();
    // A real older version, not 0: it reads differently from no row.
    await acceptanceOf(db, older, PUBLISHED - 1, 100);
    for (const userId of [never, older]) {
      await expect(
        agreedUserId(db, sessionOf(userId), PUBLISHED),
      ).rejects.toMatchObject(REFUSAL);
    }
  });

  it("lets a runner who accepted the current terms through — and Accept is what gets them there", async () => {
    const userId = newUlid();
    await expect(
      agreedUserId(db, sessionOf(userId), PUBLISHED),
    ).rejects.toMatchObject(REFUSAL);
    expect(await acceptTerms(db, userId, PUBLISHED, PUBLISHED)).toBe(
      "accepted",
    );
    await expect(agreedUserId(db, sessionOf(userId), PUBLISHED)).resolves.toBe(
      userId,
    );
  });

  it("refuses nobody over the terms while none are published, the shipped draft included", async () => {
    // No version: the default reads the shipped draft, which is
    // unpublished.
    const userId = newUlid();
    await expect(agreedUserId(db, sessionOf(userId))).resolves.toBe(userId);
  });

  it("refuses an account set to be deleted, or being purged, ahead of the terms", async () => {
    const week = newUlid();
    const purging = newUlid();
    await leaving(week);
    await leaving(purging, 5);
    for (const userId of [week, purging]) {
      await expect(
        agreedUserId(db, sessionOf(userId), PUBLISHED),
      ).rejects.toMatchObject(LEAVING);
    }
    // Leaving with the terms current is still leaving.
    await acceptanceOf(db, week, PUBLISHED, 100);
    await expect(
      agreedUserId(db, sessionOf(week), PUBLISHED),
    ).rejects.toMatchObject(LEAVING);
  });

  it("reads only the runner's own rows", async () => {
    const userId = newUlid();
    await acceptanceOf(db, newUlid(), PUBLISHED, 100);
    await leaving(newUlid());
    await expect(
      agreedUserId(db, sessionOf(userId), PUBLISHED),
    ).rejects.toMatchObject(REFUSAL);
    await acceptanceOf(db, userId, PUBLISHED, 100);
    await expect(agreedUserId(db, sessionOf(userId), PUBLISHED)).resolves.toBe(
      userId,
    );
  });
});

const PASSWORD = ["terms", "account", "fixture"].join("-");

/**
 * An auth instance with open sign-up but the real account-side `confirm`
 * — what the user create hook does for every account, email or Google —
 * against `termsVersion` as the published terms.
 */
function authWithTerms(termsVersion: number | undefined) {
  return createAuth({
    db,
    secret: "test-secret-not-for-production",
    baseUrl: "http://localhost",
    passwordScreen: {
      verdict: () => Promise.resolve("clean" as const),
      report: () => {
        // this screen always answers
      },
    },
    mail: recordingMail(),
    access: {
      ...OPEN_ACCESS,
      confirm: accessGate(db, () => Promise.resolve({ ok: true }), termsVersion)
        .confirm,
    },
  });
}

async function acceptancesOf(userId: string) {
  return db
    .select({ version: termsAcceptances.version })
    .from(termsAcceptances)
    .where(eq(termsAcceptances.userId, userId));
}

function emailFor(label: string): string {
  return `${label}-${newUlid().toLowerCase()}@example.test`;
}

describe("the ways on for a runner behind on the terms (ACC-6, D-95)", () => {
  it("passes the gates Accept, Get a copy, Settings › Account and Delete account use", async () => {
    // `requireUserIdBeforeTerms` and `requireSignedInSince` decide by
    // `activeUserId` alone: the terms are not asked.
    const userId = newUlid();
    await expect(
      agreedUserId(db, sessionOf(userId), PUBLISHED),
    ).rejects.toMatchObject(REFUSAL);
    await expect(activeUserId(db, userId)).resolves.toBe(userId);
  });

  it("passes Keep's gate, behind and leaving at once", async () => {
    const userId = newUlid();
    await leaving(userId);
    await expect(keepableUserId(db, userId)).resolves.toBe(userId);
  });

  it("signs out through Better Auth's own endpoint, which the terms never reach", async () => {
    const auth = authWithTerms(PUBLISHED);
    const email = emailFor("sign-out");
    const { user } = await auth.api.signUpEmail({
      body: { name: "", email, password: PASSWORD },
    });
    // Behind: as if the terms had been bumped since sign-up.
    await db
      .delete(termsAcceptances)
      .where(eq(termsAcceptances.userId, user.id));
    await expect(
      agreedUserId(db, sessionOf(user.id), PUBLISHED),
    ).rejects.toMatchObject(REFUSAL);
    const signedIn = await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      asResponse: true,
    });
    const cookie = signedIn.headers.get("set-cookie") ?? "";
    expect(cookie).not.toBe("");
    const headers = { cookie, origin: "http://localhost" };
    expect(await auth.api.getSession({ headers })).not.toBeNull();

    const signedOut = await auth.handler(
      new Request("http://localhost/api/auth/sign-out", {
        method: "POST",
        headers,
      }),
    );

    expect(signedOut.status).toBe(200);
    expect(await auth.api.getSession({ headers })).toBeNull();
  });
});

describe("sign-up records the published terms (ACC-6, D-93)", () => {
  it("records the published version for an email sign-up, in the create hook", async () => {
    const auth = authWithTerms(PUBLISHED);
    const { user } = await auth.api.signUpEmail({
      body: { name: "", email: emailFor("email"), password: PASSWORD },
    });
    expect(await acceptancesOf(user.id)).toStrictEqual([
      { version: PUBLISHED },
    ]);
    await expect(agreedUserId(db, sessionOf(user.id), PUBLISHED)).resolves.toBe(
      user.id,
    );
  });

  it("records the published version for a Google sign-up", async () => {
    const auth = authWithTerms(PUBLISHED);
    const context = await auth.$context;
    // What Better Auth does on a Google sign-up's return: the user row,
    // confirmed by Google, through the same create hook.
    const user = await context.internalAdapter.createUser(
      { email: emailFor("google"), name: "", emailVerified: true },
      { method: "oauth" },
    );
    expect(await acceptancesOf(user.id)).toStrictEqual([
      { version: PUBLISHED },
    ]);
  });

  it("records nothing while no terms are published — and asks nothing after", async () => {
    // `undefined` is the shipped draft: a default parameter reads it,
    // and it is unpublished.
    const auth = authWithTerms(undefined);
    const { user } = await auth.api.signUpEmail({
      body: { name: "", email: emailFor("draft"), password: PASSWORD },
    });
    const context = await auth.$context;
    const google = await context.internalAdapter.createUser(
      { email: emailFor("draft-google"), name: "", emailVerified: true },
      { method: "oauth" },
    );
    for (const userId of [user.id, google.id]) {
      expect(await acceptancesOf(userId)).toStrictEqual([]);
      await expect(agreedUserId(db, sessionOf(userId))).resolves.toBe(userId);
    }
  });
});
