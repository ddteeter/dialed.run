import { beforeEach, describe, expect, it } from "vitest";

import { observationsForRuns } from "../../src/modules/feed/conditions";
import { yourConditionsConsensus } from "../../src/modules/feed/consensus";
import { ownProfile } from "../../src/modules/feed/profiles";
import {
  NOW,
  makeEntry,
  makeItem,
  makeObservation,
  makeRun,
  makeUser,
  resetTables,
} from "./helpers";
import { pointConditions } from "./conditions-fixture";

/**
 * D-5: a run that spans hours is not the hour it began in.
 *
 * `attach.ts` has resolved every hour a run touches since `db1e0c6`; what
 * this covers is the read side, which took only the first until task 054.
 *
 * `NOW` sits 2000s into its hour bucket, so a 2-hour run starting there
 * touches three buckets — the partial one it starts in, the full one, and
 * the partial one it ends in. That is deliberate: an off-by-one in the
 * hour walk shows up as a missing end or a missing start, not as a silent
 * pass.
 */
const HOUR = 3600;

beforeEach(async () => {
  await resetTables();
});

describe("conditions across a run", () => {
  it("reports the coldest and warmest hour a run actually touched", async () => {
    const user = await makeUser();
    const lat = 30;
    const lng = 30;
    const runId = await makeRun({
      userId: user,
      lat,
      lng,
      startedAt: NOW,
      durationS: 2 * HOUR,
    });
    // Warming through the run: 2 -> 8 -> 14.
    await makeObservation({ lat, lng, startedAt: NOW, tempC: 2, feelsLikeC: 2 });
    await makeObservation({ lat, lng, startedAt: NOW + HOUR, tempC: 8, feelsLikeC: 8 });
    await makeObservation({ lat, lng, startedAt: NOW + 2 * HOUR, tempC: 14, feelsLikeC: 14 });

    const observations = await observationsForRuns([
      { id: runId, lat, lng, startedAt: NOW, durationS: 2 * HOUR },
    ]);
    const conditions = observations.get(runId);

    // The point values stay the starting hour, so nothing that read them
    // before this lane moves.
    expect(conditions?.tempC).toBe(2);
    expect(conditions?.span).toStrictEqual({
      minTempC: 2,
      maxTempC: 14,
      minFeelsLikeC: 2,
      maxFeelsLikeC: 14,
    });
  });

  it("reports a span with no width for a run inside one hour", async () => {
    const user = await makeUser();
    const lat = 31;
    const lng = 31;
    const runId = await makeRun({ userId: user, lat, lng, startedAt: NOW, durationS: 600 });
    await makeObservation({ lat, lng, startedAt: NOW, tempC: 5, feelsLikeC: 3 });

    const observations = await observationsForRuns([
      { id: runId, lat, lng, startedAt: NOW, durationS: 600 },
    ]);

    // `min === max` is what lets the range render unconditionally.
    expect(observations.get(runId)?.span).toStrictEqual({
      minTempC: 5,
      maxTempC: 5,
      minFeelsLikeC: 3,
      maxFeelsLikeC: 3,
    });
  });

  it("spans the hours that resolved when a later one never did", async () => {
    // A provider outage on hour 2 is a degraded read, not a failed one
    // (law 5) — the run still answers, over what exists.
    const user = await makeUser();
    const lat = 32;
    const lng = 32;
    const runId = await makeRun({
      userId: user,
      lat,
      lng,
      startedAt: NOW,
      durationS: 2 * HOUR,
    });
    await makeObservation({ lat, lng, startedAt: NOW, tempC: 2, feelsLikeC: 2 });
    await makeObservation({ lat, lng, startedAt: NOW + HOUR, tempC: 8, feelsLikeC: 8 });

    const observations = await observationsForRuns([
      { id: runId, lat, lng, startedAt: NOW, durationS: 2 * HOUR },
    ]);

    expect(observations.get(runId)?.span.maxTempC).toBe(8);
  });

  it("answers nothing at all when the starting hour never resolved", async () => {
    // `tempC`/`feelsLikeC` *mean* the starting hour, so a run without one
    // has no conditions — the behaviour before this lane, kept.
    const user = await makeUser();
    const lat = 33;
    const lng = 33;
    const runId = await makeRun({
      userId: user,
      lat,
      lng,
      startedAt: NOW,
      durationS: 2 * HOUR,
    });
    await makeObservation({ lat, lng, startedAt: NOW + HOUR, tempC: 8, feelsLikeC: 8 });

    const observations = await observationsForRuns([
      { id: runId, lat, lng, startedAt: NOW, durationS: 2 * HOUR },
    ]);

    expect(observations.get(runId)).toBeUndefined();
  });
});

