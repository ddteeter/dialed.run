import { describe, expect, it } from "vitest";

import { serverFunctionsIn } from "./source-text";

/**
 * Which server functions a runner behind on the terms may still reach
 * (task 126, ACC-6; decisions D-93, D-95), held against the code both
 * ways.
 *
 * `requireUserId` refuses a runner behind on the published terms whatever
 * the request's method (`auth/terms-gate.ts`), so a server function is
 * exempt only by calling a different gate — and which do is a product
 * decision, not an accident of who wrote the function. A new caller of an
 * exempt gate fails here until it is named, and so does a named function
 * that went back to `requireUserId`.
 *
 * Sign-out is not here: it is Better Auth's own endpoint and never passes
 * through a server function (`test/auth/terms-gate.test.ts` signs a runner
 * who is behind out).
 */
const sources: Record<string, string> = import.meta.glob(
  "../../src/modules/*/functions.ts",
  { query: "?raw", import: "default", eager: true },
);

/**
 * Each exempt gate, and every server function that may call it.
 */
const EXEMPT: Readonly<Record<string, readonly string[]>> = {
  // Accept itself; Get a copy (D-95); and the two reads Settings › Account
  // loads, where a runner who will not accept deletes their account.
  requireUserIdBeforeTerms: [
    "account/functions.ts acceptTermsFn",
    "account/functions.ts accountPageQuery",
    "account/functions.ts requestExportFn",
    "notifications/functions.ts unreadNotificationCountFn",
  ],
  // Delete account, by a fresh Google sign-in or the password.
  requireSignedInSince: ["account/functions.ts requestDeletionFn"],
  checkCurrentPassword: [
    "account/functions.ts requestDeletionFn",
    "account/functions.ts requestEmailChangeFn",
  ],
  // Keep, inside the deletion's week.
  requireUserIdWhileLeaving: ["account/functions.ts keepAccountFn"],
};

function byName(left: string, right: string): number {
  return left.localeCompare(right);
}

describe("the terms gate's exemptions", () => {
  const functions = serverFunctionsIn(sources);

  it("finds the server functions it checks", () => {
    expect(functions.length).toBeGreaterThan(100);
  });

  for (const [gate, named] of Object.entries(EXEMPT)) {
    it(`lets exactly the named functions call ${gate}`, () => {
      const calls = new RegExp(String.raw`\b${gate}\b`, "u");
      const callers = functions
        .filter(({ body }) => calls.test(body))
        .map(({ name }) => name)
        .toSorted(byName);
      expect(callers).toStrictEqual(named.toSorted(byName));
    });
  }

  it("keeps every exempt function off requireUserId, bar email change's own", () => {
    const exempt = new Set(
      Object.values(EXEMPT)
        .flat()
        .filter((name) => !name.endsWith("requestEmailChangeFn")),
    );
    const gated = functions
      .filter(
        ({ name, body }) => exempt.has(name) && /\brequireUserId\b/u.test(body),
      )
      .map(({ name }) => name);
    expect(gated).toStrictEqual([]);
  });
});
