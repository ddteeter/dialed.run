# Design: 132 run moving time and elevation gain

## Problem

D-111 (owner, 2026-10-04) has runs record moving time and elevation gain,
read from the uploaded file, so the read API (design 130) can give moving
pace and a climb. R-130's first half (PR #147) fixed TCX to read every lap;
this is the second half. Neither field renders; the one visible change is
that a TCX file with a pause in it shows its elapsed duration, so a longer
time and a slower pace, where it showed timer time. Pace on screen stays
elapsed-based until design 130's read API.

## Approach

- **Columns.** `runs.moving_s` (integer seconds) and `runs.elevation_gain_m`
  (real), both nullable. Migration `0047_add_run_moving_time_and_elevation_gain`:
  two `ADD COLUMN`s, no rebuild.
- **Contract.** `runDraftSchema` gains optional `movingS` (positive int) and
  `elevationGainM` (non-negative). The manual form's `manualRunInput`
  omits both, so a manual run cannot carry them. The import consumer writes
  them from the parsed draft; nothing else writes them.
- **Indoor runs carry neither** (D-111: treadmill and manual leave both
  null). One helper in `parsers/shared.ts` drops them from an indoor draft,
  so the rule is written once rather than in three parsers.
- **FIT.** `movingS` = `session.totalMovingTime` where it is positive, else
  `totalTimerTime` (a watch that writes the field as 0 has not filled it);
  `elevationGainM` = `session.totalAscent`.
- **TCX.** `movingS` = the laps' summed `TotalTimeSeconds` (timer time).
  Elevation from `AltitudeMeters`, below.
- **GPX.** `movingS` = the time between consecutive trackpoints with pause
  gaps left out. A gap is a pause when it crosses a `<trkseg>` break (GPX
  1.1: a new segment is a span where the receiver was off or lost fix), or
  when it is longer than `PAUSE_GAP_S` = 10 s **and** the runner covered it
  slower than `STOPPED_SPEED_MPS` = 0.5 m/s. Auto-pause stops recording, so
  a pause shows as a long gap that ends where it began. The speed half is
  what keeps a sparse file (Garmin "smart recording")
  from being read as all pause: a long gap you ran through is moving.
  0.5 m/s is about 33 min/km, slower than any walk and faster than GPS drift
  while stood still. The distance in that test is through the climb where
  both points carry `ele` (3D), so a steep hill walked slowly is not read
  as stood still; the run's `distanceM` stays the ground distance. A total
  of zero is stored as null, not as 0. Whether 0.5 m/s is too high for a
  slow, sparse climb is with the owner; `gpx.test.ts` pins the case (20 min
  at 0.45 m/s, a point every 20 s, a 30% grade still reads as all pause).
- **Elevation (TCX, GPX).** Two stages. First a moving median over
  `ELEVATION_MEDIAN_WINDOW` = 11 points, shrinking symmetrically at the
  ends: GPS altitude is noisy per point, so neighbours can sit 6 m apart on
  flat ground, and the hysteresis alone read a flat hour at 1 Hz with ±3 m
  noise as 790 m (review of #152). Eleven is measured: on a flat hour of
  ±3 m uniform or σ = 2 m Gaussian noise, nine still left phantom climbs
  and eleven left none. A median, not a mean, because it keeps a steady
  climb and the endpoints exactly and drops a single wild fix rather than
  spreading it; the cost is a crest under about six points wide. Then a
  hysteresis sum: the reference follows the altitude freely in the current
  direction, and a reversal only counts once it exceeds
  `ELEVATION_HYSTERESIS_M` = 5 m, which takes out the slower wander. A
  barometric file loses under 5 m per climb. Fewer than two altitudes in
  the file is null.
- **TCX `durationS` becomes elapsed.** #147 made it the laps' summed
  `TotalTimeSeconds`, which is timer time: it stops when the watch is
  paused. D-111 says `durationS` is elapsed and keeps running through a
  pause, and says the summed laps are `moving_s`. So `durationS` is now the
  latest lap end — a lap's own `StartTime` plus its `TotalTimeSeconds` —
  minus the first lap's `StartTime`, and never less than the laps' sum.
  Trackpoint times are not read for it: the first version took the latest
  trackpoint time, and one fix dated a year ahead made a half-hour run
  31,537,800 s long (review of #152). A cap on trackpoint times would only
  move the problem, since an hour's timezone slip fits under any cap a real
  pause does. Lap starts are one per lap, from the watch's lap logic, not
  one per GPS fix. The trade: a pause inside the last lap is missed, so a
  single-lap file paused mid-run reads as its timer time — under-read, never
  invented. Runs already imported keep the duration they were given.

## Backfill — the next PR

Re-parsing held files needs a durable "done or given up" marker per run.
Without one, a sweep re-picks forever every run whose file is gone, whose
re-parse fails, or that is indoor. The two ways to get that marker are
outside this PR's ruling or collide with open work:

1. A third column (a backfill marker) — additive, but D-111 ruled two
   columns and this migration is to be exactly two `ADD COLUMN`s.
2. A data-seed migration writing one outbox row per candidate run, drained
   by the daily digest (claim by CAS, backoff, terminal rows in the digest:
   laws 1, 2, 6 for free). The handler calls the consumer's parse path and
   `UPDATE … WHERE moving_s IS NULL AND elevation_gain_m IS NULL`. This is
   the recommendation.

#150 (D-110, which keeps a run's file for as long as the run) has merged,
so the outbox it rewrote is settled. The backfill is the next PR, built
immediately after this one. Nothing is deployed yet, so every file run
whose file is held is a candidate. R-130 stays open until it lands.

## Contract touches

- Schema changes needed: two nullable columns on `runs` (additive, D-111).
- New route files: none. New bindings/queues/crons: **none**.
- Screens: none. The fields are not rendered (D-111).

## Test plan

- `test/runs/fit.test.ts` (worker): moving from `totalMovingTime`, falling
  back to `totalTimerTime`; ascent; indoor carries neither.
- `test/runs/tcx.test.ts`: moving = lap sum; elapsed `durationS` through a
  pause; elevation from a climb fixture; no altitude → null; treadmill null.
- `test/runs/gpx.test.ts`: segment break and stationary gap left out; a
  sparse moving gap counted; jittery flat track ≈ 0; a real climb.
- `test/runs/parser-helpers.test.ts`: the hysteresis function's edges; the
  median's window size, sort and ends; a flat hour of ±3 m noise reads 0.
- `test/runs/consumer.test.ts`: an imported run stores both columns.
- `test/runs/inputs.test.ts`: the manual input drops both.

## Open questions

- The thresholds (10 s / 0.5 m/s / 5 m) are judgement calls; veto early.
