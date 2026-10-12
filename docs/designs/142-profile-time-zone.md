# Design: 142 Profile time zone

## Problem

Nothing stores a runner's time zone, so anything that needs their day or
clock (PR #187's reminder email, "when your day starts") guesses it from the
latest run's weather. The owner approved, on 2026-10-12, caching the zone on
the profile. It is derived from the home city and never typed by the runner.

## Approach

- **One writer.** `onboarding/profile.ts`'s `placeWrite` is the only writer of
  `city_label`/`lat`/`lng` (FEED-5). It is the only caller that sends one
  (`saveCalibration` for O1, `savePlace` for Your conditions; grep confirms
  nothing else sets those columns). It now writes `time_zone` in the same
  statement. A new place gets a new zone, and a place with no coordinates gets
  NULL, so the zone can never describe a city the profile no longer holds.
- **Lookup before the write** (`onboarding/time-zone.ts`, `zoneForPlace`).
  This is a read that decides what to write, so it goes first, and the place
  and zone land in one upsert. The lookup is weather's new `timeZoneAt`,
  exported through its index. It is `forecast(lat, lng, now).timeZone`:
  the same Visual Crossing client, timeout, zod parse and `isTimeZone` check,
  and the same observation cache, so there is no second way to call Visual
  Crossing. It is handed in (`ZoneDeps`), as `lookUpCity`'s resolver is.
- **Degrade, don't fail.** If the lookup throws, the error is reported with
  `userId` only and the place is saved with a NULL zone. The save never fails
  because of the zone.
- **Reconciliation, not an outbox.** A NULL zone on a row with coordinates is
  the "not finished" marker. The hourly `weather-retry` (`:00`) firing gains
  a last step, `fillMissingTimeZones`: up to 10 such rows, looked up in
  parallel. Each is written with a compare-and-set on the same coordinates and a
  still-NULL zone, so a place changed mid-lookup is never given the
  old zone, and overlapping firings write once. No new cron. `ops` imports
  `onboarding`'s index directly, because onboarding's barrel does not reach
  `ops`, so there is no cycle and no `DailyUpkeep` field is needed.
- **One read.** `runnerTimeZone(db, userId)` in onboarding returns the profile
  zone, else the zone of the latest of the runner's 5 newest located runs
  whose observation named one, else `"UTC"`. The run fallback is assembled in
  code, because core and weather are two databases.
- **Export.** `profile.csv` gains `time_zone` after `place`.

## Contract touches

- Schema: **additive**. `user_profiles.time_zone text NULL`, migration
  `add_profile_time_zone` (0057 here; it renumbers at merge, law 11).
- Routes, bindings, queues, crons: **none** (an existing firing gains a step).
- Screens: **none**. No UI change.

## Test plan (all worker)

- `test/weather/zone.test.ts`: the zone the provider names; undefined when
  it names none.
- `test/onboarding/time-zone.test.ts`: the save stores the zone; a failed
  lookup still saves the city with a NULL zone and reports; a coordinate-less
  place stores NULL without asking; changing the city replaces the zone; a
  failed re-lookup clears it; the fill writes, skips a place that changed,
  and leaves failures NULL; each precedence step.
- `test/ops/scheduled.test.ts`: the `:00` firing fills a missing zone.
- `test/account/export.test.ts`: the `time_zone` column and its README line.

## Open questions

- The fill's query has no index. `user_profiles` is one row per runner, and
  the scan runs hourly. A partial index on rows with coordinates and no
  zone would make it free, but the owner asked for a single ADD COLUMN.
  Proceeding without it; the index can be added in a later migration.
- A row that Visual Crossing answers with no usable zone is asked again
  every hour, 10 rows at most. Proceeding; Visual Crossing names a zone for
  every coordinate we have seen.
