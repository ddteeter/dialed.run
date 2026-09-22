import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { isPublicByDefault } from "../../src/modules/feed/share-default";
import { makeUser, resetTables } from "./helpers";

/**
 * `isPublicByDefault` on its own — both call sites (`attachKit`,
 * `verdictBacklog`) already exercise the ordinary present-profile cases
 * through their own tests. What only this file asserts is the missing-row
 * branch, because `attachKit`'s test fixtures always run through
 * `makeUser`, which always inserts a profile row.
 */
function coreDb() {
  return drizzle(env.DIALED_CORE);
}

beforeEach(async () => {
  await resetTables();
});

describe("isPublicByDefault", () => {
  it("is public for a runner with no profile row at all", async () => {
    // A signed-up-but-pre-O1 runner: nothing has ever written a
    // `user_profiles` row for them, so the select finds nothing and this
    // is the one branch the column's own `DEFAULT true` cannot cover —
    // there is no row for a default to apply to.
    const neverOnboarded = "no-such-user";

    expect(await isPublicByDefault(coreDb(), neverOnboarded)).toBe(true);
  });

  it("honours an explicit opt-out", async () => {
    const quiet = await makeUser({ shareDefault: false });

    expect(await isPublicByDefault(coreDb(), quiet)).toBe(false);
  });
});
