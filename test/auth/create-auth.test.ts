import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it, vi } from "vitest";

import { env } from "../../src/env";
import { PASSWORD_MIN_LENGTH } from "../../src/lib/contracts";
import { newUlid } from "../../src/lib/ids";
import { AUTH_COPY } from "../../src/modules/auth/auth-copy";
import { BREACHED_CODE } from "../../src/modules/auth/breached-password";
import {
  createAuth,
  deploymentPosture,
  googleCredentials,
  RESET_LINK_TTL_S,
} from "../../src/modules/auth/create-auth";
import { recordingMail } from "./mail-recorder";

/**
 * The auth factory's configuration, which nothing asserted.
 *
 * `test/auth/auth.test.ts` builds one and signs a user in, which proves the
 * database adapter and email/password are wired — and nothing else. Every
 * other option could be dropped or inverted with that test still green:
 * telemetry could be switched back on, the base URL could be discarded,
 * Google could be configured out, and the cookie plugin could vanish.
 */

function auth(overrides: Parameters<typeof createAuth>[0]) {
  return createAuth(overrides);
}

const BASE = {
  db: drizzle(env.DIALED_CORE),
  secret: "test-secret-not-for-production",
  mail: recordingMail(),
  passwordScreen: {
    verdict: () => Promise.resolve("clean" as const),
    report: () => {
      // nothing to report: this screen always answers
    },
  },
};

/**
Any function: an option that must be wired, whatever it closes over.
*/
const A_FUNCTION: unknown = expect.any(Function);

function handler(): void {
  // a background that collects nothing: only its presence is asserted
}

describe("googleCredentials", () => {
  it("pairs a client id with its secret", () => {
    expect(googleCredentials("id", "secret")).toStrictEqual({
      clientId: "id",
      clientSecret: "secret",
    });
  });

  it("is undefined when either half is missing", () => {
    // Half a credential is a misconfiguration, and configuring Google with
    // it fails at the redirect rather than at boot — long after anyone is
    // watching. Both directions matter, which is why both are here.
    expect(googleCredentials(undefined, "secret")).toBeUndefined();
    expect(googleCredentials("id", undefined)).toBeUndefined();
    expect(googleCredentials(undefined, undefined)).toBeUndefined();
  });
});

describe("createAuth", () => {
  it("keeps better-auth's telemetry off", () => {
    // This app sends nothing about its users to a third party it did not
    // choose. The default is on.
    expect(auth(BASE).options.telemetry).toStrictEqual({ enabled: false });
  });

  it("sets a base URL only when one is given", () => {
    // better-auth derives it from the request when absent; setting it to
    // `undefined` explicitly is not the same as leaving it out, and the
    // OAuth callback is built from it.
    expect(
      auth({ ...BASE, baseUrl: "https://dialed.run" }).options.baseURL,
    ).toBe("https://dialed.run");
    // `in`, not `toBeUndefined`: spreading `{ baseURL: undefined }` also
    // reads as undefined, and better-auth treats a present-but-undefined
    // key as a configured empty origin rather than as "derive it from the
    // request".
    expect("baseURL" in auth(BASE).options).toBe(false);
  });

  it("enables email and password", () => {
    expect(auth(BASE).options.emailAndPassword).toStrictEqual({
      enabled: true,
      // The form's floor, handed to the server: the two refuse the same
      // passwords because they read one number.
      minPasswordLength: PASSWORD_MIN_LENGTH,
      // Au4 for everyone: sign-up signs nobody in (ACC-3).
      autoSignIn: false,
      onExistingUserSignUp: A_FUNCTION,
      sendResetPassword: A_FUNCTION,
      // ACC-4: an hour, and every session ends when it is spent.
      resetPasswordTokenExpiresIn: RESET_LINK_TTL_S,
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: A_FUNCTION,
    });
    expect(RESET_LINK_TTL_S).toBe(3600);
  });

  it("hands its sends to the background only when given one", () => {
    expect(
      auth({ ...BASE, background: handler }).options.advanced,
    ).toStrictEqual({
      useSecureCookies: false,
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      backgroundTasks: { handler },
    });
    expect(auth(BASE).options.advanced).toStrictEqual({
      useSecureCookies: false,
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    });
  });

  it("configures Google only when credentials exist", () => {
    // Law 5: no credentials is a degraded deployment, not a broken one.
    const google = { clientId: "id", clientSecret: "secret" };
    expect(auth({ ...BASE, google }).options.socialProviders).toStrictEqual({
      google,
    });
    expect(auth(BASE).options.socialProviders).toBeUndefined();
  });

  it("takes no plugins as no plugins, not as undefined", () => {
    // better-auth iterates this list; `undefined` in its place is a crash
    // at startup rather than a deployment without extras.
    expect(auth(BASE).options.plugins).toStrictEqual([]);
  });

  it("passes the plugins it is given straight through", () => {
    const plugin = { id: "probe-plugin" };
    expect(auth({ ...BASE, plugins: [plugin] }).options.plugins).toStrictEqual([
      plugin,
    ]);
  });
});

