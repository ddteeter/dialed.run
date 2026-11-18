import { describe, expect, it, vi } from "vitest";

import { resolvePlaceFor } from "../../src/modules/weather";
import { newUlid } from "../../src/lib/ids";

/**
 * The module's own pass-through, for `normals.test.ts`'s reason: the
 * provider tests build the adapter themselves, so only this proves the
 * module asks the configured one.
 */
describe("resolvePlaceFor", () => {
  it("asks the configured provider, and returns where it found the place", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        Response.json({
          latitude: 45.52,
          longitude: -122.68,
          resolvedAddress: "Portland, OR, United States",
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchImpl);
    try {
      expect(await resolvePlaceFor(newUlid())("Portland, OR")).toStrictEqual({
        lat: 45.52,
        lng: -122.68,
        address: "Portland, OR, United States",
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
