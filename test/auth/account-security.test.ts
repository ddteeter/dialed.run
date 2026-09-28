import process from "node:process";

import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { session, user, verification } from "../../src/db/schema-auth";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { createAuth } from "../../src/modules/auth/create-auth";
import { isOwnPassword } from "../../src/modules/auth/password-check";
import { recordingMail } from "./mail-recorder";

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
    await expect(
      isOwnPassword(fakeAuth, new Headers(), password),
    ).rejects.toBe(bodyless);
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
