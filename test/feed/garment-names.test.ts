import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { wardrobeItems } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { garmentNamesByIds } from "../../src/modules/feed/garment-names";
import { makeItem, makeUser, resetTables } from "./helpers";

beforeEach(async () => {
  await resetTables();
});

describe("garmentNamesByIds", () => {
  it("names more garments than D1 binds in one statement", async () => {
    // The backlog asks for every garment across fifty kits, and D1 refuses
    // more than 100 bound parameters in one statement.
    const userId = await makeUser();
    const ids: string[] = [];
    for (let index = 0; index < 150; index += 1) {
      ids.push(await makeItem({ userId, name: `Garment ${String(index)}` }));
    }

    const names = await garmentNamesByIds(drizzle(env.DIALED_CORE), ids);

    expect(names.size).toBe(150);
    expect(names.get(ids[149] ?? "")).toBe("Garment 149");
  });
});

/**
 * A branded garment and a generic one, by id.
 */
async function branded(): Promise<{ branded: string; generic: string }> {
  const userId = await makeUser();
  const brandedId = await makeItem({ userId, name: "Hidden Comfort" });
  await drizzle(env.DIALED_CORE)
    .update(wardrobeItems)
    .set({ brand: "Balega" })
    .where(eq(wardrobeItems.id, brandedId));
  const genericId = await makeItem({ userId, name: "L/S crew" });
  return { branded: brandedId, generic: genericId };
}

describe("garmentNamesByIds with the brand (R55·209c)", () => {
  it("names the model alone unless asked for the brand", async () => {
    const ids = await branded();
    const names = await garmentNamesByIds(drizzle(env.DIALED_CORE), [
      ids.branded,
      ids.generic,
    ]);
    expect(names.get(ids.branded)).toBe("Hidden Comfort");
    expect(names.get(ids.generic)).toBe("L/S crew");
  });

  it("names brand and model when asked, and a piece with no brand by its name", async () => {
    const ids = await branded();
    const names = await garmentNamesByIds(
      drizzle(env.DIALED_CORE),
      [ids.branded, ids.generic],
      { withBrand: true },
    );
    expect(names.get(ids.branded)).toBe("Balega Hidden Comfort");
    expect(names.get(ids.generic)).toBe("L/S crew");
  });
});
