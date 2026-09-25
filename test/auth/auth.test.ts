import { describe, expect, it } from "vitest";

import { drizzle } from "drizzle-orm/d1";

import { env } from "../../src/env";
import { PASSWORD_MIN_LENGTH, signUpSchema } from "../../src/lib/contracts";
import { createAuth } from "../../src/modules/auth/create-auth";

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

/**
Signs up through the HTTP surface, where a refusal is a status and not a throw.
*/
function signUpWith(email: string, password: string): Promise<Response> {
  return auth.handler(
    new Request("http://localhost/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
      },
      body: JSON.stringify({ name: "Floor", email, password }),
    }),
  );
}

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
    const refused = await signUpWith("floor-9@example.com", short);
    expect(refused.status).toBe(400);
    expect(
      signUpSchema.safeParse({
        name: "Floor",
        email: "floor-9@example.com",
        password: short,
      }).success,
    ).toBe(false);

    const taken = await signUpWith("floor-10@example.com", enough);
    expect(taken.status).toBe(200);
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
