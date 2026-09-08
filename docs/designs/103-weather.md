# Design: 103 Weather

## Problem

Every outdoor run with a location gets conditions attached once, cached
forever, and rendered by lane 104. Provider-agnostic behind `WeatherProvider`
(contracts.ts); Visual Crossing is the first adapter. A provider outage must
never fail an import (law 5) — the hourly retry cron owns recovery.

## Approach

All code in `src/modules/weather/` (+ tests in `test/weather/`):

- `provider/visual-crossing.ts` — `VisualCrossingProvider` (Timeline API,
  metric, `AbortSignal.timeout(10_000)`, injectable `fetch` for tests, every
  consumed field zod-parsed). Any failure (HTTP, timeout, malformed body,
  missing key) throws retryable `WeatherUnavailableError`. `observation` and
  `forecast` share one Timeline query (the API serves past + future).
- `store.ts` — cache: lookup `(lat_r, lng_r, hour_bucket)` (2dp round, hour
  floor) with `source='visualcrossing'`; miss → provider fetch → write-through
  upsert. A manual row squatting the cache key is replaced by real data
  (manual exists only while unresolvable); a concurrent VC row wins races via
  `ON CONFLICT ... DO UPDATE ... WHERE source='manual'`.
- `attach.ts` — the public API: `attachObservation` (no-op with structured
  log when run is indoor/no-location/already terminal — idempotent), failure
  → `weather_status='pending'`; `recordManualObservation(runId, tempC)`
  (upserts a `source='manual'` row at the run's cache key, zero-filled
  non-temp columns, `condition='manual'`, status `'manual'`; if a real
  observation is already cached it links that instead); `retryPendingWeather`
  — the hourly cron body: retries pending runs (oldest first, batch of 50),
  then one conditional UPDATE marks still-pending runs older than 5h
  (entry time = `coalesce(max(imports.created_at), started_at)`) as
  `'failed'` — ~5 hourly attempts without new columns. Claim = conditional
  terminal UPDATEs + the cache's UNIQUE key: the 5-state `weather_status`
  enum has no `'processing'` value, so overlap safety is idempotency-based
  (double-fetch at worst; documented deviation from law 2's literal shape).
- `read.ts` — conditions read API for 104 (its packet expects one):
  `observationForRun(runId)` (run detail; may return the run's manual row)
  and `observationsForRuns(runIds)` (consensus batch; **excludes manual**).
- `components/WeatherAttribution.tsx` — linked "Weather by Visual Crossing".
- `forecast.ts` — `forecast(lat, lng, at)` pass-through with the same cache.
- Wiring: `src/modules/ops/scheduled.ts` gains the `0 * * * *` dispatch to
  `retryPendingWeather` (heartbeat row `weather-retry` already written by
  `handleScheduled`). `src/env/env.d.ts` declares optional
  `VISUAL_CROSSING_API_KEY` (secret, human-set; absent → degrade to pending).
  `docs/architecture.md` diagram gains the weather→core-DB edge (status +
  run reads) in this PR.

## Contract touches

- Schema changes needed: **none**. (Considered `runs.weather_attempts` for
  exact retry counting; the 5h entry-time window makes it unnecessary.
  Reviewer may veto — see open questions.)
- New route files: **none**.
- New bindings/queues/crons: no bindings. Requires the human-managed
  `triggers` block in wrangler.jsonc to include `"0 * * * *"` (retry cron)
  — flagged, not edited here. `VISUAL_CROSSING_API_KEY` secret does not
  exist yet; code degrades until it is set.
- Screens: none (104 renders conditions; attribution component exported).

## Test plan

All integration-style in the workers pool (real D1) unless noted:

- `provider.test.ts` (unit): fixture Timeline response → parsed observation;
  malformed body → `WeatherUnavailableError`; non-200 → retryable; missing
  key → retryable.
- `cache.test.ts`: hit skips provider (spy); miss writes through; 2dp
  rounding collisions share one row.
- `attach.test.ts`: happy path links + `attached`; re-invoke is a no-op
  (provider called once); indoor/no-location no-op; provider failure →
  `pending`, import-style caller unaffected.
- `manual.test.ts`: manual row written + linked (`manual` status), returned
  by `observationForRun`, excluded from `observationsForRuns`.
- `retry-cron.test.ts`: pending → success; pending past window → `failed`;
  heartbeat row via `handleScheduled("0 * * * *")`.

## Open questions

- Retry cap is time-based (~5 hourly attempts via 5h window), not a stored
  counter — exact-5 needs a `runs.weather_attempts` column (schema change).
  Proceeding on the window; veto if exact counting is required.
- Manual rows occupy the shared cache key; two runs in the same 1.1km/1h
  cell can share (last-writer) a manual row, and a later real fetch replaces
  manual data. Judged acceptable edge cases; flagging for veto.
- `recordManualObservation` requires run coordinates (`lat_r/lng_r` are NOT
  NULL). 102's fallback UI only shows for `failed`/stuck-`pending` runs,
  which always have coords, so no-coord manual temps are unsupported in v1.
- Fixture is built from Visual Crossing's documented response shape — no API
  key exists to record a live one; re-record when the secret lands.
