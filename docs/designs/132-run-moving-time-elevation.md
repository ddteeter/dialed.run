# Design: 132 run moving time and elevation gain

## Problem

D-111 (owner, 2026-10-04) has runs record moving time and elevation gain,
read from the uploaded file, so the read API (design 130) can give moving
pace and a climb. R-130's first half (PR #147) fixed TCX to read every lap;
this is the second half. Nothing on screen changes.

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
- **FIT.** `movingS` = `session.totalMovingTime`, else `totalTimerTime`;
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
  while stood still. A total of zero is stored as null, not as 0.
- **Elevation (TCX, GPX).** A hysteresis sum: the reference follows the
  altitude freely in the current direction, and a reversal only counts once
  it exceeds `ELEVATION_HYSTERESIS_M` = 5 m. GPS altitude wanders by a few
  metres point to point; 5 m sits above that and below any hill a runner
  would call one. A barometric file loses under 5 m per climb. Fewer than
  two altitudes in the file is null.
- **TCX `durationS` becomes elapsed.** #147 made it the laps' summed
  `TotalTimeSeconds`, which is timer time: it stops when the watch is
  paused. D-111 says `durationS` is elapsed and keeps running through a
  pause, and says the summed laps are `moving_s`. So `durationS` is now the
  last trackpoint's `Time` minus the first lap's `StartTime`, and never less
  than the laps' sum (a file with no timed trackpoints, or whose points stop
  before the timer did, falls back to the sum it has today). Runs already
  imported keep the duration they were given.

## Backfill — proposed as a follow-up PR

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
   the recommendation, but #150 rewrites `outbox.ts`, `outbox-handlers.ts`
   and `consumer.ts` right now, and until it merges the bucket's 30-day rule
   means only the last month's files are held anyway.

So the backfill follows #150. R-130 stays open for it.

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
- `test/runs/parser-helpers.test.ts`: the hysteresis function's edges.
- `test/runs/consumer.test.ts`: an imported run stores both columns.
- `test/runs/inputs.test.ts`: the manual input drops both.

## Open questions

- The thresholds (10 s / 0.5 m/s / 5 m) are judgement calls; veto early.
