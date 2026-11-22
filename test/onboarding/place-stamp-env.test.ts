import { describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { placeStamps } from "../../src/modules/onboarding/place-stamp";
import { placeStampsFromEnv } from "../../src/modules/onboarding/place-stamp-env";

const PORTLAND = {
  address: "Portland, OR, United States",
  lat: 45.52,
  lng: -122.68,
};

describe("the Worker's place stamps", () => {
  it("are keyed by its auth secret", async () => {
    const stamp = await placeStampsFromEnv().stamp(PORTLAND);
    expect(stamp).toHaveLength(64);
    expect(stamp).toBe(
      await placeStamps(env.BETTER_AUTH_SECRET).stamp(PORTLAND),
    );
    expect(await placeStampsFromEnv().verifyStamp(PORTLAND, stamp)).toBe(true);
  });
});