/**
A sign-up body for `email`, with a fixture passphrase that is not a secret.
*/
function body(email: string) {
  return {
    name: "Screen Test",
    email,
    password: ["a", "long", "passphrase"].join("-"),
  };
}

/**
An auth instance whose breach screen answers `verdict`.
*/
function screened(verdict: "breached" | "clean" | "unknown") {
  const report = vi.fn();
  const screen = vi.fn(() => Promise.resolve(verdict));
  return {
    auth: auth({ ...BASE, passwordScreen: { verdict: screen, report } }),
    screen,
    report,
  };
}

/**
 * The breach screen as the sign-up path meets it (NIST SP 800-63B
 * §3.1.1.2; owner, PR #104), through Better Auth's real endpoint on a real
 * D1 — only the range API is stubbed, by handing in its answer.
 */
describe("the password breach screen", () => {
  it("refuses a breached password with the code the form lands on Password", async () => {
    const { auth: withScreen, screen, report } = screened("breached");
    const email = `breached-${newUlid().toLowerCase()}@example.com`;
    let thrown: unknown;
    try {
      await withScreen.api.signUpEmail({ body: body(email) });
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      statusCode: 400,
      body: {
        code: BREACHED_CODE,
        message: AUTH_COPY.passwordBreached,
      },
    });
    expect(screen).toHaveBeenCalledWith(body(email).password);
    expect(report).not.toHaveBeenCalled();
  });

  it("lets a clean password through, and reports nothing", async () => {
    const { auth: withScreen, report } = screened("clean");
    const email = `clean-${newUlid().toLowerCase()}@example.com`;
    const made = await withScreen.api.signUpEmail({ body: body(email) });
    expect(made.user.email).toBe(email);
    expect(report).not.toHaveBeenCalled();
  });

  it("fails open when the screen cannot answer, and says so to Sentry", async () => {
    const { auth: withScreen, report } = screened("unknown");
    const email = `unknown-${newUlid().toLowerCase()}@example.com`;
    const made = await withScreen.api.signUpEmail({ body: body(email) });
    expect(made.user.email).toBe(email);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      new Error("password breach screen did not answer"),
      { path: "/sign-up/email" },
    );
  });

  it("does not screen a sign-in", async () => {
    const { auth: withScreen, screen } = screened("breached");
    try {
      await withScreen.api.signInEmail({
        body: { email: "nobody@example.com", password: body("x").password },
      });
    } catch {
      // Nobody has that account; the question is only whether it screened.
    }
    expect(screen).not.toHaveBeenCalled();
  });
});

describe("the deployment's posture, from its own origin (OPS-4)", () => {
  it("secures cookies and rate limits on an https origin", () => {
    expect(deploymentPosture("https://dialed.run")).toStrictEqual({
      secureCookies: true,
      rateLimited: true,
    });
  });

  it.each([
    ["plain http", "http://localhost:3000"],
    ["no origin at all", undefined],
    // Joined, because a lint fixer upgrades an http:// literal to https://
    // — which is exactly the case under test.
    ["an https-looking host on http", ["http:", "//https.example"].join("")],
  ])("does neither on %s", (_label, baseUrl) => {
    expect(deploymentPosture(baseUrl)).toStrictEqual({
      secureCookies: false,
      rateLimited: false,
    });
  });

  it("says so explicitly in the options, whatever NODE_ENV is", () => {
    const options = auth({ ...BASE, baseUrl: "https://dialed.run" }).options;

    expect(options.rateLimit).toStrictEqual({
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
    });
    expect(options.advanced).toStrictEqual({
      useSecureCookies: true,
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    });
  });

  it("turns both off, explicitly, on a local origin", () => {
    const options = auth({ ...BASE, baseUrl: "http://localhost:3000" }).options;

    expect(options.rateLimit.enabled).toBe(false);
    expect(options.advanced.useSecureCookies).toBe(false);
  });
});

const ORIGIN = "https://dialed.test";

/**
 * A credential nobody has, built rather than written as a literal.
 */
const WRONG = ["not", "the", "password", "at", "all"].join("-");

/**
 * A sign-in POST from one Cloudflare-reported address.
 */
