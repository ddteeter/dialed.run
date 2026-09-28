import * as betterAuthApi from "better-auth/api";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { user } from "../../src/db/schema-auth";
import { inviteCodes, inviteRedemptions } from "../../src/db/schema-core";
import { env } from "../../src/env";
import {
  INVITE_COPY,
  TURNSTILE_REFUSED,
  mintInviteCode,
} from "../../src/lib/access";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { accessGate } from "../../src/modules/account";
import {
  admitSignUp,
  claimInvite,
  signUpKind,
  type AccessGate,
} from "../../src/modules/auth/access-hook";
import { createAuth } from "../../src/modules/auth/create-auth";
import type { TurnstileAttempt } from "../../src/modules/ops";
import { recordingMail } from "./mail-recorder";

/**
 * The way in (task 126, ACC-5), through Better Auth itself on real D1:
 * the gate is its before-hook and its user create hook, so what is under
 * test is the instance as it loads them — with the account module's real
 * gate and only Turnstile's answer stubbed.
 */
/**
 * Better Auth's `null` context (a create outside a request), without a
 * `null` literal: the parse is what makes it the value.
 */
const NO_CONTEXT = z.null().parse(JSON.parse("null"));

const db = drizzle(env.DIALED_CORE);
const ORIGIN = "http://localhost";
const PASSWORD = ["a", "long", "enough", "passphrase"].join("-");
const CLEAN_SCREEN = {
  verdict: () => Promise.resolve("clean" as const),
  report: () => {
    // this screen always answers
  },
};

/**
Turnstile's verdicts, recorded: which attempts it was asked about.
*/
function turnstile(shouldPass = true) {
  const attempts: TurnstileAttempt[] = [];
  const verify = (attempt: TurnstileAttempt) => {
    attempts.push(attempt);
    return Promise.resolve(
      shouldPass
        ? { ok: true as const }
        : { ok: false as const, reason: "rejected" as const, codes: [] },
    );
  };
  return { attempts, verify };
}

function instance(access: AccessGate) {
  return createAuth({
    db,
    secret: "test-secret-not-for-production",
    baseUrl: ORIGIN,
    mail: recordingMail(),
    passwordScreen: CLEAN_SCREEN,
    access,
    google: { clientId: "test-client", clientSecret: "test-client-secret" },
  });
}

async function seedCode(
  code: string,
  { maxUses = 1, revokedAt }: { maxUses?: number; revokedAt?: number } = {},
): Promise<string> {
  const id = newUlid();
  await db
    .insert(inviteCodes)
    .values({ id, code, maxUses, createdAt: nowSeconds(), revokedAt });
  return id;
}

/**
A fresh code for each test: the app's own minting, 32^4 to one.
*/
function freshCode(): string {
  return mintInviteCode();
}

function address(): string {
  return `${newUlid().toLowerCase()}@example.test`;
}

