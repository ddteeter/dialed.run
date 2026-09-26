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

describe("the app auth instance", () => {
  it("is configured, not empty", () => {
    // Not the secret: the test bindings set none, which is itself the
    // reason `create-auth.ts` takes it as a parameter.
    expect(typeof auth.options.database).toBe("function");
    expect(auth.options.emailAndPassword).toStrictEqual({
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
    });
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
