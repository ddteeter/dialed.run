import { describe, expect, it, vi } from "vitest";

import { climateNormals } from "../../src/modules/weather/normals";
import {
  visualCrossingSummerStatsFixture,
  visualCrossingWinterStatsFixture,
} from "./fixtures/visual-crossing-stats";

/**
 * The module's own pass-through, which is not what `provider.test.ts`
 * covers: that file builds the adapter directly and injects a fetch, so
 * every one of its assertions holds even if `normals.ts` delegated
 * somewhere else, or nowhere.
 *
 * Worth one test because the seam is the point — `weatherProvider()` is
 * "the one place that decides which upstream we talk to", and a caller
 * that constructed its own adapter would make that decorative. Only the
 * global fetch can be stubbed here, precisely because this path does not
 * take one.
 */
describe("climateNormals", () => {
  it("asks the configured provider, and returns what it says", async () => {
    // Winter probe first, then summer — the order the adapter asks in.
    const bodies = [
      visualCrossingWinterStatsFixture,
      visualCrossingSummerStatsFixture,
    ];
    let call = 0;
    const fetchImpl = vi.fn(() => {
      const body = bodies[call];
      call += 1;
      return Promise.resolve(Response.json(body));
    });
    vi.stubGlobal("fetch", fetchImpl);

    try {
      expect(await climateNormals(44.98, -93.27)).toStrictEqual({
        winterLowC: -12.1,
        summerHighC: 28.7,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
