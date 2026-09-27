import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { session, user } from "../../src/db/schema-auth";
import { userProfiles } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { createAuth } from "../../src/modules/auth/create-auth";
import {
  ACCOUNT_CLOSED_CODE,
  banGate,
  banUser,
  unbanUser,
} from "../../src/modules/safety";

/**
 * SAF-4's sign-in block, through Better Auth itself on real D1: the gate
 * is a plugin, so what is under test is the plugin as the auth instance
 * loads it, not a function called on its own.
 */

const CLEAN_SCREEN = {
  verdict: () => Promise.resolve("clean" as const),
  report: () => {
    // this screen always answers
  },
};

function core() {
  return drizzle(env.DIALED_CORE);
}

const auth = createAuth({
  db: core(),
  secret: "test-secret-not-for-production",
  // The requests below come from http://localhost; without this Better
  // Auth trusts only the test bindings' https BETTER_AUTH_URL and refuses
  // them 403 "Invalid origin" (see test/auth/auth.test.ts).
  baseUrl: "http://localhost",
  passwordScreen: CLEAN_SCREEN,
  plugins: [banGate()],
});

// Not a secret — fixture credentials for a throwaway in-memory D1.
const PASSWORD = ["closed", "account", "fixture"].join("-");

/**
A runner with an account and the profile row a ban is written to.
*/
async function runner(): Promise<{ userId: string; email: string }> {
  const email = `${newUlid().toLowerCase()}@example.test`;
  const signUp = await auth.api.signUpEmail({
    body: { name: "Runner", email, password: PASSWORD },
  });
  await core().insert(userProfiles).values({ userId: signUp.user.id });
  return { userId: signUp.user.id, email };
}

/**
Signing in over HTTP, as the form does — a response, never a throw.
*/
async function signIn(email: string): Promise<Response> {
  return auth.handler(
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

describe("a banned runner signing in (SAF-4)", () => {
  it("is refused with the closed code, the reason and the date, and no session is made", async () => {
    const { userId, email } = await runner();
    await banUser({
      userId,
      reason: "Adverts for a supplement store.",
      bannedBy: newUlid(),
    });

    const refused = await signIn(email);

    expect(refused.status).toBe(403);
    const body: unknown = await refused.json();
    expect(body).toMatchObject({
      code: ACCOUNT_CLOSED_CODE,
      message: "Adverts for a supplement store.",
    });
    const [profile] = await core()
      .select({ bannedAt: userProfiles.bannedAt })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    // D4 dates the notice from this, so it is the ban's own moment.
    expect(body).toMatchObject({ closedAt: profile?.bannedAt });
    const sessions = await core()
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, userId));
    expect(sessions).toEqual([]);
  });

  it("refuses every way a session is made, not only the email form", async () => {
    // Google's callback and every other provider end in createSession, so
    // the hook on it is the one gate they all pass through.
    const { userId } = await runner();
    await banUser({ userId, reason: "spam", bannedBy: newUlid() });
    const context = await auth.$context;
    await expect(
      context.internalAdapter.createSession(userId),
    ).rejects.toMatchObject({ body: { code: ACCOUNT_CLOSED_CODE } });
  });

  it("signs in again once unbanned", async () => {
    const { userId, email } = await runner();
    await banUser({ userId, reason: "mistake", bannedBy: newUlid() });
    await unbanUser(userId);

    const signedIn = await signIn(email);
    expect(signedIn.status).toBe(200);
  });

  it("lets a runner who was never banned straight in", async () => {
    const { email } = await runner();
    const signedIn = await signIn(email);
    expect(signedIn.status).toBe(200);
  });

  it("says the reason is empty rather than inventing one", async () => {
    const gate = banGate(() =>
      Promise.resolve({ banned: true, reason: undefined, bannedAt: 1 }),
    );
    const gated = createAuth({
      db: core(),
      secret: "test-secret-not-for-production",
      passwordScreen: CLEAN_SCREEN,
      plugins: [gate],
    });
    const context = await gated.$context;
    await expect(
      context.internalAdapter.createSession(newUlid()),
    ).rejects.toMatchObject({ body: { message: "", closedAt: 1 } });
  });
});

/**
Base64url, as a JWT spells its parts — `=` only ever appears as padding.
*/
function base64url(value: object): string {
  return btoa(JSON.stringify(value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

/**
An id token Google would return — `getUserInfo` decodes, never verifies.
*/
function googleIdToken(email: string): string {
  const now = nowSeconds();
  const claims = {
    iss: "https://accounts.google.com",
    aud: "test-client",
    sub: newUlid(),
    email,
    email_verified: true,
    name: "Runner",
    iat: now,
    exp: now + 3600,
  };
  return `${base64url({ alg: "RS256", typ: "JWT" })}.${base64url(claims)}.sig`;
}

/**
 * Google's way in, through Better Auth's real callback handler: the
 * consent redirect is minted by `sign-in/social`, Google's token endpoint
 * is the only thing stubbed, and the callback runs as it would in
 * production. `handleOAuthUserInfo` ends in `createSession`, the gate
 * throws there, and the callback turns an `APIError` carrying a code into
 * a redirect to the error callback — not the 403 JSON the email form gets.
 */
describe("a banned runner signing in with Google (SAF-4)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const REASON = "Adverts for a supplement store.";

  const google = createAuth({
    db: core(),
    secret: "test-secret-not-for-production",
    baseUrl: "http://localhost",
    google: { clientId: "test-client", clientSecret: "test-client-secret" },
    passwordScreen: CLEAN_SCREEN,
    plugins: [
      banGate(() =>
        Promise.resolve({ banned: true, reason: REASON, bannedAt: 1 }),
      ),
    ],
  });

  it("redirects to the error callback with the closed code and the reason, and sets no session", async () => {
    const email = `${newUlid().toLowerCase()}@example.test`;
    const started = await google.handler(
      new Request("http://localhost/api/auth/sign-in/social", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
        body: JSON.stringify({
          provider: "google",
          callbackURL: "/",
          errorCallbackURL: "/auth/login",
        }),
      }),
    );
    expect(started.status).toBe(200);
    const consent = z.object({ url: z.string() }).parse(await started.json());
    const state = new URL(consent.url).searchParams.get("state") ?? "";
    const cookie = started.headers
      .getSetCookie()
      .map((line) => line.split(";", 1)[0])
      .join("; ");

    const tokenEndpoint = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        access_token: "google-access-token",
        id_token: googleIdToken(email),
        token_type: "Bearer",
        expires_in: 3600,
      }),
    );

    const callback = await google.handler(
      new Request(
        `http://localhost/api/auth/callback/google?code=granted&state=${encodeURIComponent(state)}`,
        { headers: { cookie } },
      ),
    );

    expect(tokenEndpoint).toHaveBeenCalled();
    expect(callback.status).toBe(302);
    const landing = new URL(
      callback.headers.get("location") ?? "",
      "http://localhost",
    );
    expect(landing.pathname).toBe("/auth/login");
    expect(landing.searchParams.get("error")).toBe(ACCOUNT_CLOSED_CODE);
    expect(landing.searchParams.get("error_description")).toBe(REASON);
    expect(
      callback.headers
        .getSetCookie()
        .some(
          (line) =>
            line.includes("session_token=") &&
            !line.includes("session_token=;"),
        ),
    ).toBe(false);
    const [created] = await core()
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email));
    expect(created).toBeDefined();
    const sessions = await core()
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, created?.id ?? ""));
    expect(sessions).toEqual([]);
  });
});
