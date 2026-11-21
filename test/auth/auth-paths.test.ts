import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it, vi } from "vitest";

import { rateLimit } from "../../src/db/schema-auth";
import { env } from "../../src/env";

import {
  answerAuthRequest,
  authPathMatcher,
  endpointPaths,
  providerSegments,
} from "../../src/modules/auth/auth-paths";
import { authRequest } from "../../src/modules/auth/auth-route";

const db = drizzle(env.DIALED_CORE);

/**
 * SA-M36: only a path Better Auth serves reaches it; anything else under
 * `/api/auth/` is answered 404 here.
 */

function endpoint(path: unknown) {
  return Object.assign(() => path, { path });
}

describe("endpointPaths", () => {
  it("reads the path of every endpoint, and skips what is not one", () => {
    expect(
      endpointPaths({
        signIn: endpoint("/sign-in/email"),
        callback: endpoint("/callback/:id"),
        noPath: () => "/no-path",
        notAPath: endpoint(7),
        notAFunction: { path: "/object" },
      }),
    ).toStrictEqual(["/sign-in/email", "/callback/:id"]);
  });
});

describe("authPathMatcher", () => {
  const isServed = authPathMatcher(
    [
      "/sign-in/email",
      "/callback/:id",
      "/callback/:id",
      "/reset-password/:token",
      "/ok",
    ],
    { id: ["google", "other"] },
  );

  it("serves a path an endpoint names, and a :name segment one of its values", () => {
    expect(isServed("/sign-in/email")).toBe(true);
    expect(isServed("/ok")).toBe(true);
    expect(isServed("/callback/google")).toBe(true);
    expect(isServed("/callback/other")).toBe(true);
  });

  it("serves no other value of a :name segment, and none of a name with no values", () => {
    for (const path of [
      "/callback/not-a-provider",
      "/callback/Google",
      `/callback/${"b".repeat(8000)}`,
      "/reset-password/abc",
      `/reset-password/${"a".repeat(8000)}`,
      "/reset-password/google",
    ]) {
      expect(isServed(path), path).toBe(false);
    }
  });

  it("takes no values by default, nor any from an object's prototype", () => {
    expect(authPathMatcher(["/callback/:id"])("/callback/google")).toBe(false);
    expect(authPathMatcher(["/x/:constructor"], { id: ["a"] })("/x/a")).toBe(
      false,
    );
  });

  it("serves nothing else", () => {
    for (const path of [
      "/sign-in",
      "/sign-in/email/extra",
      "/sign-in/other",
      "/callback/",
      "/callback",
      "/callback/google/more",
      "/OK",
      "/ok/",
      "/",
      "",
      "/anything-new",
    ]) {
      expect(isServed(path)).toBe(false);
    }
  });
});

describe("providerSegments", () => {
  it("serves a callback for each configured provider, and none without", () => {
    expect(
      providerSegments({ socialProviders: { google: {}, other: {} } }),
    ).toStrictEqual({ id: ["google", "other"] });
    expect(providerSegments({})).toStrictEqual({ id: [] });
  });
});

describe("answerAuthRequest", () => {
  const handle = vi.fn(() => Promise.resolve(new Response("handled")));
  const isServed = authPathMatcher(["/ok"]);

  it("hands a served path to the handler", async () => {
    handle.mockClear();
    const request = new Request("https://app.test/api/auth/ok");
    const answer = await answerAuthRequest(request, isServed, handle);
    expect(await answer.text()).toBe("handled");
    expect(handle).toHaveBeenCalledWith(request);
  });

  it("answers any other path 404 without the handler", async () => {
    handle.mockClear();
    for (const url of [
      "https://app.test/api/auth/not-an-endpoint",
      "https://app.test/api/authok",
      "https://app.test/api/autx/ok",
      "https://app.test/api/auth",
      "https://app.test/ok",
    ]) {
      const answer = await answerAuthRequest(
        new Request(url),
        isServed,
        handle,
      );
      expect(answer.status).toBe(404);
      expect(await answer.text()).toBe("");
    }
    expect(handle).not.toHaveBeenCalled();
  });
});

describe("authRequest", () => {
  it("serves Better Auth's own paths, read from the instance", async () => {
    const ok = await authRequest(new Request("https://app.test/api/auth/ok"));
    expect(ok.status).toBe(200);
    const second = await authRequest(
      new Request("https://app.test/api/auth/ok"),
    );
    expect(second.status).toBe(200);
  });

  it("answers a made-up parameter 404, before the limiter writes a row", async () => {
    const before = await db.select({ id: rateLimit.id }).from(rateLimit);
    for (const path of [
      `/api/auth/reset-password/${"a".repeat(8000)}`,
      "/api/auth/reset-password/abc",
      "/api/auth/callback/not-a-provider",
      // The test Worker has no Google credentials, so no provider at all.
      "/api/auth/callback/google",
    ]) {
      const answer = await authRequest(new Request(`https://app.test${path}`));
      expect(answer.status, path).toBe(404);
    }
    const after = await db.select({ id: rateLimit.id }).from(rateLimit);
    expect(after).toHaveLength(before.length);
  });

  it("answers a path it serves nothing at 404", async () => {
    const answer = await authRequest(
      new Request("https://app.test/api/auth/a-path-nobody-serves"),
    );
    expect(answer.status).toBe(404);
  });
});
