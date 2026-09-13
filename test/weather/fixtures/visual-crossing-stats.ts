/**
 * A real `include=stats` response, trimmed to the fields the adapter reads.
 *
 * Recorded from the live Timeline API on 2026-09-11 for Minneapolis
 * (44.98, −93.27) — the winter probe is 15 January, the summer probe
 * 15 July. Kept verbatim so nobody has to spend a key confirming the shape
 * again, and so the two traps that cost a probe each stay visible:
 * `include` must be `stats` (not `normals`, which is accepted and returns
 * nothing), and any `elements=` filter strips the `normal` block outright.
 *
 * Each `normal` field is `[min, mean, max]` over the statistical period.
 */
export const visualCrossingWinterStatsFixture = {
  queryCost: 1,
  latitude: 44.98,
  longitude: -93.27,
  days: [
    {
      datetime: "2027-01-15",
      normal: {
        tempmin: [-26.4, -12.1, 0.4],
        tempmax: [-17.1, -4.4, 5.2],
      },
    },
  ],
};

export const visualCrossingSummerStatsFixture = {
  queryCost: 1,
  latitude: 44.98,
  longitude: -93.27,
  days: [
    {
      datetime: "2027-07-15",
      normal: {
        tempmin: [10.1, 18.3, 24.2],
        tempmax: [21.4, 28.7, 36.1],
      },
    },
  ],
};
