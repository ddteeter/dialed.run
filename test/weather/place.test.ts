import { describe, expect, it, vi } from "vitest";

import { resolvePlace } from "../../src/modules/weather";

/**
 * The module's own pass-through, for `normals.test.ts`'s reason: the
 * provider tests build the adapter themselves, so only this proves the
 * module asks the configured one.
 */
describe("resolvePlace", () => {
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
      expect(await resolvePlace("Portland, OR")).toStrictEqual({
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
