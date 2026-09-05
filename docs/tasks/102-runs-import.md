# Task 102 — Runs & Import Pipeline (parallel lane)

## Goal

Runs enter dialed three ways: (a) manual entry, (b) FIT/GPX/TCX single-file
upload parsed asynchronously, (c) _reminders_ from Strava. Compliance rule
(non-negotiable): **no Strava activity data is stored, displayed, or used —
ever.** The webhook event's only effect is a notification row. Implements
screen A1 plus the undesigned manual-entry, notifications, and Strava
surfaces (docs/design-deltas.md #2, #3, #6 — use placeholder-faithful
layouts per the brand rules; deltas will refine them).

## You own

- `src/modules/runs/**` (run CRUD, import, parsers, notifications)
- `src/routes/runs/**` and `src/routes/api/strava.ts`
- The Queue consumer for `dialed-imports`
- Tests under `test/runs/**`

## Requirements

1. **Manual entry**: form for `RunDraft` fields (contracts.ts) including
   `indoor` and optional `effort`; zod-parsed; creates `runs` row with
   `source='manual'`. Indoor runs get `weather_status='none'` and an
   `[INDOOR]` badge; no conditions ever requested for them.
2. **File upload (A1)**: accept .fit/.gpx/.tcx (≤ 25 MB) → store raw bytes to
   R2 under `imports/{userId}/{importId}` → insert `imports` row → enqueue
   ImportJob → client polls import status (TanStack Query; loader-first
   otherwise). **Duplicate guard**: same user + started_at within ±120s of an
   existing run → import completes as `duplicate`, UI offers to open the
   existing run (flow map A1).
3. **Parsers** implement `RunSource` from contracts.ts:
   - FIT via `@garmin/fitsdk` (pure JS, Workers-compatible — verify in a test).
   - GPX/TCX via `fast-xml-parser`, XXE-safe configuration.
   - Extract: start time, duration, distance, start lat/lng if present.
   - No GPS track (treadmill) → run imports as `indoor` unless the user sets
     a location afterward.
   - Malformed files → import row `failed` with a user-facing reason
     ("That file didn't parse. Try the original export from your watch."),
     never a thrown 500.
4. **Queue consumer**: parse → insert run (`source='file'`) → call
   `weather.attachObservation(runId)` **if lane 103 has merged; otherwise
   leave the documented TODO call-site** → create "Add your kit"
   notification. Idempotent on redelivery (dedupe on importId).
5. **Weather fallback UI** (D-24): when `weather_status` is `failed` (or
   `pending` past its retries), the run page shows `[UNAVAILABLE]` with an
   optional manual temp field → stores a `source='manual'` observation via
   the weather module's public API (coordinate the function signature in your
   design doc; stub it if 103 hasn't merged). Copy discloses it won't train
   the model.
6. **Strava reminder webhook**:
   - GET subscription validation (hub.challenge echo).
   - POST events: zod-parse envelope; on `activity`/`create` for a connected
     athlete → enqueue ReminderJob → notification "New run on Strava — log
     your kit?". Store nothing else. Respond 200 within 2s always.
   - **D-33**: the notification body contains zero activity data — no
     distance, pace, or time-of-day from Strava — and deep-links to +Add
     (not a pre-created run). The revised L artboard's mock violates this;
     the compliance rule wins.
   - OAuth connect/disconnect flow writing only `strava_connections`.
7. **Notifications**: minimal bell — unread count in the Layout slot, list
   page, mark-read. You own the notifications module at MVP; 104 deep-links
   its entry-creation route from your notification (coordinate the route
   name in your design doc).
8. **Resilience specifics** (on top of the CLAUDE.md laws):
   - **Webhook dedupe** via `processed_webhook_events` UNIQUE +
     `INSERT OR IGNORE`; duplicates are 200 no-ops.
   - **DLQ ownership**: complete the Phase 0 DLQ consumer stub — a
     dead-lettered ImportJob marks the import `failed` with a user-facing
     reason and notifies the user. No import ends in silence.
   - **Token refresh**: refresh Strava tokens on demand; on refresh failure,
     mark the connection `broken`, notify the user to reconnect, stop
     retrying. Never loop on a dead grant.
   - **Notification dedupe** via `UNIQUE(user_id, kind, subject_id)`.

## Out of scope

Outfit entries (lane 104), bulk archive import (cut, D-13), Garmin/Polar/
Fitbit APIs, sync-back to Strava, route maps, weather internals (adapter
calls only).

## Test expectations

- Parser unit tests with real small fixture files (one valid + one malformed
  per format; generate GPX/TCX fixtures by hand, FIT fixture from Garmin's
  SDK examples).
- Duplicate-guard test (±120s window).
- Webhook: challenge echo, valid event → notification, unknown athlete →
  200 no-op, invalid payload → 200 + logged (never 5xx to Strava).
- Queue consumer: happy path + redelivery idempotency + failed-parse path,
  in workers pool with a stubbed WeatherProvider.

## Done criteria

Design doc committed (this lane has the most sequence complexity — one
Mermaid sequence diagram required; async review, but your Strava route file
in `src/routes/api/` is pre-authorized by this packet). Verify + tests
clean; you can upload a real Garmin-exported FIT file locally and see the
run + notification appear.
