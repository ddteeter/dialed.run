# Design: 227 sec-ingest

## Problem

Wave 12 lane 12c: seven items from the 2026-11-14 security audit, tracked
by id only in #756 (SA-M6, SA-M29, SA-M31, SA-M32, SA-L04, SA-L05, SA-L17).
This lane hardens how outside input gets in: the Strava webhook and
connect flow, run-file imports, the manual run form, product-page
reading, links and photo uploads.

## Approach

- **SA-M6, Strava webhook.** Events and the handshake are served at
  `/api/strava/$key`. The handler compares `$key` with a new secret,
  `STRAVA_WEBHOOK_PATH_SECRET`, before it reads the body, and fails closed
  when the secret is unset or blank. Any other key gets a 404. The
  subscription-id check stays as the second check. `event_time` is a whole
  number within a window around now. The deploy steps register the new
  callback URL, and the secret gets rows in the deploy checklists.
- **SA-L17, Strava connect.** Strava always shows its consent screen
  (`approval_prompt=force`). A reconnect to a different Strava athlete
  owes a revoke for the replaced grant, in the same batch. The state
  cookie is `__Host-strava_oauth_state`.
- **SA-M29, run-file imports.** The XML parser builds no path strings
  (`jPath: false`), and a document over an element budget is refused
  before its tree is built. The FIT decoder refuses a file past a cap on
  field descriptions, and a definition with a zero-size developer field.
  The consumer re-parses an import left mid-parse once; the delivery
  after that fails it without parsing (decided on the message's
  `attempts`). There is a cap of 30 run-file uploads a day per runner, counted
  in the shared rate-limit table (#786's `rate_limits`).
- **SA-M31, run start.** A start more than a day ahead of now is refused,
  for a manual run and for a retime, by the service. The schema keeps a
  fixed ceiling as well.
- **SA-M32, Shopify rung.** The `var meta` blob is found by a linear scan
  that keeps the rung's current matches. The snapshot row is written before
  the ladder runs (after #786 merges, since it touches `consume.ts`).
- **SA-L04.** Hosts lose a trailing dot before the denylist and fetch-guard
  checks, and an operator's bare domain does too. `readableText` stops after
  a few passes, and long raw nodes are skipped before decoding. A garment's
  product link comes only from the server's own resolution (in
  `closet/service.ts`, after #786).
- **SA-L05.** The JPEG header walk skips fill bytes and refuses any marker
  it does not understand. `src/server.ts` refuses a request body over a
  ceiling before the framework reads it (`modules/ops/body-cap.ts`, a
  counting stream behind the `Content-Length` early exit).
- **SA-L17 (cont.)** The Garmin download and its inflate are read through
  capped readers. An import failure that is not a `RunParseError` shows the
  generic sentence and goes to Sentry.

## Contract touches

- Schema changes needed: **none** expected (the upload count reuses #786's
  rate-limit table).
- New route files: `src/routes/api/strava.$key.ts` replaces `strava.ts`.
- New bindings/queues/crons: one new **secret**, `STRAVA_WEBHOOK_PATH_SECRET`
  (owner, 2026-11-15). `max_batch_size: 1` for `dialed-imports` and
  `dialed-enrichment` is a `wrangler.jsonc` edit; asked of the coordinator.
- Screens: two new sentences, on Import and on the manual run form; no
  board change.

## Test plan

All vitest (worker, plus dom tests for the two sentences). The Strava
e2e journey (`e2e/strava/strava.journey.spec.ts`) moves to the new path,
and gains a case: a wrong key answers 404 and leaves no bell row.

- `test/runs/strava-webhook.test.ts`: key match, wrong key, unset or blank
  secret; `event_time` window and integer.
- `test/runs/strava-oauth.test.ts`: force prompt, the revoke owed on an
  athlete change (and none for the same athlete), the cookie name.
- `test/runs/gpx.test.ts`, `fit.test.ts`, `consumer.test.ts`: budgets at
  bound and bound + 1, a real long run still parses, the reclaim count,
  non-parse errors, the upload cap. `garmin-api`/`garmin-unzip`: capped reads.
- `test/lib/contracts-forms.test.ts`, run service: the future start.
- `test/enrichment/shopify.test.ts`, `html.test.ts`, `consume.test.ts`;
  `test/safety/denylist.test.ts`; `test/closet/product-link.test.ts`;
  photo pipeline; `body-cap` plus a text check that `server.ts` calls it
  before `startFetch`.

## Issues

- Refs #756 (ids ticked by the coordinator on merge).

## Open questions

- Guesses (technical, measured where possible): the XML element budget,
  the FIT description cap, the body ceilings (run-file cap plus slack for
  multipart, a few hundred kB otherwise), the `event_time` window.

## Owner answers (2026-11-15)

- The Strava callback key is a new secret, not the verify token.
- Strava always asks on connect. The cookie is renamed.
- 30 run-file uploads a day per runner: "That's 30 run files today. You
  can upload more tomorrow."
- A run's start may not be in the future: "Pick a start that isn't in
  the future."
- An import interrupted mid-parse is re-parsed once, then failed.
