import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { sessionOrRedirect } from "../../src/modules/auth/require-session";
import { sessionFromRequest } from "../../src/modules/auth/session";

/**
 * The loader-side gate. It was in `functions.ts` — unimportable, so
 * untestable — where a mutant could invert the check, empty the
 * destination, or flip `throw: true` to `false`. The last of those is the
 * quiet one: `redirect()` without `throw` *returns* the redirect, so the
 * loader would carry on with a null session and render the page it was
 * guarding.
 */

const SIGNED_IN = { user: { id: "01JABCDEF" } };

/**
 * What better-auth actually hands back for a visitor with no cookie —
 * taken from the real call rather than written as a literal.
 */
function signedOut(): Promise<{ user: { id: string } } | null> {
  return sessionFromRequest(new Request("https://dialed.run/closet"));
}

/**
The redirect `sessionOrRedirect` throws for a signed-out visitor.
*/
function redirectFrom(session: { user: { id: string } } | null): unknown {
  try {
    sessionOrRedirect(session);
  } catch (error) {
    return error;
  }
  throw new Error("expected a redirect");
}

describe("sessionOrRedirect", () => {
  it("hands back a session that exists, narrowed to non-null", () => {
    expect(sessionOrRedirect(SIGNED_IN)).toBe(SIGNED_IN);
  });

  it("throws a redirect — it does not return one", async () => {
    const thrown = redirectFrom(await signedOut());
    expect(isRedirect(thrown)).toBe(true);
  });

  it("sends a signed-out visitor to the sign-in page", async () => {
    const thrown = redirectFrom(await signedOut());
    // TanStack wraps the target in `options` on the Response it throws.
    expect(thrown).toMatchObject({ options: { to: "/auth/login" } });
  });
});
