import { describe, expect, it, vi } from "vitest";

import {
  answerAuthRequest,
  authPathMatcher,
  endpointPaths,
} from "../../src/modules/auth/auth-paths";
import { authRequest } from "../../src/modules/auth/auth-route";

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
  const isServed = authPathMatcher([
    "/sign-in/email",
    "/callback/:id",
    "/callback/:id",
    "/ok",
  ]);

  it("serves a path an endpoint names, and a :name segment any value", () => {
    expect(isServed("/sign-in/email")).toBe(true);
    expect(isServed("/ok")).toBe(true);
    expect(isServed("/callback/google")).toBe(true);
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

  it("answers a path it serves nothing at 404", async () => {
    const answer = await authRequest(
      new Request("https://app.test/api/auth/a-path-nobody-serves"),
    );
    expect(answer.status).toBe(404);
  });
});