function signUpRequest(
  email: string,
  headers: Record<string, string>,
): Request {
  return new Request(`${ORIGIN}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
    body: JSON.stringify({ email, password: PASSWORD, name: "Maya Runner" }),
  });
}

const errorSchema = z.object({ code: z.string(), message: z.string() });

async function refusal(response: Response) {
  return errorSchema.parse(await response.json());
}

async function accountFor(email: string) {
  const [row] = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(eq(user.email, email));
  return row;
}

describe("email sign-up through the gate", () => {
  it("makes the account with a valid code, spends it on that account, and keeps no name", async () => {
    const { verify } = turnstile();
    const auth = instance(accessGate(db, verify));
    const code = freshCode();
    const codeId = await seedCode(code);
    const email = address();
    const response = await auth.handler(
      signUpRequest(email, {
        "x-invite-code": code.toLowerCase(),
        "x-turnstile-token": "token",
      }),
    );
    expect(response.status).toBe(200);
    const account = await accountFor(email);
    expect(account?.name).toBe("");
    const [spent] = await db
      .select()
      .from(inviteRedemptions)
      .where(eq(inviteRedemptions.codeId, codeId));
    // The id the hook minted is the id Better Auth wrote.
    expect(spent?.userId).toBe(account?.id);
    expect(spent?.email).toBe(email);
  });

  it.each([
    ["no code", {}, "INVITE_MISSING", INVITE_COPY.missing],
    ["a code of the wrong shape", { "x-invite-code": "hello" }, "INVITE_INVALID", INVITE_COPY.invalid],
    ["a code nobody made", { "x-invite-code": "DIAL-ZZZZ" }, "INVITE_INVALID", INVITE_COPY.invalid],
  ])("refuses %s, and makes no account", async (_, headers, code, message) => {
    const auth = instance(accessGate(db, turnstile().verify));
    const email = address();
    const response = await auth.handler(
      signUpRequest(email, { "x-turnstile-token": "token", ...headers }),
    );
    expect(response.status).toBe(400);
    expect(await refusal(response)).toStrictEqual({ code, message });
    expect(await accountFor(email)).toBeUndefined();
  });

  it("refuses a revoked code as it refuses one nobody made", async () => {
    const auth = instance(accessGate(db, turnstile().verify));
    const code = freshCode();
    await seedCode(code, { revokedAt: nowSeconds() });
    const response = await auth.handler(
      signUpRequest(address(), {
        "x-invite-code": code,
        "x-turnstile-token": "token",
      }),
    );
    expect(await refusal(response)).toMatchObject({ code: "INVITE_INVALID" });
  });

  it("refuses a used code the second time", async () => {
    const auth = instance(accessGate(db, turnstile().verify));
    const code = freshCode();
    await seedCode(code);
    const headers = { "x-invite-code": code, "x-turnstile-token": "token" };
    const first = await auth.handler(signUpRequest(address(), headers));
    expect(first.status).toBe(200);
    const second = address();
    const response = await auth.handler(signUpRequest(second, headers));
    expect(await refusal(response)).toStrictEqual({
      code: "INVITE_USED",
      message: INVITE_COPY.used,
    });
    expect(await accountFor(second)).toBeUndefined();
  });

  it("does not spend a code on an address that already has an account, and answers alike", async () => {
    const auth = instance(accessGate(db, turnstile().verify));
    const first = freshCode();
    await seedCode(first);
    const email = address();
    await auth.handler(
      signUpRequest(email, { "x-invite-code": first, "x-turnstile-token": "t" }),
    );
    const second = freshCode();
    const secondId = await seedCode(second);
    const again = await auth.handler(
      signUpRequest(email, { "x-invite-code": second, "x-turnstile-token": "t" }),
    );
    expect(again.status).toBe(200);
    const spent = await db
      .select()
      .from(inviteRedemptions)
      .where(eq(inviteRedemptions.codeId, secondId));
    expect(spent).toStrictEqual([]);
  });

  it("asks Turnstile first, with the visitor's address and the host, and refuses as NOT SENT", async () => {
    const { attempts, verify } = turnstile(false);
    const auth = instance(accessGate(db, verify));
    const email = address();
    const response = await auth.handler(
      signUpRequest(email, {
        "x-turnstile-token": "token",
        "cf-connecting-ip": "203.0.113.9",
      }),
    );
    expect(response.status).toBe(403);
    expect(await refusal(response)).toStrictEqual({
      code: "TURNSTILE_REFUSED",
      message: TURNSTILE_REFUSED,
    });
    expect(attempts).toStrictEqual([
      { token: "token", remoteIp: "203.0.113.9", hostname: "localhost" },
    ]);
    expect(await accountFor(email)).toBeUndefined();
  });

  it("sends no token as none", async () => {
    const { attempts, verify } = turnstile(false);
    const auth = instance(accessGate(db, verify));
    await auth.handler(signUpRequest(address(), {}));
    expect(attempts).toMatchObject([{ token: undefined, remoteIp: undefined }]);
  });

  it("leaves sign-in alone: no Turnstile and no code", async () => {
    const { attempts, verify } = turnstile(false);
    const auth = instance(accessGate(db, verify));
    const request = new Request(`${ORIGIN}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ email: address(), password: PASSWORD }),
    });
    const response = await auth.handler(request);
    expect(response.status).toBe(401);
    expect(attempts).toStrictEqual([]);
  });

  it("with invite-only off, asks for no code but still for Turnstile, and keeps no name", async () => {
    const { attempts, verify } = turnstile();
    const auth = instance({ ...accessGate(db, verify), isInviteOnly: false });
    const email = address();
    const response = await auth.handler(
      signUpRequest(email, { "x-turnstile-token": "token" }),
    );
    expect(response.status).toBe(200);
    expect(attempts).toHaveLength(1);
    const account = await accountFor(email);
    expect(account?.name).toBe("");
  });
});

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
    name: "Maya Runner",
    iat: now,
    exp: now + 3600,
  };
  return `${base64url({ alg: "RS256", typ: "JWT" })}.${base64url(claims)}.sig`;
}

