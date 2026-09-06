import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import { userProfiles } from "../../src/db/schema-core";
import { withLocalDb } from "./local-db";

/**
 * Guards the seeding contract itself: that `withLocalDb` reaches the same
 * local D1 the dev server serves from. If wrangler moves where local state
 * lives, every lane's fixtures would silently seed a database nobody reads —
 * the failure this test exists to make loud.
 *
 * Every write here is scoped to its own generated id. A bare
 * `delete(userProfiles)` would take the developer's local closet with it.
 */
test("withLocalDb round-trips a row through the dev server's D1", async () => {
  const userId = `e2e-localdb-${String(Date.now())}`;

  try {
    await withLocalDb(async ({ core }) => {
      await core
        .insert(userProfiles)
        .values({ userId, displayName: "Local DB probe" });
    });

    const found = await withLocalDb(async ({ core }) =>
      core.select().from(userProfiles).where(eq(userProfiles.userId, userId)),
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.displayName).toBe("Local DB probe");
  } finally {
    await withLocalDb(async ({ core }) => {
      await core.delete(userProfiles).where(eq(userProfiles.userId, userId));
    });
  }
});