describe("the coverage ladder bands a run at the hour it was judged", () => {
  it("puts a warming run rated 'way warm' in the band it ended in", async () => {
    // The D-5 regression itself. A 2->14 run rated way warm is a statement
    // about 14 degrees, not about 2.
    const user = await makeUser();
    const item = await makeItem({ userId: user, category: "top" });
    const lat = 34;
    const lng = 34;
    const runId = await makeRun({
      userId: user,
      lat,
      lng,
      startedAt: NOW,
      durationS: 2 * HOUR,
    });
    await makeObservation({ lat, lng, startedAt: NOW, tempC: 2, feelsLikeC: 2 });
    await makeObservation({ lat, lng, startedAt: NOW + HOUR, tempC: 8, feelsLikeC: 8 });
    await makeObservation({ lat, lng, startedAt: NOW + 2 * HOUR, tempC: 14, feelsLikeC: 14 });
    await makeEntry({
      userId: user,
      runId,
      isPublic: true,
      createdAt: NOW,
      itemIds: [item],
      verdict: 2,
    });

    const { coverage } = await ownProfile(user);

    // bandFloorC floors to a multiple of 5: 14 -> 10, and 2 -> 0.
    expect(coverage.map((b) => b.bandFloorC)).toStrictEqual([10]);
    expect(coverage[0]?.warm).toBe(1);
  });
});

describe("consensus matches an entry at the hour its runner judged by", () => {
  it("counts a warming run for a viewer standing in the hour it ended in", async () => {
    // The entry warmed 2 -> 14 and its runner said "way warm", so their
    // verdict is a statement about 14. A viewer at 13 should see it; before
    // task 054 the entry was compared at 2 and fell outside the window.
    const author = await makeUser();
    const item = await makeItem({ userId: author, category: "top" });
    const lat = 35;
    const lng = 35;
    const runId = await makeRun({
      userId: author,
      lat,
      lng,
      startedAt: NOW,
      durationS: 2 * HOUR,
    });
    await makeObservation({ lat, lng, startedAt: NOW, tempC: 2, feelsLikeC: 2 });
    await makeObservation({ lat, lng, startedAt: NOW + HOUR, tempC: 8, feelsLikeC: 8 });
    await makeObservation({ lat, lng, startedAt: NOW + 2 * HOUR, tempC: 14, feelsLikeC: 14 });
    await makeEntry({
      userId: author,
      runId,
      isPublic: true,
      createdAt: NOW,
      itemIds: [item],
      verdict: 2,
    });

    const result = await yourConditionsConsensus(
      pointConditions({ tempC: 14, feelsLikeC: 13 }),
      NOW,
    );

    expect(result.total).toBe(1);
    expect(result.groups.tops).toBe(1);
  });

  it("leaves the viewer a point, since a live reading has no verdict", async () => {
    // The asymmetry is deliberate: a viewer at 2 degrees should NOT match
    // that same entry, because its runner was judging 14.
    const author = await makeUser();
    const item = await makeItem({ userId: author, category: "top" });
    const lat = 36;
    const lng = 36;
    const runId = await makeRun({
      userId: author,
      lat,
      lng,
      startedAt: NOW,
      durationS: 2 * HOUR,
    });
    await makeObservation({ lat, lng, startedAt: NOW, tempC: 2, feelsLikeC: 2 });
    await makeObservation({ lat, lng, startedAt: NOW + HOUR, tempC: 8, feelsLikeC: 8 });
    await makeObservation({ lat, lng, startedAt: NOW + 2 * HOUR, tempC: 14, feelsLikeC: 14 });
    await makeEntry({
      userId: author,
      runId,
      isPublic: true,
      createdAt: NOW,
      itemIds: [item],
      verdict: 2,
    });

    const result = await yourConditionsConsensus(
      pointConditions({ tempC: 2, feelsLikeC: 2 }),
      NOW,
    );

    expect(result.total).toBe(0);
  });
});
