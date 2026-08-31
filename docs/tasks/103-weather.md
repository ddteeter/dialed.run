# Task 103 — Weather Service (parallel lane)

## Goal

Every outdoor run with a location gets conditions attached, fetched once and
cached forever. Provider-agnostic behind the `WeatherProvider` contract.

## You own

- `src/modules/weather/**`
- The `dialed-weather` D1 schema usage (schema itself defined in contracts;
  migrations created in Phase 0)
- The retry cron
- Tests under `test/weather/**`

## Requirements

1. **Visual Crossing adapter** implementing `WeatherProvider`: Timeline API,
   metric units, zod-parse every response field you consume — the API
   response is a trust boundary. API key from `env` (Workers secret).
2. **Cache layer**: before any provider call, check `weather_observations`
   on `(lat_r, lng_r, hour_bucket)` — lat/lng rounded to 2dp (~1.1 km), hour
   floor. Write-through on fetch. The cache is the budget: 1,000 free
   records/day must be unreachable in normal operation (bulk backfill was
   cut in D-13; single-run attach is the only demand).
3. **Public module API** (the only exports in `index.ts`):
   - `attachObservation(runId: Ulid): Promise<void>` — reads the run's
     lat/lng/started_at, resolves an observation (cache or fetch), links it,
     sets `runs.weather_status`. No-op with a structured log if the run has
     no location or is indoor.
   - `recordManualObservation(runId, tempC)` — writes a `source='manual'`
     observation for lane 102's fallback UI (D-24). Manual rows are excluded
     from every aggregate the module exposes.
   - `forecast(lat, lng, at)` — thin pass-through with the same cache, built
     now, consumed by the call epic.
   - `WeatherAttribution` component ("Weather by Visual Crossing", linked) —
     free-tier terms require it; 104 renders it wherever conditions display.
4. **Failure isolation**: a provider outage must never fail an import.
   `attachObservation` catches, marks the run `weather_pending`, and an
   **hourly cron** retries pending runs with capped attempts (5), then sets
   `weather_failed` permanently with a log (counted by the daily digest).
5. **Resilience specifics**: the retry cron uses the claim pattern
   (CLAUDE.md law 2); every provider call carries
   `AbortSignal.timeout(10_000)`; the cron writes its `cron_checkpoints`
   heartbeat; `attachObservation` is idempotent — re-invoking on a run that
   already has an observation is a no-op.

## Out of scope

Displaying weather (104 renders from the DB), forecast UI, recommendations,
provider switching UI, Open-Meteo/NWS adapters (post-MVP; the design's "NWS"
label is a design delta, not a requirement).

## Test expectations

- Adapter: recorded real Visual Crossing response as fixture → zod parse →
  mapped observation; malformed-response test (retryable error, not a crash).
- Cache: hit avoids provider call (spy), miss writes through, rounding
  collisions share a row.
- Manual observation: written, linked, excluded from aggregates.
- Retry cron: pending → success, pending → exhausted paths.

## Done criteria

Design doc committed (short — simplest lane; no diagram needed unless you
disagree with the retry design). Verify + tests clean. A locally imported
run with GPS shows an observation row within one consumer pass.
