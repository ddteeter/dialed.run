import { describe, expect, it } from "vitest";

import { drizzle } from "drizzle-orm/d1";

import { env } from "../src/env";
import { createAuth } from "../src/modules/auth/create-auth";

const auth = createAuth({
  db: drizzle(env.DIALED_CORE),
  secret: "test-secret-not-for-production",
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

  it("offers Google sign-in when credentials are configured", async () => {
    const authWithGoogle = createAuth({
      db: drizzle(env.DIALED_CORE),
      secret: "test-secret-not-for-production",
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
