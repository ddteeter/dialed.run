import { describe, expect, it } from "vitest";

import { drizzle } from "drizzle-orm/d1";

import { env } from "../../src/env";
import { PASSWORD_MIN_LENGTH, signUpSchema } from "../../src/lib/contracts";
import { createAuth } from "../../src/modules/auth/create-auth";

/**
A breach screen that finds nothing, so these cases are about auth itself.
*/
const CLEAN_SCREEN = {
  verdict: () => Promise.resolve("clean" as const),
  report: () => {
    // nothing to report: this screen always answers
  },
};

const auth = createAuth({
  db: drizzle(env.DIALED_CORE),
  secret: "test-secret-not-for-production",
  passwordScreen: CLEAN_SCREEN,
});

const credentials = {
  name: "Drew Test",
  email: "drew@example.com",
  // Not a secret — test fixture credentials for a throwaway in-memory D1.
  password: ["correct", "horse", "battery"].join("-"),
};

describe("auth (better-auth on real D1)", () => {
  it("signs up, signs in, and rejects a wrong password", async () => {
    const signUp = await auth.api.signUpEmail({ body: credentials });
    expect(signUp.user.email).toBe(credentials.email);

    const signIn = await auth.api.signInEmail({
      body: { email: credentials.email, password: credentials.password },
    });
    expect(signIn.token).toBeTruthy();

    // Wrong password through the HTTP surface: a 401 response, no throw
    // (better-auth's api.* double-rejects internally; the handler doesn't).
    const wrongPasswordBody = JSON.stringify({
      email: credentials.email,
      password: ["not", "the", "password"].join("-"),
    });
    const signInRequest = new Request(
      "http://localhost/api/auth/sign-in/email",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
        body: wrongPasswordBody,
      },
    );
    const response = await auth.handler(signInRequest);
    expect(response.status).toBe(401);
  });

  it("refuses a nine-character password and takes a ten, as the form does", async () => {
    const short = "a".repeat(PASSWORD_MIN_LENGTH - 1);
    const enough = "a".repeat(PASSWORD_MIN_LENGTH);
    // The floor sign-up itself compares against (`sign-up.mjs` reads
    // `ctx.context.password.config.minPasswordLength`). Asserted on the
    // resolved context rather than by posting a short password: Better
    // Auth's D1 transaction wrapper leaves that refusal as an unhandled
    // rejection, which fails the run however the call is awaited.
    const context = await auth.$context;
    expect(context.password.config.minPasswordLength).toBe(PASSWORD_MIN_LENGTH);
    expect(
      signUpSchema.safeParse({
        name: "Floor",
        email: "floor-9@example.com",
        password: short,
      }).success,
    ).toBe(false);

    const taken = await auth.api.signUpEmail({
      body: { name: "Floor", email: "floor-10@example.com", password: enough },
    });
    expect(taken.user.email).toBe("floor-10@example.com");
    expect(
      signUpSchema.safeParse({
        name: "Floor",
        email: "floor-10@example.com",
        password: enough,
      }).success,
    ).toBe(true);
  });

  it("offers Google sign-in when credentials are configured", async () => {
    const authWithGoogle = createAuth({
      db: drizzle(env.DIALED_CORE),
      secret: "test-secret-not-for-production",
      passwordScreen: CLEAN_SCREEN,
      google: {
        clientId: "test-client-id.apps.googleusercontent.com",
        clientSecret: "test-client-secret",
      },
    });
    const social = await authWithGoogle.api.signInSocial({
      body: { provider: "google", callbackURL: "/" },
    });
    expect(social.url).toContain("accounts.google.com");
  });
});
