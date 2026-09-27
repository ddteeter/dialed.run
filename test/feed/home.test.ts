import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { userProfiles } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { conditionsHome } from "../../src/modules/feed/home";
import { savePlace } from "../../src/modules/onboarding";
import { makeUser } from "./helpers";

/**
 * Where Your conditions looks without asking (round 22). A typed city
 * becomes a place through onboarding's `savePlace`, the one writer of
 * these columns (FEED-5), tested beside it.
 */

const PORTLAND = { lat: 45.52, lng: -122.68 };

describe("conditionsHome", () => {
  it("has nothing for a runner with no place saved", async () => {
    const userId = await makeUser();
    expect(await conditionsHome(userId)).toStrictEqual({
      coords: undefined,
      cityLabel: undefined,
    });
  });

  it("has nothing for a runner with no profile at all", async () => {
    expect(await conditionsHome(newUlid())).toStrictEqual({
      coords: undefined,
      cityLabel: undefined,
    });
  });

  it("reads back a saved place and its label", async () => {
    const userId = await makeUser();
    await savePlace(drizzle(env.DIALED_CORE), userId, {
      ...PORTLAND,
      cityLabel: "Portland, OR, United States",
    });
    expect(await conditionsHome(userId)).toStrictEqual({
      coords: PORTLAND,
      cityLabel: "Portland, OR, United States",
    });
  });

  it("is no place with only one coordinate", async () => {
    for (const half of [{ lat: 1 }, { lng: 2 }]) {
      const userId = await makeUser();
      await drizzle(env.DIALED_CORE)
        .update(userProfiles)
        .set(half)
        .where(eq(userProfiles.userId, userId));
      const home = await conditionsHome(userId);
      expect(home.coords).toBeUndefined();
    }
  });
});
