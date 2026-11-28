import process from "node:process";

import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { session, user, verification } from "../../src/db/schema-auth";
import { outbox, passwordAttempts, rateLimits } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { createAuth } from "../../src/modules/auth/create-auth";
import { confirmEmail } from "../../src/modules/account/verification/verification";
import { issueEmailLink } from "../../src/modules/account/verification/email-links";
import { changeOwnPassword } from "../../src/modules/auth/change-password";
import {
  checkOwnPassword,
  isOwnPassword,
  PASSWORD_ATTEMPT_WINDOW_S,
} from "../../src/modules/auth/password-check";
import { PASSWORD_ATTEMPTS_PER_WINDOW } from "../../src/lib/contracts";
import {
  SIGN_IN_LIMITED_CODE,
  SIGN_IN_TRIES,
  SIGN_IN_WINDOW_S,
} from "../../src/lib/contracts/access";
import { nowSeconds } from "../../src/lib/now";
import { ADDRESS_MAX } from "../../src/modules/auth/sign-in-limit";
import { recordingMail } from "./mail-recorder";
import { OPEN_ACCESS } from "./open-access";

/**
 * The account's security paths through Better Auth's real endpoints on
 * real D1 (review of PR #119): a reset link is spent once, stored only as
 * a hash, and ends every session; "Sign out everywhere" ends the others;
 * the email change's password check is Better Auth's own; and no email is
 * sent on the request path.
 */

const db = drizzle(env.DIALED_CORE);
const ORIGIN = "http://localhost";
const password = ["a", "long", "enough", "passphrase"].join("-");

function instance(overrides: Partial<Parameters<typeof createAuth>[0]> = {}) {
  const mail = recordingMail();
  const auth = createAuth({
    db,
    secret: "test-secret-not-for-production",
    baseUrl: ORIGIN,
    mail,
    access: OPEN_ACCESS,
    passwordScreen: {
      verdict: () => Promise.resolve("clean" as const),
      report: () => {
        // this screen always answers
      },
    },
    ...overrides,
  });
  return { auth, mail };
}

type Auth = ReturnType<typeof instance>["auth"];

