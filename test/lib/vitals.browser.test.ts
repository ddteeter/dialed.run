import { expect, it } from "vitest";

import {
  browserVitalsDeps,
  startVitalsReporter,
} from "../../src/lib/browser/vitals";
import { vitalsPayloadSchema } from "../../src/lib/contracts/vitals";

/**
 * The reporter on a real page load, with the real `web-vitals`: the one
 * place its reports, attribution and all, meet the endpoint's schema.
 * Happy-dom has no paint or navigation timing, so only Chromium can say
 * that what the library hands over is what the contract accepts.
 *
 * The hide is the test's to call: a test cannot hide its own tab.
 */
/**
 * Nothing to undo: this router never calls back, and this page never
 * hides on its own.
 */
function nothingToUndo(): void {
  // Deliberately empty.
}

it("sends what the endpoint accepts, from a real load", async () => {
  const beacons: unknown[] = [];
  const flushes: (() => void)[] = [];
  const stop = startVitalsReporter(
    {
      subscribe: () => nothingToUndo,
      state: { matches: [{ routeId: "/closet/" }] },
    },
    {
      ...browserVitalsDeps(),
      send: (body) => {
        beacons.push(JSON.parse(body));
      },
      onHidden: (flush) => {
        flushes.push(flush);
        return nothingToUndo;
      },
    },
  );

  // TTFB reports once the load is complete, FCP once the page has painted.
  const names = new Set<string>();
  await expect
    .poll(
      () => {
        for (const flush of flushes) flush();
        for (const beacon of beacons) {
          for (const metric of vitalsPayloadSchema.parse(beacon).metrics) {
            names.add(metric.name);
          }
        }
        return names.has("TTFB");
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  stop();

  expect(beacons.length).toBeGreaterThan(0);
  for (const beacon of beacons) {
    expect(vitalsPayloadSchema.safeParse(beacon).success).toBe(true);
  }
});
