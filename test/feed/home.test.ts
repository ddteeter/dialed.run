import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { userProfiles } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  conditionsHome,
  saveConditionsCity,
} from "../../src/modules/feed/home";
import { makeUser } from "./helpers";

/**
 * Where Your conditions looks without asking, and how a typed city
 * becomes a place (round 22; owner's ruling 2026-09-24).
 */
function profileOf(userId: string) {
  return drizzle(env.DIALED_CORE)
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
}

const PORTLAND = { lat: 45.52, lng: -122.68 };
// What the provider answers: where, and its own name for the place.
const FOUND = { ...PORTLAND, address: "Portland, OR, United States" };

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
    await saveConditionsCity(userId, "Portland, OR", () =>
      Promise.resolve(FOUND),
    );
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

describe("saveConditionsCity", () => {
  it("resolves City, State, saves the provider's name for it and the place, and answers with both", async () => {
    const userId = await makeUser();
    const resolve = vi.fn(() => Promise.resolve(FOUND));

    const place = await saveConditionsCity(userId, "Portland, OR", resolve);

    expect(place).toStrictEqual({
      ...PORTLAND,
      cityLabel: "Portland, OR, United States",
    });
    expect(resolve).toHaveBeenCalledWith("Portland, OR");
    const [row] = await profileOf(userId);
    expect(row).toMatchObject({
      cityLabel: "Portland, OR, United States",
      ...PORTLAND,
    });
  });

  it("saves which place a bare name resolved to, never the ambiguous text (PR #102 review)", async () => {
    const userId = await makeUser();
    await saveConditionsCity(userId, "Portland", () =>
      Promise.resolve({
        lat: 43.66,
        lng: -70.26,
        address: "Portland, ME, United States",
      }),
    );
    const [row] = await profileOf(userId);
    expect(row?.cityLabel).toBe("Portland, ME, United States");
  });

  it("creates the profile row when there is none", async () => {
    const userId = newUlid();
    await saveConditionsCity(userId, "Portland", () => Promise.resolve(FOUND));
    const [row] = await profileOf(userId);
    expect(row).toMatchObject({
      cityLabel: "Portland, OR, United States",
      ...PORTLAND,
    });
  });

  it("leaves everything else O1 saved alone", async () => {
    const userId = await makeUser({ tempUnit: "c", distanceUnit: "km" });
    await drizzle(env.DIALED_CORE)
      .update(userProfiles)
      .set({ thermalLevel: 1 })
      .where(eq(userProfiles.userId, userId));

    await saveConditionsCity(userId, "Portland", () => Promise.resolve(FOUND));

    const [row] = await profileOf(userId);
    expect(row).toMatchObject({
      thermalLevel: 1,
      tempUnit: "c",
      distanceUnit: "km",
    });
  });

  it("puts the field's sentence on the city field for a city nobody can find, and saves nothing", async () => {
    const userId = await makeUser();

    const saving = saveConditionsCity(userId, "Atlantis", () =>
      Promise.resolve(undefined),
    );

    await expect(saving).rejects.toBeInstanceOf(ZodError);
    await expect(saving).rejects.toMatchObject({
      issues: [
        {
          path: ["cityLabel"],
          message: "We couldn't find that city. Add the state or country.",
        },
      ],
    });
    const [row] = await profileOf(userId);
    expect(row?.cityLabel).toBeNull();
    expect(row?.lat).toBeNull();
  });

  it("lets a provider outage through as itself, and saves nothing", async () => {
    const userId = await makeUser();
    const outage = new Error("weather is down");

    await expect(
      saveConditionsCity(userId, "Portland", () => Promise.reject(outage)),
    ).rejects.toBe(outage);
    const [row] = await profileOf(userId);
    expect(row?.cityLabel).toBeNull();
  });
});
