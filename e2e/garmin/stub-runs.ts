/**
 * What the Garmin stub serves, shared by the stub and the demo that reads
 * it (plan 157, step 9).
 *
 * The port is fixed because the dev server reads `GARMIN_API_ORIGIN` from
 * `.dev.vars`, which is static: CI writes `http://localhost:3900` there,
 * and a local `.dev.vars` that runs this demo says the same.
 */
export const GARMIN_STUB_PORT = 3900;

/**
The id CI's `.dev.vars` names in `GARMIN_OWNER_USER_ID`.
*/
export const GARMIN_OWNER_ID = "e2e-garmin-owner";

interface StubRun {
  activityId: number;
  daysAgo: number;
  distanceM: number;
  durationS: number;
  /**
  As the watch stores it: the runner's rating ×10. Absent when not rated.
  */
  workoutRpe?: number;
}

/**
Newest first, as Garmin lists them. The first is rated 2 of 10: easy.
*/
export const GARMIN_STUB_RUNS: readonly StubRun[] = [
  {
    activityId: 9_000_000_003,
    daysAgo: 1,
    distanceM: 9978,
    durationS: 3098,
    workoutRpe: 20,
  },
  { activityId: 9_000_000_002, daysAgo: 3, distanceM: 7012, durationS: 2400 },
  {
    activityId: 9_000_000_001,
    daysAgo: 5,
    distanceM: 12_875,
    durationS: 4310,
    workoutRpe: 70,
  },
];
