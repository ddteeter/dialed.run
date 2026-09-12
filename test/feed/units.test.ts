import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { defaultUnits } from "../../src/lib/contracts";
import { newUlid } from "../../src/lib/ids";
import { unitsFor } from "../../src/modules/feed/units";
import { makeUser, resetTables } from "./helpers";

/**
 * D-6: `temp_unit` and `distance_unit` existed from the first migration and
 * nothing read them, so every screen rendered Fahrenheit and miles whatever
 * the row said. This is the read that fixes it.
 */
function coreDb() {
  return drizzle(env.DIALED_CORE);
}

beforeEach(async () => {
  await resetTables();
});

describe("unitsFor", () => {
  it("answers with what the profile actually chose", async () => {
    const userId = await makeUser({ tempUnit: "c", distanceUnit: "km" });

    expect(await unitsFor(coreDb(), userId)).toStrictEqual({
      temp: "c",
      distance: "km",
    });
  });

  it("reads the two columns independently", async () => {
    // Celsius and miles is a real combination, and a helper that returned
    // one bundled "metric or not" answer would get it wrong.
    const userId = await makeUser({ tempUnit: "c", distanceUnit: "mi" });

    expect(await unitsFor(coreDb(), userId)).toStrictEqual({
      temp: "c",
      distance: "mi",
    });
  });

  it("falls back for a profile that predates the question", async () => {
    // The columns are nullable and most rows hold NULL — this is the
    // common case, not an edge one.
    const userId = await makeUser();

    expect(await unitsFor(coreDb(), userId)).toStrictEqual(defaultUnits);
  });

  it("falls back for a viewer who is not signed in", async () => {
    expect(await unitsFor(coreDb(), undefined)).toStrictEqual(defaultUnits);
  });

  it("falls back when there is no profile row at all", async () => {
    expect(await unitsFor(coreDb(), newUlid())).toStrictEqual(defaultUnits);
  });

  it("falls back on a stored value the vocabulary no longer admits", async () => {
    // Written straight past drizzle's enum typing, the way a row left by an
    // older vocabulary would look. A stale unit is cosmetic; refusing to
    // render the feed over one would be the secondary failure taking the
    // primary action down (resilience law 5).
    const userId = await makeUser({ tempUnit: "c", distanceUnit: "km" });
    await env.DIALED_CORE.prepare(
      "UPDATE user_profiles SET temp_unit = ? WHERE user_id = ?",
    )
      .bind("kelvin", userId)
      .run();

    expect(await unitsFor(coreDb(), userId)).toStrictEqual({
      temp: defaultUnits.temp,
      distance: "km",
    });
  });
});
