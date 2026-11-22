import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { verification } from "../../src/db/schema-auth";
import { rateLimits } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { GLOBAL_SUBJECT } from "../../src/lib/contracts/rate-limits";
import { nowSeconds } from "../../src/lib/now";
import { GOOGLE_BUSY } from "../../src/modules/auth/auth-copy";
import { createAuth } from "../../src/modules/auth/create-auth";
import {
  countSocialStart,
  holdSocialBody,
  RETURN_PATH_MAX,
  SOCIAL_BODY_REFUSED,
} from "../../src/modules/auth/social-body";
import {
  GOOGLE_STARTS_PER_HOUR,
  SEND_WINDOW_S,
} from "../../src/modules/email/rate-limit";
import { countRow } from "../rate-limit-rows";
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

const startCount = eq(rateLimits.kind, "google-start");

/**
The hour's count of Google starts, or none.
*/
async function starts(): Promise<number | undefined> {
  const [row] = await db
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(startCount);
  return row?.count;
}

describe("the hour's Google sign-in starts", () => {
  beforeEach(async () => {
    await db.delete(rateLimits).where(startCount);
  });

  it(`are ${String(GOOGLE_STARTS_PER_HOUR)} an hour, across everyone`, () => {
    expect(GOOGLE_STARTS_PER_HOUR).toBe(500);
    expect(SEND_WINDOW_S).toBe(3600);
  });

  it("count each press that starts a sign-in, under one subject", async () => {
    await pressed(OWN_PRESS);
    await pressed(OWN_PRESS);
    const [row] = await db
      .select({ subject: rateLimits.subject, count: rateLimits.count })
      .from(rateLimits)
      .where(startCount);
    expect(row).toStrictEqual({ subject: GLOBAL_SUBJECT, count: 2 });
  });

  it(`let the ${String(GOOGLE_STARTS_PER_HOUR)}th start through and refuse the next, with no row written, until the hour is over`, async () => {
    const now = nowSeconds();
    await db
      .insert(rateLimits)
      .values(
        countRow(
          "google-start",
          GLOBAL_SUBJECT,
          GOOGLE_STARTS_PER_HOUR - 1,
          now,
        ),
      );

    const last = await pressed(OWN_PRESS);
    expect(last.status).toBe(200);
    expect(last.added).toBe(1);

    const refused = await pressed(OWN_PRESS);
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ code: GOOGLE_BUSY });
    expect(refused.added).toBe(0);

    // The window began an hour ago: it is over, and the count starts again.
    await db
      .update(rateLimits)
      .set({ windowStartedAt: now - SEND_WINDOW_S })
      .where(startCount);
    const next = await pressed(OWN_PRESS);
    expect(next.status).toBe(200);
    expect(next.added).toBe(1);
    expect(await starts()).toBe(1);
  });

  // Called directly: Better Auth's 404 for a provider it lacks floats a
  // second rejection out of its dispatch.
  it("count nothing for a press naming a provider the instance does not have", async () => {
    await countSocialStart(db, [{ id: "google" }], {
      ...OWN_PRESS,
      provider: "github",
    });
    await countSocialStart(db, [], OWN_PRESS);
    expect(await starts()).toBeUndefined();

    await countSocialStart(db, [{ id: "github" }, { id: "google" }], OWN_PRESS);
    expect(await starts()).toBe(1);
  });

  it("count nothing for a refused body, or for another path", async () => {
    await pressed({ ...OWN_PRESS, loginHint: "runner@example.com" });
    await auth.handler(
      new Request(`${ORIGIN}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ email: "a@example.test", password: "x" }),
      }),
    );
    expect(await starts()).toBeUndefined();
  });
});

describe("holdSocialBody", () => {
  it("says the request is not one the app sends", () => {
    expect(SOCIAL_BODY_REFUSED).toBe("Unexpected sign-in request");
  });

  it("lets any other path's body pass, with no press", () => {
    expect(
      holdSocialBody({ path: "/sign-in/email", body: { anything: 1 } }),
    ).toBeUndefined();
  });

  it("hands back the press it lets through", () => {
    expect(
      holdSocialBody({ path: "/sign-in/social", body: OWN_PRESS }),
    ).toStrictEqual(OWN_PRESS);
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
