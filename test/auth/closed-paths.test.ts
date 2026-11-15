import { describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { CLOSED_AUTH_PATHS } from "../../src/modules/auth/closed-paths";
import { auth } from "../../src/modules/auth/instance";

/**
 * Every path Better Auth routes is a decision: open because the app uses
 * it, or closed. A Better Auth upgrade that mounts a new endpoint fails
 * here until somebody decides which.
 */
const OPEN: ReadonlyMap<string, string> = new Map([
  ["/sign-up/email", "the sign-up form (credentials.ts)"],
  ["/sign-in/email", "the log-in form"],
  ["/sign-in/social", "Continue with Google"],
  ["/callback/:id", "Google's return; parameterised, so cannot be closed"],
  ["/sign-out", "Log out"],
  ["/revoke-sessions", "Sign out everywhere"],
  ["/request-password-reset", "Forgot it?"],
  ["/reset-password", "the reset page's new password"],
  [
    "/reset-password/:token",
    "parameterised, so cannot be closed; the app's mail links to /account/reset instead",
  ],
  ["/get-session", "the runner's own session, as the client reads it"],
  ["/ok", "Better Auth's liveness answer"],
  ["/error", "where Google's callback lands a browser whose state ran out"],
]);

function field(value: unknown, key: string): unknown {
  if (typeof value === "function") return Reflect.get(value, key);
  if (typeof value !== "object" || value === null) return undefined;
  return Reflect.get(value, key);
}

/**
 * The paths the router serves: everything on `auth.api` but what its
 * metadata marks `SERVER_ONLY`. An endpoint is a function carrying `path`
 * and `options`, read here without trusting its shape.
 */
function routedPaths(): string[] {
  const endpoints: unknown[] = Object.values(auth.api);
  return endpoints
    .filter(
      (endpoint) =>
        field(field(field(endpoint, "options"), "metadata"), "SERVER_ONLY") !==
        true,
    )
    .map((endpoint) => String(field(endpoint, "path")));
}

function request(path: string): Request {
  const origin = env.BETTER_AUTH_URL ?? "http://localhost";
  return new Request(`${origin}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: "{}",
  });
}

describe("Better Auth's routed paths", () => {
  it("are each open on purpose or closed", () => {
    const routed = routedPaths();
    expect(routed.length).toBeGreaterThan(20);
    const undecided = routed.filter(
      (path) => !OPEN.has(path) && !CLOSED_AUTH_PATHS.includes(path),
    );
    expect(undecided).toStrictEqual([]);
  });

  it("closes only paths that exist, and none the app uses", () => {
    const routed = new Set(routedPaths());
    for (const path of CLOSED_AUTH_PATHS) {
      expect(routed.has(path), path).toBe(true);
      expect(OPEN.has(path), path).toBe(false);
    }
  });

  it("answers every closed path 404 on the wired instance", async () => {
    for (const path of CLOSED_AUTH_PATHS) {
      const response = await auth.handler(request(path));
      expect(response.status, path).toBe(404);
    }
  });

  it("still routes an open one", async () => {
    const response = await auth.handler(request("/sign-in/email"));
    expect(response.status).not.toBe(404);
  });
});
