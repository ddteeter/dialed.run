import { APIError } from "better-auth/api";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { verification } from "../../src/db/schema-auth";
import { env } from "../../src/env";
import { createAuth } from "../../src/modules/auth/create-auth";
import {
  holdSocialBody,
  RETURN_PATH_MAX,
  SOCIAL_BODY_REFUSED,
} from "../../src/modules/auth/social-body";
import { recordingMail } from "./mail-recorder";
import { OPEN_ACCESS } from "./open-access";

/**
 * A Google press's body: the app's own five fields pass to Better Auth,
 * and anything else is answered 400 before it, with no row written.
 */

const db = drizzle(env.DIALED_CORE);
const ORIGIN = "http://localhost";

const auth = createAuth({
  db,
  secret: "test-secret-not-for-production",
  baseUrl: ORIGIN,
  mail: recordingMail(),
  access: OPEN_ACCESS,
  passwordScreen: {
    verdict: () => Promise.resolve("clean" as const),
    report: () => {
      // this screen always answers
    },
  },
  google: { clientId: "test-client", clientSecret: "test-client-secret" },
});

const OWN_PRESS = {
  provider: "google",
  callbackURL: "/",
  errorCallbackURL: "/auth/login",
  disableRedirect: true,
};

function press(body: Record<string, unknown>): Promise<Response> {
  return auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify(body),
    }),
  );
}

async function stateRows(): Promise<number> {
  const rows = await db.select({ id: verification.id }).from(verification);
  return rows.length;
}

/**
The press's answer and how many state rows it added.
*/
async function pressed(
  body: Record<string, unknown>,
): Promise<{ status: number; added: number; body: unknown }> {
  const before = await stateRows();
  const response = await press(body);
  const answer: unknown = await response.json();
  return {
    status: response.status,
    added: (await stateRows()) - before,
    body: answer,
  };
}

const consent = z.object({ url: z.string() });

describe("a Google press's body", () => {
  it("passes the app's own press to Google, every field included", async () => {
    const answer = await pressed({ ...OWN_PRESS, requestSignUp: false });
    expect(answer.status).toBe(200);
    expect(answer.added).toBe(1);
    const { url } = consent.parse(answer.body);
    expect(new URL(url).hostname).toBe("accounts.google.com");
  });

  it.each([
    ["additionalData", { p: "x".repeat(1000) }],
    ["newUserCallbackURL", "/welcome"],
    ["scopes", ["https://www.googleapis.com/auth/drive.readonly"]],
    ["additionalParams", { access_type: "offline" }],
    ["loginHint", "runner@example.com"],
    ["idToken", { token: "a.b.c" }],
  ])(
    "refuses a press that also sends %s, and writes no row",
    async (field, value) => {
      const answer = await pressed({ ...OWN_PRESS, [field]: value });
      expect(answer.status).toBe(400);
      expect(answer.body).toMatchObject({ message: SOCIAL_BODY_REFUSED });
      expect(answer.added).toBe(0);
    },
  );

  it.each(["callbackURL", "errorCallbackURL"])(
    `takes a %s of ${String(RETURN_PATH_MAX)} characters and refuses a longer one`,
    async (field) => {
      const longest = `/${"a".repeat(RETURN_PATH_MAX - 1)}`;
      const taken = await pressed({ ...OWN_PRESS, [field]: longest });
      expect(taken.status).toBe(200);
      expect(taken.added).toBe(1);

      const refused = await pressed({ ...OWN_PRESS, [field]: `${longest}a` });
      expect(refused.status).toBe(400);
      expect(refused.added).toBe(0);
    },
  );

  it.each([
    ["no provider", { callbackURL: "/", disableRedirect: true }],
    [
      "a disableRedirect that is not a boolean",
      { ...OWN_PRESS, disableRedirect: "yes" },
    ],
    [
      "a requestSignUp that is not a boolean",
      { ...OWN_PRESS, requestSignUp: 1 },
    ],
  ])("refuses a press with %s", async (_case, body) => {
    const answer = await pressed(body);
    expect(answer.status).toBe(400);
    expect(answer.added).toBe(0);
  });
});

describe("holdSocialBody", () => {
  it("lets any other path's body pass", () => {
    expect(() => {
      holdSocialBody({ path: "/sign-in/email", body: { anything: 1 } });
    }).not.toThrow();
  });

  it("refuses with Better Auth's 400", () => {
    let thrown: unknown;
    try {
      holdSocialBody({ path: "/sign-in/social", body: { extra: 1 } });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(APIError);
    expect(thrown).toMatchObject({
      status: "BAD_REQUEST",
      body: { message: SOCIAL_BODY_REFUSED },
    });
  });
});
