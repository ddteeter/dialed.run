import { describe, expect, it } from "vitest";

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
    expect(auth.options.emailAndPassword).toStrictEqual({ enabled: true });
  });

  it("carries the framework cookie plugin", () => {
    // The reason this file exists at all: `create-auth.ts` stays free of
    // TanStack imports so it can be tested, and the plugin is injected
    // here.
    expect(auth.options.plugins.length).toBeGreaterThan(0);
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
