import { describe, expect, it } from "vitest";

import { userProfiles } from "../../src/db/schema-core";
import { coreDb } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { viewerZone } from "../../src/modules/notifications";

/**
 * A viewer's clock is their home place's zone and nothing else (R-96 (3),
 * design 173): no run fallback, no browser.
 */
async function profileWith(timeZone?: string): Promise<string> {
  const userId = newUlid();
  // Left out, the column is NULL: the lookup has not filled it.
  await coreDb()
    .insert(userProfiles)
    .values({ userId, ...(timeZone !== undefined && { timeZone }) });
  return userId;
}

describe("viewerZone", () => {
  it("is the home place's zone", async () => {
    const userId = await profileWith("America/Chicago");
    expect(await viewerZone(coreDb(), userId)).toStrictEqual({
      homeZone: "America/Chicago",
    });
  });

  it("is owed while the lookup has not filled the zone", async () => {
    const userId = await profileWith();
    expect(await viewerZone(coreDb(), userId)).toStrictEqual({
      homeZone: undefined,
    });
  });

  it("is owed for a stored zone Intl refuses", async () => {
    const userId = await profileWith("Not/AZone");
    expect(await viewerZone(coreDb(), userId)).toStrictEqual({
      homeZone: undefined,
    });
  });

  it("reads this runner's row, never another's", async () => {
    await profileWith("Asia/Tokyo");
    const userId = await profileWith("Europe/Berlin");
    expect(await viewerZone(coreDb(), userId)).toStrictEqual({
      homeZone: "Europe/Berlin",
    });
  });

  it("is owed for a runner with no profile row yet", async () => {
    expect(await viewerZone(coreDb(), newUlid())).toStrictEqual({
      homeZone: undefined,
    });
  });
});
