# Design: 102 Runs & Import Pipeline

## Problem

Runs enter dialed three ways: manual entry, async FIT/GPX/TCX upload, and
Strava *reminders* (notification only — no activity data stored, D-14/D-33).
This lane delivers run CRUD, the import queue consumer + DLQ, the parsers,
the notifications bell, and the Strava connect/webhook seam.

## Approach

`src/modules/runs/`: `service.ts` (run CRUD, ±120s dup guard, manual-temp),
`imports.ts` (R2 store + enqueue + status), `parsers/{fit,gpx,tcx}.ts`
(implement `RunSource`; fast-xml-parser with `processEntities:false`),
`consumer.ts` (imports + DLQ batch handlers, deps-injected weather/Sentry),
`notifications.ts`, `strava/{oauth,webhook}.ts` (all Strava HTTP behind a
`StravaApi` seam — no credentials exist yet; config injected, degrades when
absent), `functions.ts` (createServerFn glue, deep-imported by routes like
auth does), `components/`. `ops/queues.ts` stubs delegate to `runs` index.

```mermaid
sequenceDiagram
  participant U as User
  participant W as Worker
  participant Q as dialed-imports
  participant D as D1
  U->>W: upload .fit/.gpx/.tcx (≤25MB)
  W->>W: store R2 imports/{userId}/{importId}, insert imports row
  W->>Q: ImportJob{importId} — client polls status (TanStack Query)
  Q->>W: consume (idempotent: done/failed/duplicate ⇒ re-ack)
  W->>W: parse → RunDraft (no GPS ⇒ indoor)
  W->>D: dup ±120s ⇒ status duplicate + link; else batch[insert run, import done]
  W->>W: TODO weather.attachObservation(runId) (103 unmerged)
  W->>D: INSERT OR IGNORE notification "Add your kit"
  Note over Q,W: retries exhaust → DLQ → import failed + user notification
```

Strava: webhook GET echoes `hub.challenge`; POST zod-parses, dedupes via
`processed_webhook_events` INSERT OR IGNORE, enqueues ReminderJob for
connected athletes, always 200 fast. Notification body has zero activity
data; deep-links to `/runs/new` (D-33). Token refresh on demand (used by
deauthorize); refresh failure ⇒ connection `broken` + notify, no retry loop.
Connect is CSRF-guarded by a short-lived state nonce round-tripped through
an httpOnly cookie (`getCookie`/`setCookie`, no new binding); disconnect
refreshes first only if the stored token has already expired, then
best-effort revokes via Strava and always deletes the local row even if
that call fails (law 5) — `completeStravaConnect` upserts
(`onConflictDoUpdate` on `userId`) so reconnecting after `broken` replaces
the row outright.

## Contract touches

- Schema changes needed: **none**.
- New routes: `runs/index`, `runs/new` (A1), `runs/manual`, `runs/$runId`,
  `runs/import.$importId`, `runs/notifications`, `runs/strava`,
  `runs/strava-callback`, plus pre-authorized `api/strava.ts`.
- New bindings/queues/crons: **none**. New optional *secrets* declared in
  `src/env/env.d.ts` (pattern set by GOOGLE_*): `STRAVA_CLIENT_ID/SECRET`,
  `STRAVA_WEBHOOK_VERIFY_TOKEN` — human sets via `wrangler secret`.
- Screens: A1 (+ deltas #2 manual entry, #3 notifications, #6 Strava).
- Coordinated seams: weather public API `attachObservation(runId)` /
  `recordManualObservation(runId, tempC)` (103's packet names these; TODO
  call-sites until it merges — manual-temp sets run `weather_status='manual'`
  now). 104's entry-creation deep-link: "Add your kit" notification links to
  `/runs/$runId`, which hosts the CTA slot 104 repoints. TabBar "+ Add" →
  `/runs/new` (TabBar comment says `/add`; directory-ownership rule wins).
  Layout gains an optional `bell` prop (additive) to mount the bell slot.
- ReminderJob rides the existing `dialed-imports` queue (discriminated
  `type`); notification dedupe subject = webhook `object_id` (already a
  contract-sanctioned dedupe key in `processed_webhook_events`).

## Test plan

`test/runs/`: `parsers.test` (unit: valid+malformed per format, FIT fixture
built with Garmin SDK Encoder, treadmill⇒indoor); `service.test` (manual
entry, indoor `weather_status='none'`, dup guard ±120s); `consumer.test`
(integration, workers pool, stubbed weather dep: happy path, redelivery
idempotency, failed parse, duplicate, DLQ⇒failed+notified, plus the
`strava_reminder` queue-message branch); `strava-webhook.test` (challenge
echo, valid event⇒enqueued reminder, unknown athlete 200 no-op, invalid
payload 200+logged, non-create/non-activity no-op, redelivery dedupe);
`strava-oauth.test` (connect/reconnect upsert, refresh ok/broken +
dedupe-notify-once, disconnect revoke/refresh/degrade paths);
`notifications.test` (dedupe UNIQUE, unread count, mark-read). (Renamed
from the originally-sketched `webhook.test`/`strava.test` to keep the
oauth and webhook seams in separate files — no behavior change.)

## Open questions

- Manual outdoor runs default coords from `user_profiles.lat/lng` when the
  form omits location; absent both ⇒ `weather_status='failed'` (enables the
  D-24 manual-temp fallback immediately). Guess — veto early if wrong.
- `@tanstack/react-query` added as a dependency, provider scoped to the
  import-status route only (CLAUDE.md sanctions Query for polling fragments).
- Tooling flag (not a design question, but worth a human look): the
  guardrails commit-gate's `skipped-test` signature
  (`f(?:it|describe)` in `chunk-RO3Q5HUB.mjs`) false-positives on the bare
  *code* identifier `fit` — not just Jasmine's focused `fit(...)` — because
  it matches on raw diff text outside of strings/comments. Hit it once in
  `parsers/index.ts`'s `sourcesByExtension` map; worked around by quoting
  the key (`["fit"]:`) rather than suppressing. Domain vocabulary like a
  bare `const fit = ...` would hit the same false positive with no clean
  workaround short of renaming.
