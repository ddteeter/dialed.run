import { describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { CHANGE_PASSWORD_PATH } from "../../src/modules/auth/breached-password";
import { auth } from "../../src/modules/auth/instance";
import { codeOnly, repoPath } from "./source-text";

/**
 * Change password goes through the server (register R-124, D-98), where the
 * per-runner count on tries at the current password can see it. Better
 * Auth's client has a `changePassword` of its own, which posts straight
 * to the endpoint: its limiter counts HTTP requests, never this runner's
 * tries, so a call to it from anywhere in `src/` would reopen the gap.
 * So would the endpoint itself, which `routes/api/auth/$.ts` forwards like
 * any other: the wired instance must answer it as missing.
 *
 * Read as text, as the other architecture tests are: the workers pool has
 * no filesystem.
 */
const sources: Record<string, string> = import.meta.glob(
  "../../src/**/*.{ts,tsx}",
  { query: "?raw", import: "default", eager: true },
);

/**
 * The client's `changePassword`. (The endpoint's path is not looked for:
 * the server's breach screen names it, and a raw URL is a lint error.)
 */
const CLIENT_CHANGE = /\bauthClient\s*\.\s*changePassword\b/u;

describe("Change password is the server's (R-124)", () => {
  it("reads the whole of src", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(300);
  });

  it("calls Better Auth's change only from the server, never the client", () => {
    const callers = Object.entries(sources)
      .filter(([, source]) => CLIENT_CHANGE.test(codeOnly(source)))
      .map(([path]) => repoPath(path));
    expect(callers).toStrictEqual([]);
  });

  it("would catch one", () => {
    expect(
      CLIENT_CHANGE.test(
        "await authClient.changePassword({ currentPassword })",
      ),
    ).toBe(true);
    expect(
      CLIENT_CHANGE.test("await auth.api.changePassword({ body, headers })"),
    ).toBe(false);
  });

  it("answers Better Auth's endpoint as missing on the wired instance", async () => {
    const origin = env.BETTER_AUTH_URL ?? "http://localhost";
    const response = await auth.handler(
      new Request(`${origin}/api/auth${CHANGE_PASSWORD_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
        },
        body: JSON.stringify({ currentPassword: "a", newPassword: "b" }),
      }),
    );
    expect(response.status).toBe(404);
  });
});