function post(path: string, body: unknown, cookie?: string): Request {
  const headers = new Headers({
    "content-type": "application/json",
    origin: ORIGIN,
  });
  if (cookie !== undefined) headers.set("cookie", cookie);
  return new Request(`${ORIGIN}/api/auth/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function signUp(auth: Auth): Promise<{ email: string; userId: string }> {
  const email = `runner-${newUlid().toLowerCase()}@example.com`;
  const response = await auth.handler(
    post("sign-up/email", { name: "", email, password }),
  );
  expect(response.status).toBe(200);
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email));
  return { email, userId: row?.id ?? "" };
}

/**
A session, as the cookie a browser would send with it.
*/
async function signIn(auth: Auth, email: string): Promise<string> {
  const response = await auth.handler(
    post("sign-in/email", { email, password }),
  );
  expect(response.status).toBe(200);
  return (response.headers.get("set-cookie") ?? "").split(";", 1)[0] ?? "";
}

async function sessionsOf(userId: string): Promise<number> {
  const rows = await db
    .select({ id: session.id })
    .from(session)
    .where(eq(session.userId, userId));
  return rows.length;
}

async function isVerified(userId: string): Promise<boolean | undefined> {
  const [row] = await db
    .select({ emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.id, userId));
  return row?.emailVerified;
}

/**
The outbox kinds owed under this runner's id: the product link, if any.
*/
async function owedFor(userId: string): Promise<string[]> {
  const rows = await db
    .select({ kind: outbox.kind })
    .from(outbox)
    .where(eq(outbox.dedupeKey, userId));
  return rows.map((row) => row.kind);
}

async function resetTokenFor(
  auth: Auth,
  mail: ReturnType<typeof recordingMail>,
  email: string,
): Promise<string> {
  await auth.api.requestPasswordReset({ body: { email } });
  const call = mail.calls.findLast(
    (sent) => sent.kind === "resetPassword" && sent.email === email,
  );
  return call?.token ?? "";
}

/**
 * Run a call Better Auth refuses, and hold it to the one refusal expected.
 *
 * Better Auth's D1 adapter wrapper (`runWithAdapter`) lets a refusal
 * thrown inside an endpoint escape as an unhandled rejection *as well as*
 * answering it — the response is a correct 400, and the rejection is a
 * copy of it (see `test/auth/auth.test.ts` on the short password). Vitest
 * fails the file on any unhandled rejection unless a listener of the
 * test's own is registered, so this registers one for the call's
 * duration and asserts that what it caught is exactly that copy and
 * nothing else.
 */
async function refused<T>(code: string, run: () => Promise<T>): Promise<T> {
  const strays: unknown[] = [];
  const listener = (reason: unknown): void => {
    strays.push(reason);
  };
  process.on("unhandledRejection", listener);
  try {
    const result = await run();
    // A rejection is reported after the microtasks that could handle it.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    for (const stray of strays) {
      expect(stray).toMatchObject({ body: { code } });
    }
    return result;
  } finally {
    process.off("unhandledRejection", listener);
  }
}

describe("a password reset (ACC-4)", () => {
  it("is spent once: the second use of the link is refused, and every session has ended", async () => {
    const { auth, mail } = instance();
    const { email, userId } = await signUp(auth);
    await signIn(auth, email);
    await signIn(auth, email);
    expect(await sessionsOf(userId)).toBe(2);
    const token = await resetTokenFor(auth, mail, email);
    const next = ["a", "new", "long", "passphrase"].join("-");

    const first = await auth.handler(
      post("reset-password", { token, newPassword: next }),
    );
    expect(first.status).toBe(200);
    expect(await sessionsOf(userId)).toBe(0);

    const second = await refused("INVALID_TOKEN", () =>
      auth.handler(
        post("reset-password", { token, newPassword: `${next}-again` }),
      ),
    );
    expect(second.status).toBe(400);
    expect(await second.json()).toMatchObject({ code: "INVALID_TOKEN" });
    // The first password stands: the second use changed nothing.
    const signedIn = await auth.handler(
      post("sign-in/email", { email, password: next }),
    );
    expect(signedIn.status).toBe(200);
  });

  it("refuses a breached new password, and leaves the old one and the link as they were", async () => {
    const next = ["a", "breached", "long", "passphrase"].join("-");
    const { auth, mail } = instance({
      passwordScreen: {
        verdict: (candidate) =>
          Promise.resolve(candidate === next ? "breached" : "clean"),
        report: () => {
          // a breached verdict is an answer, not a failure
        },
      },
    });
    const { email, userId } = await signUp(auth);
    const token = await resetTokenFor(auth, mail, email);

    const response = await refused("PASSWORD_BREACHED", () =>
      auth.handler(post("reset-password", { token, newPassword: next })),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "PASSWORD_BREACHED" });
    expect(await canSignInWith(auth, userId, password)).toBe(true);
    const clean = ["a", "clean", "long", "passphrase"].join("-");
    const retried = await auth.handler(
      post("reset-password", { token, newPassword: clean }),
    );
    expect(retried.status).toBe(200);
  });

  it("stores the link's token only as a hash", async () => {
    const { auth, mail } = instance();
    const { email, userId } = await signUp(auth);
    const token = await resetTokenFor(auth, mail, email);
    expect(token).not.toBe("");

    const rows = await db
      .select({ identifier: verification.identifier })
      .from(verification)
      .where(eq(verification.value, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.identifier).not.toContain(token);
    expect(auth.options.verification).toStrictEqual({
      storeIdentifier: "hashed",
    });
  });

  it("is open to an unconfirmed runner, and spending it confirms their address", async () => {
    const { auth, mail } = instance();
    const { email, userId } = await signUp(auth);
    expect(await isVerified(userId)).toBe(false);

    const token = await resetTokenFor(auth, mail, email);
    expect(token).not.toBe("");
    const response = await auth.handler(
      post("reset-password", {
        token,
        newPassword: ["reset", "while", "unconfirmed"].join("-"),
      }),
    );

    expect(response.status).toBe(200);
    expect(await isVerified(userId)).toBe(true);
    // A confirmation, so what a confirmation owes (design 133, D-113 Q1).
    expect(await owedFor(userId)).toStrictEqual(["product_link"]);
  });

  it("owes no product link when the address was confirmed already", async () => {
    const { auth, mail } = instance();
    const { email, userId } = await signUp(auth);
    await db
      .update(user)
      .set({ emailVerified: true })
      .where(eq(user.id, userId));

    const token = await resetTokenFor(auth, mail, email);
    await auth.handler(
      post("reset-password", {
        token,
        newPassword: ["reset", "while", "confirmed"].join("-"),
      }),
    );

    expect(await isVerified(userId)).toBe(true);
    expect(await owedFor(userId)).toStrictEqual([]);
  });

  it("confirms only the runner whose link it was", async () => {
    const { auth, mail } = instance();
    const resetter = await signUp(auth);
    const bystander = await signUp(auth);
    const token = await resetTokenFor(auth, mail, resetter.email);

    await auth.handler(
      post("reset-password", {
        token,
        newPassword: ["only", "this", "runner"].join("-"),
      }),
    );

    expect(await isVerified(resetter.userId)).toBe(true);
    expect(await isVerified(bystander.userId)).toBe(false);
    expect(await owedFor(bystander.userId)).toStrictEqual([]);
  });
});

describe("an email change (ACC-8) and the old inbox's reset link", () => {
  it("withdraws a reset link sent before the move, so the old inbox cannot reset", async () => {
    const { auth, mail } = instance();
    const { email, userId } = await signUp(auth);
    const bystander = await signUp(auth);
    const reset = await resetTokenFor(auth, mail, email);
    const theirs = await resetTokenFor(auth, mail, bystander.email);
    const moved = `moved-${newUlid().toLowerCase()}@example.com`;
    const link = await issueEmailLink(db, {
      userId,
      purpose: "change",
      email: moved,
    });

    expect(await confirmEmail(db, link)).toMatchObject({ state: "confirmed" });

    const next = ["a", "new", "long", "passphrase"].join("-");
    const refusedReset = await refused("INVALID_TOKEN", () =>
      auth.handler(post("reset-password", { token: reset, newPassword: next })),
    );
    expect(refusedReset.status).toBe(400);
    // Only the runner who moved: another runner's open link still works.
    const bystanderReset = await auth.handler(
      post("reset-password", { token: theirs, newPassword: next }),
    );
    expect(bystanderReset.status).toBe(200);
  });
});

async function plantChange(userId: string): Promise<string> {
  return issueEmailLink(db, {
    userId,
    purpose: "change",
    email: `moved-${newUlid().toLowerCase()}@example.com`,
  });
}

async function addressOf(userId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId));
  return row?.email;
}

describe("an open change-email link, once the password changes hands", () => {
  const next = ["a", "replaced", "long", "passphrase"].join("-");

  it("is withdrawn by a reset, while another runner's still works", async () => {
    const { auth, mail } = instance();
    const { email, userId } = await signUp(auth);
    const bystander = await signUp(auth);
    const link = await plantChange(userId);
    const theirs = await plantChange(bystander.userId);
    const token = await resetTokenFor(auth, mail, email);

    const reset = await auth.handler(
      post("reset-password", { token, newPassword: next }),
    );

    expect(reset.status).toBe(200);
    expect(await confirmEmail(db, link)).toStrictEqual({ state: "expired" });
    expect(await addressOf(userId)).toBe(email);
    expect(await confirmEmail(db, theirs)).toMatchObject({
      state: "confirmed",
    });
  });

  it("is withdrawn by a password change", async () => {
    const check = { ...(await signedIn()), db };
    const before = await addressOf(check.userId);
    const link = await plantChange(check.userId);

    expect(
      await changeOwnPassword(check, {
        currentPassword: password,
        password: next,
      }),
    ).toStrictEqual({ status: "changed" });

    expect(await confirmEmail(db, link)).toStrictEqual({ state: "expired" });
    expect(await addressOf(check.userId)).toBe(before);
  });

  it("stays when the current password is wrong, since nothing changed hands", async () => {
    const check = { ...(await signedIn()), db };
    const link = await plantChange(check.userId);

    await refused("INVALID_PASSWORD", () =>
      changeOwnPassword(check, {
        currentPassword: `${password}-not`,
        password: next,
      }),
    );

    expect(await confirmEmail(db, link)).toMatchObject({ state: "confirmed" });
  });

  it("stays on an ordinary log-out, which hands no password over", async () => {
    const { auth } = instance();
    const { email, userId } = await signUp(auth);
    const cookie = await signIn(auth, email);
    const link = await plantChange(userId);

    const response = await auth.handler(post("sign-out", {}, cookie));

    expect(response.status).toBe(200);
    expect(await confirmEmail(db, link)).toMatchObject({ state: "confirmed" });
  });

  it("leaves Sign out everywhere with no session refused as it was", async () => {
    const { auth } = instance();
    const response = await auth.handler(post("revoke-sessions", {}));
    expect(response.status).toBe(401);
  });

  it("is withdrawn by Sign out everywhere", async () => {
    const { auth } = instance();
    const { email, userId } = await signUp(auth);
    const cookie = await signIn(auth, email);
    const link = await plantChange(userId);

    const response = await auth.handler(post("revoke-sessions", {}, cookie));

    expect(response.status).toBe(200);
    expect(await confirmEmail(db, link)).toStrictEqual({ state: "expired" });
    expect(await addressOf(userId)).toBe(email);
  });
});

/**
A signed-in runner, as `checkOwnPassword` is handed one.
*/
async function signedIn() {
  const { auth } = instance();
  const { email, userId } = await signUp(auth);
  const headers = new Headers({ cookie: await signIn(auth, email) });
  return { auth, userId, headers };
}

const wrong = ["not", "the", "password", "at", "all"].join("-");

function tryPassword(auth: Auth, email: string, attempt: string) {
  return auth.handler(post("sign-in/email", { email, password: attempt }));
}

/**
The address's sign-in count, or nothing once it is cleared.
*/
async function triesOf(email: string): Promise<number | undefined> {
  const ofAddress = and(
    eq(rateLimits.kind, "sign-in"),
    eq(rateLimits.subject, email.toLowerCase()),
  );
  const [row] = await db
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(ofAddress);
  return row?.count;
}

describe("email sign-in's tries per typed address", () => {
  it("refuses even the right password once the wrong ones reach the limit", async () => {
    const { auth } = instance();
    const { email, userId } = await signUp(auth);
    for (let n = 0; n < SIGN_IN_TRIES; n += 1) {
      const refused = await tryPassword(auth, email, wrong);
      expect(refused.status).toBe(401);
    }

    const before = nowSeconds();
    const limited = await tryPassword(auth, email, password);

    expect(limited.status).toBe(429);
    const body = z
      .object({ code: z.string(), until: z.number() })
      .parse(await limited.json());
    expect(body.code).toBe(SIGN_IN_LIMITED_CODE);
    expect(body.until).toBeGreaterThanOrEqual(before + SIGN_IN_WINDOW_S - 5);
    expect(body.until).toBeLessThanOrEqual(nowSeconds() + SIGN_IN_WINDOW_S);
    const sessions = await db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, userId));
    expect(sessions).toEqual([]);
  });

  it("counts the address however it is typed", async () => {
    const { auth } = instance();
    const { email } = await signUp(auth);
    for (let n = 0; n < SIGN_IN_TRIES; n += 1) {
      await tryPassword(auth, n % 2 === 0 ? email : email.toUpperCase(), wrong);
    }
    expect(await triesOf(email)).toBe(SIGN_IN_TRIES);
    const limited = await tryPassword(auth, email.toUpperCase(), password);
    expect(limited.status).toBe(429);
  });

  it("counts an address with no account the same way", async () => {
    const { auth } = instance();
    const nobody = `nobody-${newUlid().toLowerCase()}@example.com`;
    for (let n = 0; n < SIGN_IN_TRIES; n += 1) {
      const refused = await tryPassword(auth, nobody, wrong);
      expect(refused.status).toBe(401);
    }
    const limited = await tryPassword(auth, nobody, wrong);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: SIGN_IN_LIMITED_CODE });
  });

  it("starts again from none after a sign-in that works", async () => {
    const { auth } = instance();
    const { email } = await signUp(auth);
    for (let n = 0; n < SIGN_IN_TRIES - 1; n += 1) {
      await tryPassword(auth, email, wrong);
    }
    expect(await triesOf(email)).toBe(SIGN_IN_TRIES - 1);

    const signedIn = await tryPassword(auth, email, password);

    expect(signedIn.status).toBe(200);
    expect(await triesOf(email)).toBeUndefined();
    const next = await tryPassword(auth, email, wrong);
    expect(next.status).toBe(401);
    expect(await triesOf(email)).toBe(1);
  });

  it("keeps the count after a wrong password", async () => {
    const { auth } = instance();
    const { email } = await signUp(auth);
    await tryPassword(auth, email, wrong);
    await tryPassword(auth, email, wrong);
    expect(await triesOf(email)).toBe(2);
  });

  it("answers a typed string that is not an address 400, and counts nothing", async () => {
    const { auth } = instance();
    const typed = "a".repeat(5000);
    const refused = await auth.handler(
      post("sign-in/email", { email: typed, password }),
    );
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ code: "INVALID_EMAIL" });
    expect(await triesOf(typed)).toBeUndefined();
  });

  it(`counts an address of ${String(ADDRESS_MAX)} characters, and refuses a longer one`, async () => {
    const { auth } = instance();
    const domain = `@${newUlid().toLowerCase()}.example.com`;
    const longest = `${"a".repeat(ADDRESS_MAX - domain.length)}${domain}`;
    const tooLong = `b${longest}`;
    expect(longest).toHaveLength(ADDRESS_MAX);

    const counted = await tryPassword(auth, longest, wrong);
    expect(counted.status).toBe(401);
    expect(await triesOf(longest)).toBe(1);

    const refused = await tryPassword(auth, tooLong, wrong);
    expect(refused.status).toBe(400);
    expect(await triesOf(tooLong)).toBeUndefined();
  });

  it("counts nothing for a body with no address", async () => {
    const { auth } = instance();
    const before = await db.select({ kind: rateLimits.kind }).from(rateLimits);
    const refused = await auth.handler(post("sign-in/email", { password }));
    expect(refused.status).toBe(400);
    const after = await db.select({ kind: rateLimits.kind }).from(rateLimits);
    expect(after).toHaveLength(before.length);
  });
});

describe("checkOwnPassword (tries at the current password, limited)", () => {
  const NOW = 1_800_000_000;

  it(`refuses the try after ${String(PASSWORD_ATTEMPTS_PER_WINDOW)} wrong ones, even with the right password, until the window ends`, async () => {
    const check = { ...(await signedIn()), db };
    for (let n = 0; n < PASSWORD_ATTEMPTS_PER_WINDOW; n += 1) {
      expect(
        await refused("INVALID_PASSWORD", () =>
          checkOwnPassword(check, `${password}-not`, NOW + n),
        ),
      ).toStrictEqual({ status: "wrong" });
    }
    const verify = vi.spyOn(check.auth.api, "verifyPassword");
    expect(await checkOwnPassword(check, password, NOW + 10)).toStrictEqual({
      status: "limited",
      until: NOW + PASSWORD_ATTEMPT_WINDOW_S,
    });
    // Past the limit the password is never put to Better Auth at all.
    expect(verify).not.toHaveBeenCalled();
    verify.mockRestore();

    expect(
      await checkOwnPassword(check, password, NOW + PASSWORD_ATTEMPT_WINDOW_S),
    ).toStrictEqual({ status: "own" });
  });

  it("clears the count on the right password, and counts per runner", async () => {
    const check = { ...(await signedIn()), db };
    const other = { ...(await signedIn()), db };
    for (let n = 0; n < PASSWORD_ATTEMPTS_PER_WINDOW - 1; n += 1) {
      await refused("INVALID_PASSWORD", () =>
        checkOwnPassword(check, `${password}-not`, NOW),
      );
    }
    expect(await checkOwnPassword(other, password, NOW)).toStrictEqual({
      status: "own",
    });
    expect(await checkOwnPassword(check, password, NOW)).toStrictEqual({
      status: "own",
    });
    expect(
      await db
        .select()
        .from(passwordAttempts)
        .where(eq(passwordAttempts.userId, check.userId)),
    ).toStrictEqual([]);
    for (let n = 0; n < PASSWORD_ATTEMPTS_PER_WINDOW; n += 1) {
      expect(
        await refused("INVALID_PASSWORD", () =>
          checkOwnPassword(check, `${password}-not`, NOW + 1),
        ),
      ).toStrictEqual({ status: "wrong" });
    }
  });
});

/**
Whether this password signs the runner in now.
*/
async function canSignInWith(auth: Auth, userId: string, secret: string) {
  const [row] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId));
  const response = await refused("INVALID_EMAIL_OR_PASSWORD", () =>
    auth.handler(
      post("sign-in/email", { email: row?.email, password: secret }),
    ),
  );
  return response.status === 200;
}

describe("Better Auth's change-password endpoint over HTTP (R-124)", () => {
  it("is not there, so the per-runner count cannot be gone round, while the server's own call still changes it", async () => {
    const { auth } = instance();
    const { email, userId } = await signUp(auth);
    const cookie = await signIn(auth, email);
    const next = ["an", "http", "long", "passphrase"].join("-");

    const response = await auth.handler(
      post(
        "change-password",
        { currentPassword: password, newPassword: next },
        cookie,
      ),
    );

    expect(response.status).toBe(404);
    expect(await canSignInWith(auth, userId, password)).toBe(true);
    expect(await canSignInWith(auth, userId, next)).toBe(false);

    await auth.api.changePassword({
      body: { currentPassword: password, newPassword: next },
      headers: new Headers({ cookie }),
    });
    expect(await canSignInWith(auth, userId, next)).toBe(true);
  });
});

describe("Better Auth's verify-password endpoint over HTTP", () => {
  it("is not there, while the server's own check still answers", async () => {
    const { auth } = instance();
    const { email } = await signUp(auth);
    const cookie = await signIn(auth, email);

    for (const guess of ["not-the-password-at-all", password]) {
      const response = await auth.handler(
        post("verify-password", { password: guess }, cookie),
      );
      expect(response.status).toBe(404);
    }

    const headers = new Headers({ cookie });
    expect(await isOwnPassword(auth, headers, password)).toBe(true);
    expect(
      await refused("INVALID_PASSWORD", () =>
        isOwnPassword(auth, headers, "not-the-password-at-all"),
      ),
    ).toBe(false);
  });
});

describe("changeOwnPassword (ACC-7 within the per-runner limit, R-124)", () => {
  const NOW = 1_800_000_000;
  const next = ["a", "fresh", "long", "passphrase"].join("-");
  const values = (currentPassword: string) => ({
    currentPassword,
    password: next,
  });

  it("changes it through Better Auth under the limit, ends every other session and clears the count", async () => {
    const check = { ...(await signedIn()), db };
    const [row] = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, check.userId));
    await signIn(check.auth, row?.email ?? "");
    expect(await sessionsOf(check.userId)).toBe(2);
    await refused("INVALID_PASSWORD", () =>
      changeOwnPassword(check, values(`${password}-not`), NOW),
    );

    expect(await changeOwnPassword(check, values(password), NOW)).toStrictEqual(
      { status: "changed" },
    );

    // Better Auth ends them all and makes this request a new one.
    expect(await sessionsOf(check.userId)).toBe(1);
    expect(await canSignInWith(check.auth, check.userId, next)).toBe(true);
    expect(await canSignInWith(check.auth, check.userId, password)).toBe(false);
    expect(
      await db
        .select()
        .from(passwordAttempts)
        .where(eq(passwordAttempts.userId, check.userId)),
    ).toStrictEqual([]);
  });

  it(`refuses after ${String(PASSWORD_ATTEMPTS_PER_WINDOW)} wrong tries, before Better Auth is asked, even with the right password`, async () => {
    const check = { ...(await signedIn()), db };
    for (let n = 0; n < PASSWORD_ATTEMPTS_PER_WINDOW; n += 1) {
      expect(
        await refused("INVALID_PASSWORD", () =>
          changeOwnPassword(check, values(`${password}-not`), NOW + n),
        ),
      ).toStrictEqual({ status: "wrong" });
    }
    const change = vi.spyOn(check.auth.api, "changePassword");

    expect(
      await changeOwnPassword(check, values(password), NOW + 10),
    ).toStrictEqual({
      status: "limited",
      until: NOW + PASSWORD_ATTEMPT_WINDOW_S,
    });

    expect(change).not.toHaveBeenCalled();
    change.mockRestore();
    expect(await canSignInWith(check.auth, check.userId, password)).toBe(true);
  });

  it("lands a breached new password as breached, and changes nothing", async () => {
    const { auth } = instance({
      passwordScreen: {
        verdict: (candidate) =>
          Promise.resolve(candidate === next ? "breached" : "clean"),
        report: () => {
          // a breached verdict is an answer, not a failure
        },
      },
    });
    const { email, userId } = await signUp(auth);
    const check = {
      auth,
      db,
      userId,
      headers: new Headers({ cookie: await signIn(auth, email) }),
    };

    expect(
      await refused("PASSWORD_BREACHED", () =>
        changeOwnPassword(check, values(password), NOW),
      ),
    ).toStrictEqual({ status: "breached" });
    expect(await canSignInWith(auth, userId, password)).toBe(true);
  });

  it.each([
    ["a refusal with another code", new APIError("BAD_REQUEST", { code: "X" })],
    ["a refusal with no body", new APIError("BAD_REQUEST")],
    [
      "something that only looks like a breach",
      Object.assign(new Error("not Better Auth's"), {
        body: { code: "PASSWORD_BREACHED" },
      }),
    ],
  ])("rethrows %s, rather than answering", async (_, thrown) => {
    // A fake stands in for `auth`: no real endpoint throws these here.
    const fakeAuth = {
      api: {
        verifyPassword: () => Promise.resolve({ status: true }),
        changePassword: () => Promise.reject(thrown),
      },
    };
    const check = {
      auth: fakeAuth,
      db,
      userId: newUlid(),
      headers: new Headers(),
    };
    await expect(changeOwnPassword(check, values(password), NOW)).rejects.toBe(
      thrown,
    );
  });
});

describe("Sign out everywhere (ACC-7)", () => {
  it("ends every session of the runner's through the real endpoint, the others included", async () => {
    const { auth } = instance();
    const { email, userId } = await signUp(auth);
    const here = await signIn(auth, email);
    const elsewhere = await signIn(auth, email);
    const bystander = await signUp(auth);
    await signIn(auth, bystander.email);
    expect(await sessionsOf(userId)).toBe(2);

    const response = await auth.handler(post("revoke-sessions", {}, here));

    expect(response.status).toBe(200);
    expect(await sessionsOf(userId)).toBe(0);
    // The other device's cookie no longer opens a session.
    const stale = await auth.api.getSession({
      headers: new Headers({ cookie: elsewhere }),
    });
    expect(stale).toBeNull();
    // Nobody else was signed out.
    expect(await sessionsOf(bystander.userId)).toBe(1);
  });
});

describe("isOwnPassword (ACC-8's current password)", () => {
  it("is Better Auth's own answer: the account's password matches, another does not", async () => {
    const { auth } = instance();
    const { email } = await signUp(auth);
    const headers = new Headers({ cookie: await signIn(auth, email) });

    expect(await isOwnPassword(auth, headers, password)).toBe(true);
    expect(
      await refused("INVALID_PASSWORD", () =>
        isOwnPassword(auth, headers, `${password}-not`),
      ),
    ).toBe(false);
  });

  it("throws, rather than answering no, when nobody is signed in", async () => {
    const { auth } = instance();
    await expect(
      isOwnPassword(auth, new Headers(), password),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rethrows a refusal that carries no body at all, rather than answering no", async () => {
    // Better Auth's own refusals always carry a body, but the type this
    // file reads from (`error.body?.code`) allows for one that does not —
    // `APIError`'s own constructor takes `body` as optional. A fake stands
    // in for `auth` here because no real endpoint leaves it unset.
    const bodyless = new APIError("BAD_REQUEST");
    const fakeAuth = {
      api: {
        verifyPassword: () => Promise.reject(bodyless),
      },
    };
    await expect(isOwnPassword(fakeAuth, new Headers(), password)).rejects.toBe(
      bodyless,
    );
  });
});

/**
The background a request hands its sends to, collected so a test can wait.
*/
function background() {
  const work: Promise<unknown>[] = [];
  return {
    handler: (promise: Promise<unknown>) => {
      work.push(promise);
    },
    work,
    settled: async () => {
      await Promise.all(work);
    },
  };
}

describe("no email on the request path (timing)", () => {
  it("answers a reset request before its email is asked for, account or not", async () => {
    const later = background();
    const { auth, mail } = instance({ background: later.handler });
    const { email } = await signUp(auth);
    await later.settled();
    mail.calls.length = 0;

    await auth.api.requestPasswordReset({ body: { email } });
    await auth.api.requestPasswordReset({
      body: { email: "nobody-here@example.com" },
    });

    // Handed to the background, not awaited: nothing asked for yet.
    expect(later.work.length).toBeGreaterThan(0);
    await later.settled();
    expect(mail.calls.map((call) => [call.kind, call.email])).toStrictEqual([
      ["resetPassword", email],
    ]);
  });

  it("answers a sign-up before its confirm link is asked for", async () => {
    const later = background();
    const newAccount = Promise.withResolvers<undefined>();
    const { auth } = instance({
      background: later.handler,
      mail: {
        ...recordingMail(),
        // Never settles until the test says so: an awaited send would
        // hold the answer back.
        newAccount: () => newAccount.promise,
      },
    });
    const email = `slow-${newUlid().toLowerCase()}@example.com`;

    const response = await auth.handler(
      post("sign-up/email", { name: "", email, password }),
    );

    expect(response.status).toBe(200);
    expect(later.work).toHaveLength(1);
    newAccount.resolve(undefined);
    await later.settled();
  });

  it("awaits the sends when there is no background to hand them to", async () => {
    const { auth, mail } = instance();
    const email = `awaited-${newUlid().toLowerCase()}@example.com`;
    await auth.handler(post("sign-up/email", { name: "", email, password }));
    expect(mail.calls).toStrictEqual([{ kind: "newAccount", email }]);
  });
});