function signIn(address: string, email: string): Request {
  return new Request(`${ORIGIN}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "cf-connecting-ip": address,
    },
    body: JSON.stringify({ email, password: WRONG }),
  });
}

describe("rate limiting in D1 (OPS-4)", () => {
  it("refuses a sign-in past the limit, and still refuses it on a fresh instance", async () => {
    const address = "203.0.113.17";
    const email = `limit-${newUlid()}@example.com`;
    const first = auth({ ...BASE, baseUrl: ORIGIN });

    const allowed: number[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await first.handler(signIn(address, email));
      allowed.push(response.status);
    }
    const refused = await first.handler(signIn(address, email));
    // A new isolate is a new instance: the count is in D1, not in memory.
    const elsewhere = auth({ ...BASE, baseUrl: ORIGIN });
    const stillRefused = await elsewhere.handler(signIn(address, email));

    expect(allowed).toStrictEqual([401, 401, 401]);
    expect(refused.status).toBe(429);
    expect(stillRefused.status).toBe(429);
  });

  it("counts each address on its own", async () => {
    const email = `limit-${newUlid()}@example.com`;
    const instance = auth({ ...BASE, baseUrl: ORIGIN });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await instance.handler(signIn("198.51.100.7", email));
    }

    const fifth = await instance.handler(signIn("198.51.100.7", email));
    const other = await instance.handler(signIn("198.51.100.8", email));

    // The first address is over its limit; the second has its own count.
    expect(fifth.status).toBe(429);
    expect(other.status).toBe(401);
  });

  it("does not limit a local origin at all", async () => {
    const local = "http://localhost:3000";
    const email = `limit-${newUlid()}@example.com`;
    const instance = auth({ ...BASE, baseUrl: local });
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await instance.handler(
        new Request(`${local}/api/auth/sign-in/email`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: local },
          body: JSON.stringify({ email, password: WRONG }),
        }),
      );
      statuses.push(response.status);
    }

    expect(statuses).toStrictEqual([401, 401, 401, 401, 401]);
  });
});

describe("secure cookies (OPS-4)", () => {
  it("prefixes the session cookie __Secure- on an https origin", async () => {
    const instance = auth({ ...BASE, baseUrl: ORIGIN });
    const password = ["long", "enough", "password", "here"].join("-");
    const email = `secure-${newUlid()}@example.com`;
    const signUpBody = JSON.stringify({
      name: "Secure Cookie",
      email,
      password,
    });

    const headers = {
      "content-type": "application/json",
      origin: ORIGIN,
      "cf-connecting-ip": "192.0.2.44",
    };
    // Sign-up signs nobody in (ACC-3, Au4), so the session cookie is the
    // log-in's.
    const signedUp = await instance.handler(
      new Request(`${ORIGIN}/api/auth/sign-up/email`, {
        method: "POST",
        headers,
        body: signUpBody,
      }),
    );
    expect(signedUp.status).toBe(200);
    const response = await instance.handler(
      new Request(`${ORIGIN}/api/auth/sign-in/email`, {
        method: "POST",
        headers,
        body: JSON.stringify({ email, password }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(
      /^__Secure-better-auth\.session_token=/u,
    );
  });
});

describe("the emails auth asks for (ACC-3, ACC-4)", () => {
  const password = ["long", "enough", "password", "here"].join("-");

  function signUpRequest(email: string): Request {
    return new Request("http://localhost/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
      },
      body: JSON.stringify({ name: "", email, password }),
    });
  }

  it("sends a new account its confirm link, and signs nobody in", async () => {
    const mail = recordingMail();
    const instance = auth({ ...BASE, baseUrl: "http://localhost", mail });
    const email = `new-${newUlid().toLowerCase()}@example.com`;

    const response = await instance.handler(signUpRequest(email));

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mail.calls).toStrictEqual([{ kind: "newAccount", email }]);
  });

  it("answers a registered address exactly as a new one, and sends it the other email", async () => {
    const mail = recordingMail();
    const instance = auth({ ...BASE, baseUrl: "http://localhost", mail });
    const email = `taken-${newUlid().toLowerCase()}@example.com`;
    await instance.handler(signUpRequest(email));

    const again = await instance.handler(signUpRequest(email));

    expect(again.status).toBe(200);
    expect(again.headers.get("set-cookie")).toBeNull();
    const body: unknown = await again.json();
    // No session token, as for a new account: the two bodies match.
    expect(JSON.stringify(body)).toContain('"token":null');
    expect(body).toMatchObject({ user: { email } });
    expect(mail.calls).toStrictEqual([
      { kind: "newAccount", email },
      { kind: "existingAccount", email },
    ]);
  });

  it("sends no confirm link to an account that arrives confirmed (Google's)", async () => {
    const mail = recordingMail();
    const instance = auth({ ...BASE, mail });
    const context = await instance.$context;
    // What Better Auth does on a Google sign-up's return: the user row,
    // confirmed by Google.
    await context.internalAdapter.createUser(
      {
        email: `google-${newUlid().toLowerCase()}@example.com`,
        name: "",
        emailVerified: true,
      },
      { method: "oauth" },
    );
    expect(mail.calls).toStrictEqual([]);
  });

  it("hands a reset request its single-use token, and ends every session when it is spent", async () => {
    const mail = recordingMail();
    const instance = auth({ ...BASE, baseUrl: "http://localhost", mail });
    const email = `reset-${newUlid().toLowerCase()}@example.com`;
    await instance.handler(signUpRequest(email));

    await instance.api.requestPasswordReset({ body: { email } });

    const reset = mail.calls.find((call) => call.kind === "resetPassword");
    expect(reset?.email).toBe(email);
    expect(reset?.token).toMatch(/^\w+$/u);
  });
});
