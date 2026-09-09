import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { env } from "../../src/env";
import {
  createAuth,
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
    expect(auth({ ...BASE, baseUrl: "https://dialed.run" }).options.baseURL).toBe(
      "https://dialed.run",
    );
    // `in`, not `toBeUndefined`: spreading `{ baseURL: undefined }` also
    // reads as undefined, and better-auth treats a present-but-undefined
    // key as a configured empty origin rather than as "derive it from the
    // request".
    expect("baseURL" in auth(BASE).options).toBe(false);
  });

  it("enables email and password", () => {
    expect(auth(BASE).options.emailAndPassword).toStrictEqual({ enabled: true });
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