/**
 * Google's way in, through Better Auth's real start and callback: the
 * token endpoint is the only thing stubbed.
 */
async function googleRoundTrip(
  auth: ReturnType<typeof instance>,
  email: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ started: Response; landing?: URL }> {
  const started = await auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-in/social`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        ...headers,
      },
      body: JSON.stringify({
        provider: "google",
        callbackURL: "/",
        errorCallbackURL: "/auth/signup",
        ...body,
      }),
    }),
  );
  if (started.status !== 200) return { started };
  const consent = z.object({ url: z.string() }).parse(await started.json());
  const state = new URL(consent.url).searchParams.get("state") ?? "";
  const cookie = started.headers
    .getSetCookie()
    .map((line) => line.split(";", 1)[0])
    .join("; ");
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      access_token: "google-access-token",
      id_token: googleIdToken(email),
      token_type: "Bearer",
      expires_in: 3600,
    }),
  );
  const callback = await auth.handler(
    new Request(
      `${ORIGIN}/api/auth/callback/google?code=granted&state=${encodeURIComponent(state)}`,
      { headers: { cookie } },
    ),
  );
  return {
    started,
    landing: new URL(callback.headers.get("location") ?? "", ORIGIN),
  };
}

describe("Google sign-up through the gate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("carries a checked code through the round trip and spends it on the new account", async () => {
    const auth = instance(accessGate(db, turnstile().verify));
    const code = freshCode();
    const codeId = await seedCode(code);
    const email = address();
    const { landing } = await googleRoundTrip(
      auth,
      email,
      { requestSignUp: true },
      { "x-invite-code": code, "x-turnstile-token": "token" },
    );
    expect(landing?.pathname).toBe("/");
    const account = await accountFor(email);
    // Google's profile name is not kept: a runner is their handle.
    expect(account?.name).toBe("");
    const [spent] = await db
      .select({ userId: inviteRedemptions.userId })
      .from(inviteRedemptions)
      .where(eq(inviteRedemptions.codeId, codeId));
    expect(spent?.userId).toBe(account?.id);
  });

  it("refuses before the redirect when the code is refused", async () => {
    const auth = instance(accessGate(db, turnstile().verify));
    const { started } = await googleRoundTrip(
      auth,
      address(),
      { requestSignUp: true },
      { "x-invite-code": "DIAL-ZZZZ", "x-turnstile-token": "token" },
    );
    expect(started.status).toBe(400);
    expect(await refusal(started)).toMatchObject({ code: "INVITE_INVALID" });
  });

  it("refuses before the redirect when Turnstile refuses", async () => {
    const auth = instance(accessGate(db, turnstile(false).verify));
    const code = freshCode();
    await seedCode(code);
    const { started } = await googleRoundTrip(
      auth,
      address(),
      { requestSignUp: true },
      { "x-invite-code": code },
    );
    expect(started.status).toBe(403);
  });

  it("makes no account from the log-in page, where nothing asked to sign up", async () => {
    const { attempts, verify } = turnstile();
    const auth = instance(accessGate(db, verify));
    const email = address();
    const { landing } = await googleRoundTrip(auth, email, {
      errorCallbackURL: "/auth/login",
    });
    expect(landing?.pathname).toBe("/auth/login");
    expect(landing?.searchParams.get("error")).toBe("signup_disabled");
    expect(await accountFor(email)).toBeUndefined();
    // Signing in with Google is not signing up: no Turnstile, no code.
    expect(attempts).toStrictEqual([]);
  });

  it("refuses to make an account when the create hook finds no code", async () => {
    // The last word: whatever admitted the request, an account made with
    // invite-only on and no code to spend is refused, and nothing claimed.
    const claims: unknown[] = [];
    const create = claimInvite({
      isInviteOnly: true,
      passesTurnstile: () => Promise.resolve(true),
      standing: () => Promise.resolve("open"),
      claim: (claim) => {
        claims.push(claim);
        return Promise.resolve("redeemed");
      },
    });
    await expect(
      create({ email: address() }, { path: "/sign-up/email" }),
    ).rejects.toMatchObject({ body: { code: "INVITE_MISSING" } });
    expect(claims).toStrictEqual([]);
  });

  it("refuses to make an account when the claim itself is refused", async () => {
    const create = claimInvite({
      isInviteOnly: true,
      passesTurnstile: () => Promise.resolve(true),
      standing: () => Promise.resolve("open"),
      claim: () => Promise.resolve("used"),
    });
    await expect(
      create(
        { email: address() },
        {
          path: "/sign-up/email",
          headers: new Headers({ "x-invite-code": "DIAL-ABCD" }),
        },
      ),
    ).rejects.toMatchObject({ body: { code: "INVITE_USED" } });
  });

  it("treats a missing request context as no header code, not a thrown error", async () => {
    // `codeForCreate`'s `context?.path` and `state.data?.serverContext` are
    // both optional chains a real Better Auth call site can hit with a null
    // context or a state that fails to parse — `getOAuthState` is stubbed so
    // the test controls that shape rather than depending on Better Auth's
    // own behaviour outside a real OAuth round trip.
    const stateSpy = vi
      .spyOn(betterAuthApi, "getOAuthState")
      // No OAuth state at all: what Better Auth answers outside a round trip.
      .mockResolvedValueOnce(NO_CONTEXT);
    try {
      const create = claimInvite({
        isInviteOnly: true,
        passesTurnstile: () => Promise.resolve(true),
        standing: () => Promise.resolve("open"),
        claim: () => Promise.resolve("redeemed"),
      });
      await expect(create({ email: address() }, NO_CONTEXT)).rejects.toMatchObject({
        body: { code: "INVITE_MISSING" },
      });
    } finally {
      stateSpy.mockRestore();
    }
  });
});

describe("signUpKind", () => {
  it("names the email form's request \"email\", not just non-undefined", () => {
    expect(signUpKind("/sign-up/email", {})).toBe("email");
  });

  it("only treats a social attempt as one on the social path", () => {
    // isSocial gates on the path, not on the body alone: a request that
    // asks to sign up from a different path must not read as Google's.
    expect(signUpKind("/sign-in/email", { requestSignUp: true })).toBeUndefined();
  });
});

describe("admitSignUp", () => {
  it("carries Google's OAuth state only for a Google sign-up attempt", async () => {
    const contextSpy = vi
      .spyOn(betterAuthApi, "addOAuthServerContext")
      .mockResolvedValue(undefined);
    try {
      const gate: AccessGate = {
        isInviteOnly: true,
        passesTurnstile: () => Promise.resolve(true),
        standing: () => Promise.resolve("open"),
        claim: () => Promise.resolve("redeemed"),
      };
      await admitSignUp(gate, {
        path: "/sign-up/email",
        headers: new Headers({ "x-invite-code": "DIAL-ABCD" }),
      });
      expect(contextSpy).not.toHaveBeenCalled();
    } finally {
      contextSpy.mockRestore();
    }
  });
});
