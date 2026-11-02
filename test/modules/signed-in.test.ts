import { describe, expect, it } from "vitest";
import { z } from "zod";

import { signedInOf } from "../../src/modules/auth/signed-in";

/**
 * `getSession()` answers `null` when nobody is signed in, so that is what
 * this passes — parsed rather than written, as `test/feed/redirect.test.ts`
 * does, because `unicorn/no-null` forbids the literal.
 */
const NO_SESSION = z.null().parse(JSON.parse("null"));

describe("what the root loader says about who is signed in", () => {
  it("carries the runner's address while signed in, for Au7's carry", () => {
    expect(signedInOf({ user: { email: "dana.k@hey.com" } })).toEqual({
      signedIn: true,
      email: "dana.k@hey.com",
    });
  });

  it("carries no address when nobody is signed in", () => {
    expect(signedInOf(NO_SESSION)).toEqual({
      signedIn: false,
      email: undefined,
    });
  });
});
