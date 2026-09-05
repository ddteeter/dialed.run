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

    let caught: unknown;
    try {
      await auth.api.signInEmail({
        body: { email: credentials.email, password: ["not", "the", "password"].join("-") },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toMatch(/Invalid email or password/);
  });
});
