# Task 103 — Weather Service (parallel lane)

## Goal

Every run with a location gets weather conditions attached, fetched once and
cached forever. Provider-agnostic behind the `WeatherProvider` contract.

## You own

- `src/modules/weather/**`
- The `dialed-weather` D1 schema usage (schema itself is already defined in
  contracts; migrations for it were created in Phase 0)
- The retry cron (see below)
- Tests under `test/weather/**`

## Requirements

1. **Visual Crossing adapter** implementing `WeatherProvider`
   (`contracts.ts`): Timeline API, metric units, zod-parse every response
   field you consume — the API response is a trust boundary. API key from
   `env` (Workers secret; never in code or config).
2. **Cache layer**: before any provider call, check
   `weather_observations` on `(lat_r, lng_r, hour_bucket)` — lat/lng rounded
   to 2 decimal places (~1.1 km), hour floor. Write-through on fetch. The
   cache is the budget: 1,000 free records/day must be unreachable in normal
   operation.
3. **Public module API** (the only exports in `index.ts`):
   - `attachObservation(runId: Ulid): Promise<void>` — reads the run's
     lat/lng/started_at, resolves an observation (cache or fetch), links it.
     No-op with a structured log if the run has no location.
   - `forecast(lat, lng, at)` — thin pass-through with the same cache,
     built now, consumed post-MVP by Pick-My-Outfit.
4. **Failure isolation**: a provider outage must never fail an import.
   `attachObservation` catches, marks the run `weather_pending`, and a
   **cron (hourly)** retries pending runs with capped attempts (5), then
   gives up permanently with a log.
5. **Attribution**: export a `WeatherAttribution` UI fragment ("Weather by
   Visual Crossing", linked) — free-tier terms require it; feed lane renders
   it wherever conditions display.
6. **Resilience specifics**: the retry cron uses the claim pattern from
   CLAUDE.md (`UPDATE ... WHERE status='pending'` batch claim) so overlapping
   invocations can't double-fetch; every provider call carries
   `AbortSignal.timeout(10_000)`; the cron writes its `cron_checkpoints`
   heartbeat; runs that exhaust retries set `weather_failed` (counted by the
   daily digest), and `attachObservation` is idempotent — re-invoking it on
   a run that already has an observation is a no-op.

## Out of scope

Displaying weather (feed lane renders it from the DB), forecast UI,
recommendations, provider switching UI, Open-Meteo adapter (post-MVP).

## Test expectations

- Adapter: recorded real Visual Crossing response as fixture → zod parse →
  mapped observation. Plus a malformed-response test (parse failure surfaces
  as retryable error, not a crash).
- Cache: hit avoids provider call (spy), miss writes through, rounding
  collisions share a row.
- Retry cron: pending → success, pending → exhausted paths.

## Done criteria

Design doc (short — this lane is the simplest; no diagram needed unless you
disagree with the retry design). Verify + tests clean. A locally imported
run with GPS shows an observation row within one consumer pass.
