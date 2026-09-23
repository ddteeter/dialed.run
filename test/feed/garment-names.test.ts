import { beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";

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
