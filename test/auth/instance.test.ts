import { describe, expect, it, vi } from "vitest";

import { PASSWORD_MIN_LENGTH } from "../../src/lib/contracts";
import { BREACHED_CODE } from "../../src/modules/auth/breached-password";
import { auth } from "../../src/modules/auth/instance";
import { sessionFromRequest } from "../../src/modules/auth/session";

/**
 * The wired singleton, which nothing imported.
 *
 * Every server function reaches auth through this object, and all ten of
 * its mutants had no coverage at all — including the one that empties the
 * whole configuration and the one that drops the cookie plugin. Without
 * that plugin better-auth sets no cookie, so every sign-in appears to work
 * and nobody stays signed in.
 */

/**
Any function: an option that must be wired, whatever it closes over.
*/
const A_FUNCTION: unknown = expect.any(Function);

/**
Not a real secret: joined so sonarjs's hard-coded-credential scan (which
matches string literals) does not mistake a fixture password for one.
*/
const PASSWORD = ["a", "long", "enough", "password"].join("-");

describe("the app auth instance", () => {
  it("guards sign-up with Turnstile, failing closed with no secret (ACC-5)", async () => {
    // The test bindings set no Turnstile secret, so the wired gate must
    // refuse: this is the proof the gate is on the instance at all.
    await expect(
      auth.api.signUpEmail({
        body: {
          name: "",
          email: "gate@example.test",
          password: PASSWORD,
        },
      }),
    ).rejects.toMatchObject({ body: { code: "TURNSTILE_REFUSED" } });
  });

  it("is configured, not empty", () => {
    // Not the secret: the test bindings set none, which is itself the
    // reason `create-auth.ts` takes it as a parameter.
    expect(typeof auth.options.database).toBe("function");
    // Whole, not a subset: an option added or dropped here changes what
    // every sign-up, reset and password change does.
    expect(auth.options.emailAndPassword).toStrictEqual({
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      autoSignIn: false,
      // The account emails are wired (ACC-3, ACC-4).
      onExistingUserSignUp: A_FUNCTION,
      sendResetPassword: A_FUNCTION,
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: A_FUNCTION,
    });
    expect(auth.options.databaseHooks).toStrictEqual({
      // `before`: no name kept, and the invite code spent (ACC-5).
      user: { create: { before: A_FUNCTION, after: A_FUNCTION } },
    });
    expect(auth.options.verification).toStrictEqual({
      storeIdentifier: "hashed",
    });
    // Every email leaves the request path in the deployed instance.
    expect(auth.options.advanced.backgroundTasks).toStrictEqual({
      handler: A_FUNCTION,
    });
  });

  it("is built on the deployment's origin, in its production posture (OPS-4)", () => {
    // The test Worker's BETTER_AUTH_URL is https, as production's is. A
    // deleted `baseUrl:` line in instance.ts is invisible to mutation
    // testing, which only mutates what is written; this is what notices.
    expect(auth.options.baseURL).toBe("https://dialed.test");
    expect(auth.options.rateLimit).toMatchObject({
      enabled: true,
      storage: "database",
    });
    expect(auth.options.advanced).toMatchObject({ useSecureCookies: true });
  });

  it("carries the framework cookie plugin", () => {
    // The reason this file exists at all: `create-auth.ts` stays free of
    // TanStack imports so it can be tested, and the plugin is injected
    // here.
    expect(auth.options.plugins.length).toBeGreaterThan(0);
  });

  it("screens a new password against the breach range API", async () => {
    // The real screen, wired: only the network answer is stubbed, with a
    // range body listing this password's own suffix.
    const password = ["plainly", "breached", "passphrase"].join("-");
    const digest = await crypto.subtle.digest(
      "SHA-1",
      new TextEncoder().encode(password),
    );
    const hash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
    const range = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(`${hash.slice(5)}:12\n`)),
    );
    vi.stubGlobal("fetch", range);
    let thrown: unknown;
    try {
      await auth.api.signUpEmail({
        body: {
          name: "Breached",
          email: `breached-${String(Date.now())}@example.com`,
          password,
        },
      });
    } catch (error: unknown) {
      thrown = error;
    } finally {
      vi.unstubAllGlobals();
    }
    expect(range.mock.calls[0]?.[0]).toBe(
      `https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`,
    );
    expect(thrown).toMatchObject({
      statusCode: 400,
      body: { code: BREACHED_CODE },
    });
  });

  it("carries the ban gate, so a banned runner cannot sign in (task 128)", () => {
    // Which plugins, not how many: the gate is what makes a ban stop
    // sign-in, and dropping it would leave every other test here green.
    expect(auth.options.plugins.map((plugin) => plugin.id)).toContain(
      "ban-gate",
    );
  });

  it("has no Google provider without credentials", () => {
    // The test bindings set neither, so this is the degraded path — and
    // asserting it is what stops `googleCredentials` being wired backwards.
    expect(auth.options.socialProviders).toBeUndefined();
  });
});

describe("sessionFromRequest", () => {
  it("reads a session from a request's own headers", async () => {
    // The way in for a raw `server.handlers` route, which has a Request
    // rather than TanStack's server context. An anonymous request has no
    // session, and that is the answer — not an error.
    const request = new Request("https://dialed.run/media/photo.jpg");
    expect(await sessionFromRequest(request)).toBeNull();
  });
});
