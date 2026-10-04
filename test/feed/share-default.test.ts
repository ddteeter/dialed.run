import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { userProfiles } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { defaultAudienceFor } from "../../src/modules/feed/share-default";
import { makeUser, resetTables } from "./helpers";

/**
 * `defaultAudienceFor` on its own — both call sites (`attachKit`,
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

describe("defaultAudienceFor", () => {
  it("is shared for a runner with no profile row at all", async () => {
    // A signed-up-but-pre-O1 runner: nothing has ever written a
    // `user_profiles` row for them, so the select finds nothing and this
    // is the one branch the column's own `DEFAULT 'runners'` cannot cover —
    // there is no row for a default to apply to.
    const neverOnboarded = "no-such-user";

    expect(await defaultAudienceFor(coreDb(), neverOnboarded)).toBe("runners");
  });

  it("honours an explicit opt-out", async () => {
    const quiet = await makeUser({ defaultAudience: "private" });

    expect(await defaultAudienceFor(coreDb(), quiet)).toBe("private");
  });
});

describe("defaultAudienceFor reads the audience, not the boolean (design 131, PR B)", () => {
  it("follows default_audience where the legacy boolean disagrees", async () => {
    // Writers keep the two in step, so only a seed can split them: the
    // answer has to come from the audience either way.
    await coreDb()
      .insert(userProfiles)
      .values([
        { userId: "quiet", defaultAudience: "private", shareDefault: true },
        { userId: "open", defaultAudience: "runners", shareDefault: false },
      ]);

    expect(await defaultAudienceFor(coreDb(), "quiet")).toBe("private");
    expect(await defaultAudienceFor(coreDb(), "open")).toBe("runners");
  });

  it("starts a new entry private for a groups default, which no writer can store yet", async () => {
    await coreDb()
      .insert(userProfiles)
      .values({ userId: "grouped", defaultAudience: "groups" });

    expect(await defaultAudienceFor(coreDb(), "grouped")).toBe("private");
  });
});
