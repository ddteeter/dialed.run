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
} from "../../src/modules/auth/create-auth";

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
  passwordScreen: {
    verdict: () => Promise.resolve("clean" as const),
    report: () => {
      // nothing to report: this screen always answers
    },
  },
};

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

    const other = await instance.handler(signIn("198.51.100.8", email));

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

    const response = await instance.handler(
      new Request(`${ORIGIN}/api/auth/sign-up/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "cf-connecting-ip": "192.0.2.44",
        },
        body: signUpBody,
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(
      /^__Secure-better-auth\.session_token=/u,
    );
  });
});
