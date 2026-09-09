import { describe, expect, it } from "vitest";

import { AuthRequiredError } from "../../src/modules/auth/auth-error";
import { sessionFromRequest } from "../../src/modules/auth/session";
import {
  optionalUserIdFrom,
  userIdOrThrow,
  type SessionWithUser,
} from "../../src/modules/auth/session-user";

/**
 * The two server-function auth reads, with the session handed in.
 *
 * They used to live inside `require-user.ts`, which imports
 * `@tanstack/react-start/server` and therefore cannot be imported by a test
 * at all — so both branches of the gate every module depends on had no
 * coverage. The mutant that turns `session === null` into `session !== null`
 * makes `requireUserId` refuse everyone who *is* signed in and admit
 * everyone who is not.
 */

const SIGNED_IN = { user: { id: "01JABCDEF" } };

/**
 * What better-auth actually hands back for a visitor with no cookie.
 *
 * Taken from the real call rather than written as a literal — which
 * `unicorn/no-null` would reject anyway — so the refusal below is asserted
 * against the value the gate really receives, not a stand-in for it.
 */
function signedOut(): Promise<SessionWithUser | null> {
  return sessionFromRequest(new Request("https://dialed.run/closet"));
}

describe("userIdOrThrow", () => {
  it("returns the signed-in user's id", () => {
    expect(userIdOrThrow(SIGNED_IN)).toBe("01JABCDEF");
  });

  it("raises the one unauthenticated signal when there is no session", async () => {
    // Not any error: `AuthRequiredError` is what the client's failure
    // classifier looks for to say "you were signed out" rather than "our
    // end broke".
    const nobody = await signedOut();
    expect(() => userIdOrThrow(nobody)).toThrow(AuthRequiredError);
  });
});

describe("optionalUserIdFrom", () => {
  it("returns the signed-in user's id", () => {
    expect(optionalUserIdFrom(SIGNED_IN)).toBe("01JABCDEF");
  });

  it("returns undefined for a signed-out visitor, rather than refusing", async () => {
    // The public feed and the entry page are readable signed out. Throwing
    // here would turn a browsable page into a redirect.
    expect(optionalUserIdFrom(await signedOut())).toBeUndefined();
  });
});
