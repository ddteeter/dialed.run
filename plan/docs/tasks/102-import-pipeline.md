# Task 102 — Run Import Pipeline (parallel lane)

## Goal

Two paths for a run to enter Dialed: (a) manual entry, (b) FIT/GPX/TCX file
upload parsed asynchronously. Plus the Strava webhook as a **reminder-only**
trigger. Compliance rule (non-negotiable): **no Strava activity data is
stored, displayed, or used — ever.** The webhook event's only effect is a
notification row.

## You own

- `src/modules/runs/**` (run CRUD, import, parsers, notifications)
- `src/routes/manifest/runs.ts`
- The Queue consumer for `dialed-imports`
- Tests under `test/runs/**`

## Requirements

1. **Manual entry**: form for `RunDraft` fields (`contracts.ts`), zod-parsed,
   creates `runs` row with `source='manual'`.
2. **File upload**: accept .fit/.gpx/.tcx (≤ 25 MB) → store raw bytes to R2
   under `imports/{userId}/{importId}` → enqueue `ImportJob` → 202 with an
   htmx-polled "processing" fragment.
3. **Parsers** implement `RunSource` from `contracts.ts`:
   - FIT via `@garmin/fitsdk` (pure JS, Workers-compatible — verify in a test).
   - GPX/TCX via `fast-xml-parser`, XXE-safe configuration.
   - Extract: start time, duration, distance, and start lat/lng if present.
   - Malformed files → import row marked failed with a user-facing reason;
     never a thrown 500.
4. **Queue consumer**: parse → insert run (`source='file'`) → call
   `weather.attachObservation(runId)` **if lane 103 has merged; otherwise
   leave the documented TODO call-site** → create "add your outfit"
   notification. Idempotent on redelivery (dedupe on importId).
5. **Strava reminder webhook**:
   - GET subscription validation (hub.challenge echo).
   - POST events: zod-parse envelope; on `activity`/`create` for a connected
     athlete → enqueue `ReminderJob` → notification "New run on Strava —
     log your outfit?". Store nothing else. Respond 200 within 2s always.
   - Strava OAuth connect/disconnect flow writing only `strava_connections`.
6. **Notifications**: minimal bell — unread count in Layout slot, list page,
   mark-read. (You own the notifications module at MVP; feed lane consumes
   its fragment slot only.)

7. **Resilience specifics for this lane** (on top of the CLAUDE.md laws):
   - **Webhook dedupe**: Strava redelivers events. Dedupe via a
     `processed_webhook_events` table with `UNIQUE(object_id, aspect_type,
event_time)` and `INSERT OR IGNORE` — duplicate events are 200 no-ops.
   - **DLQ ownership**: complete the Phase 0 DLQ consumer stub — a
     dead-lettered ImportJob marks the import row `failed` with a
     user-facing reason and notifies the user. No import ends in silence.
   - **Token refresh**: refresh Strava tokens on demand; on refresh failure
     (revoked/expired grant), mark the connection `broken`, notify the user
     to reconnect, and stop retrying. Never loop on a dead grant.
   - **Notification dedupe**: notifications carry a dedupe key
     (`UNIQUE(user_id, kind, subject_id)`), so redelivered jobs can't
     double-notify.

## Out of scope

Outfit entries (lane 104 owns them — your notification links to a route in
`runs.*` that 104 will wire), Garmin/Polar/Fitbit APIs, sync-back to Strava,
route maps, weather internals (adapter calls only).

## Test expectations

- Parser unit tests with real small fixture files (one valid + one malformed
  per format; generate GPX/TCX fixtures by hand, FIT fixture from Garmin's
  SDK examples).
- Webhook: challenge echo, valid event → notification, unknown athlete →
  200 + no-op, invalid payload → 200 + logged (never 5xx to Strava).
- Queue consumer: happy path + redelivery idempotency + failed-parse path,
  in workers pool with a stubbed WeatherProvider.

## Done criteria

Design doc reviewed first (this lane has the most sequence complexity — one
Mermaid sequence diagram required). Then: verify + tests clean; you can
upload a real Garmin-exported FIT file locally and see the run + notification
appear.
