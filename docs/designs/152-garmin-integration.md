# Plan: 152 Garmin integration

Status: **phase 1 approved** (owner, 2026-10-24). This is a plan, not a lane
design doc: it sequences the work across the owner-only pre-launch, the
Starter tier and Enterprise. Each phase that writes code gets its own short
design doc when it starts; phase 1's is `152-garmin-phase-1.md`.

## Why

Logging a Garmin run today takes a desktop: sync the watch, open Garmin
Connect on the web, download the file, upload it here. Garmin reopened its
Connect Developer Program on 2026-10-21 in three tiers, and the free ones
deliver the original `.FIT` file, which the existing parser already reads.

| tier       | for                        | data          | delivery  | history | cost                                            |
| ---------- | -------------------------- | ------------- | --------- | ------- | ----------------------------------------------- |
| Personal   | one person, their own data | JSON + `.FIT` | pull only | —       | free                                            |
| Starter    | an app, ~1,000 users       | JSON + `.FIT` | push only | none    | free                                            |
| Enterprise | an app, unlimited          | JSON + `.FIT` | push/pull | 1 mo+   | entry fee, then per active user from 2027-04-01 |

Sources: [program overview](https://developer.garmin.com/gc-developer-program/overview/),
[API brand guidelines](https://developer.garmin.com/downloads/brand/Garmin-Developer-API-Brand-Guidelines.pdf).

**Garmin is not Strava.** D-14 keeps Strava activity data out of the app
because Strava's terms forbid showing it to other users. A run from the
runner's own Garmin watch is first-party data, the same as an uploaded
file, and may be shared to the feed, with Garmin credited on it (G1). That
gets a decision row of its own when phase 1 merges.

**Attribution.** "Garmin {device model}" beside Garmin-sourced data, or
"Garmin" alone when the model is unknown (brand guidelines; design G1).
Only data that came through Garmin's API is attributed; a file the runner
uploads themselves carries nothing.

## Phase 1 — owner-only pull: "Import from Garmin"

The Personal tier is pull-only and is for the key holder's own data, so this
is a feature for the owner's account and nobody else's. It is a new front
door on the existing import pipeline: pick a run, we fetch its `.FIT`, and
from there it is an upload like any other.

```
Import from Garmin ─► list recent activities (Personal API)
   └─ pick one ─► fetch .FIT (one attempt, 10s) ─► startImport() ─► imports queue ─► FIT parser ─► run
```

Fetching in the request is deliberate: the runner is waiting, a failure
says so and they can tap again (law 8c's "neither" case). Phase 3, where
nobody is waiting, uses the queue.

Rejected: letting any runner paste their own Personal key. The key is
personal to its holder, and it would mean collecting a runner's Garmin
credentials.

Steps, tests and done-when are in `152-garmin-phase-1.md`. In short:

- **Config**: `GARMIN_API_KEY` and `GARMIN_OWNER_USER_ID`, both Worker
  secrets read only in `src/env`; either one absent hides the feature.
- **Schema** (additive): `runs.rpe`, `runs.effort_source`,
  `runs.device_name`, and `imports.garmin_activity_id` with a UNIQUE index
  on `(user_id, garmin_activity_id)`, so a run picked twice, or pushed after
  it was picked, imports once. `runs.source` gains `"garmin"`.
- **Device name**: "Garmin" alone in phase 1, because the Personal API never
  gives the model. Phase 3 takes the model from the Activity API's device
  name. No hand-kept table of product codes.
- **Effort from the watch** (owner, 2026-10-24; design G5): the runner's own
  perceived-effort rating, which Garmin watches ask for after every run.
  FIT `session.workout_rpe` and the API's `directWorkoutRpe` store it ×10.
  It's stored as `runs.rpe` (1–10) and prefills `runs.effort`: 1–4 easy, 5–6
  steady, 7–8 workout, 9–10 race, with `effort_source = 'watch'` until the
  runner taps. Garmin's `race` event type is deliberately not used: a race
  can be run at any effort. This works for any FIT upload, not only
  Garmin's. Heart rate is still not read or stored. The Call epic revisits
  it with Washington's health-data consent, and even then keeps an
  effort-like summary, not the stream.
- **Server functions, UI (G3), attribution (G1), e2e demo against a stub.**

**Never commit the owner's own `.FIT`, or a payload recorded from the
owner's account.** A real file starts at a front door and the repo is
public. Fixtures are synthetic or the existing test file.

## Phase 2 — pre-launch for the owner, and the Starter application

Mostly deployment-sweep items (`docs/launch/deployment-plan.md`), pulled
forward:

1. Deploy the app and the marketing site for the owner: invite-only, the
   site at `SITE_INDEXABLE=false`. Phase 1 works from the phone from here.
2. When the LLC is formed (expected late November 2026): fill the `[OWNER]`
   markers, and add to the privacy policy what Garmin sends us (activity
   summary and `.FIT`: time, duration, distance, rounded start point,
   device, perceived effort), why, that the file is deleted once read
   (D-116), and how to withdraw (disconnect). The terms take whatever the
   program asks of them.
3. Publish them (`published: true`), so the marketing site renders
   `/privacy` and `/terms`.
4. Apply for Starter **as the LLC**, with the site URL, the privacy policy
   URL, and the attribution mockups (the board's GARMIN SUBMISSION frames).

## Phase 3 — Starter: connect, push, import

After approval. The picker goes away: Starter is push-only and has no
history, so new runs arrive on their own and old ones come from an archive
import.

- **Connect** (drawn as G4): a consent screen, then Garmin's authorization
  flow; a `garmin_connections` table (user, Garmin user id UNIQUE, tokens).
  Disconnect is the withdrawal of consent.
- **Push webhook** under `src/routes/api/`: verify, zod, dedupe through
  `processed_webhook_events`, enqueue a new `garmin_fetch` variant (law 9)
  per activity. The consumer fetches the `.FIT`, writes it to R2 and joins
  the import path; the `imports` UNIQUE index from phase 1 makes
  redelivery a no-op.
- **Notification**: "New run from Garmin: add your kit". A Garmin import
  clears a matching Strava reminder, as a file upload does
  (`reminder_matched_at`).
- **Deregistration and permission-change webhooks** delete the connection;
  account deletion deregisters through the outbox, like
  `strava_revocations`.
- **Derived line** (G2) on E2, and a `source` column in `runs.csv` (G1).
- **Capacity**: count connections against Starter's cap; hide Connect near
  it (a product call on the threshold).
- **Retire phase 1** once the owner's own account is connected through
  Starter, so there is one path.
- Bindings, secrets and the webhook registration are human-managed; the
  architecture diagram gains the Garmin path in the same PR.

## Open questions

Phase 1, answered from Garmin's published OpenAPI spec
([Personal API docs](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/))
and the spike against the owner's account (2026-10-24):

- **Token**: `POST https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token`
  with `Authorization: ApiKey <key>` returns the access token as a
  **plain-text JWT** (not JSON), valid **24 hours**, sent on later calls
  as `Authorization: Bearer <token>`. Scopes are read-only, including
  fitness, wellness and nutrition; we call only the activity endpoints.
  The key itself expires on a date the owner picks, so it needs a
  rotation reminder.
- **List**: `GET /activitylist-service/activities/search/activities`
  with `start`, `limit` (default 99), `activityType=running`, and
  `startDate`/`endDate`. **`running` includes its subtypes**: the spike
  returned `running`, `trail_running` and `treadmill_running`. A
  treadmill run has no start point and maps to `indoor`. Each summary has
  95 fields, among them `activityId`, `activityName`, `startTimeGMT`
  (`yyyy-MM-dd HH:mm:ss`, no offset), `distance` (m), `duration`,
  `elapsedDuration` and `movingDuration` (s), `elevationGain` (m) and
  `startLatitude`/`startLongitude` (precise, so rounded per R-110). It
  also has heart rate, power and training effect, which we do not read.
- **Download**: `GET /download-service/files/activity/{activityId}`
  returns a zip (`application/x-zip-compressed`) holding one deflated
  entry, `<activityId>_ACTIVITY.fit`: 120 KB zipped, 315 KB unzipped for
  a 7 km run. The repo's zip library (`client-zip`) only writes, so phase 1
  reads the entry with the Workers-native `DecompressionStream("deflate-raw")`
  and a small single-entry reader.
- **Device name**: the Personal API never names the model: not the list,
  not the activity detail, not the wellness summaries (checked against the
  owner's account). The FIT file has only the SDK's product key
  (`garminProduct: 'fr970'`, product 4565), and Garmin publishes no table
  from keys to display names. Garmin's business Activity API does carry a
  device name (Fitabase's Garmin data dictionary lists `DeviceName`), so
  phase 1 says "Garmin" and phase 3 says the model.
- **Perceived effort**: the activity detail's `summaryDTO.directWorkoutRpe`
  and `directWorkoutFeel`, and the FIT session's `workout_rpe` and
  `workout_feel`, hold what the runner answered on the watch. RPE is ×10
  (the owner's runs: 20, 60, 10, 50, 20); feel is 0–100 in steps of 25.
  `trainingEffectLabel` was `AEROBIC_BASE` on all five runs, so it says
  little; the runner's own rating is the better signal.
- **Rate limits**: none documented, and no rate-limit headers came back.
  Garmin may throttle without notice, so the picker makes one list call
  per open, and nothing polls.
- **Terms**: the Personal API's supplemental terms (accepted with the
  key) say the key is personal to the owner, may be used only in tools
  the owner develops or operates for their own use, and must not be
  shared. The feature therefore stays limited to the owner's own
  account, with the key held as a Worker secret.

Phase 3 (answered by the Starter docs):

- Does a push carry the `.FIT`, or a callback URL to fetch it from?
- Which authorization flow (OAuth 2.0 with PKCE is the assumption), and how
  a push proves it came from Garmin.
- What the Starter form asks for beyond a website and a privacy policy URL.
