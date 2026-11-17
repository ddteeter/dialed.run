# Design: 231 sec-limits

## Problem

Wave 13 lane 13b: ten items from the 2026-11-14 security audit, tracked by
id only in #756 (SA-M11, SA-M12, SA-M13, SA-M14, SA-M17, SA-M27, SA-M28,
SA-M36, SA-L07, SA-L15). This lane puts a count, a bound or a check in
front of each thing one visitor or runner can ask the app to do again:
email, weather lookups, uploads, purges and stored rows.

## Approach

Every count is a `rate_limits` kind through `modules/email/rate-limit.ts`
(design 221), keyed by `(kind, subject)`, swept daily and forgotten by the
purge where the subject is a runner.

- **SA-M11.** A count kept per visitor keys an IPv6 address by its /64
  (`lib/visitor-address.ts`); IPv4 is kept as it is. The key is made in
  `rate-limit.ts` by kind, so every per-visitor kind gets it. The takedown
  requester key uses the same address. A takedown receipt is mailed at
  most a few times an hour per recipient address.
- **SA-M12.** Resend confirmation counts the visitor before the address
  (kind `resend-visitor`), and the address must parse as one.
- **SA-M13, SA-M27.** Each runner's weather-provider calls are counted
  per day (kind `weather-runner`), in the weather module, in front of
  every provider call made for that runner: a city lookup, climate
  normals, a run's hours (the cron's retries included), a zone lookup.
  Past the budget the call is treated as the provider being down (law 5).
  The starter list asks for normals only on a request the app's own page
  started (`Sec-Fetch-Site`).
- **SA-M14.** A kit's photo count is part of the insert (one
  `INSERT … SELECT … WHERE count < 4`); a refused insert deletes its
  object. Photo uploads, kit and garment, are counted per runner per day
  (kind `photo-runner`).
- **SA-M17.** `itemFlags` is capped at the kit's item cap (one constant
  both schemas read) and repeats collapse to the last. A product link has
  a length ceiling. Run and import ids, a feed cursor's id and the Strava
  callback's strings have ceilings.
- **SA-M28.** A per-kind table beside `PREFERENCE_OF` says which mail
  needs a confirmed address; `strava_disconnected` does, for a runner
  recipient.
- **SA-M36.** The daily auth sweep deletes Better Auth's `rate_limit`
  rows a day past their last request. A path under `/api/auth/` that is
  not one of Better Auth's endpoints answers 404 before the handler.
- **SA-L07.** Turnstile's answer carries its `action`; each in-app form's
  check names the action it expects (`sign-up`, `request-access`,
  `takedown`), exempt with the test keys as the hostname check is.
- **SA-L15.** A verdict prompt is recorded only for the runner's own
  unjudged kit. A run's title is not sent to other runners. A verdict
  saved again unchanged does not purge, and the purges one runner's writes
  cause are counted per runner (kind `purge-runner`); past it, the page
  waits out its 60-second lifetime.

## Contract touches

- Schema changes needed: **none** (new `rate_limits` kinds only).
- New route files: none.
- New bindings/queues/crons: **none** (the sweeps ride the daily cron).
- Screens: new refusal sentences on Au4 (Resend) and the photo uploads,
  the product link's ceiling, W1's subject line; one privacy-policy
  sentence.

## Test plan

All vitest (worker, plus dom tests for new sentences); no flow crosses a
new server boundary.

- `test/lib/visitor-address.test.ts`; access, takedown and Resend counts
  across one /64, two /64s, IPv4.
- Weather: the budget at bound and bound + 1 for each entry, the cron
  retry counted, a cross-site starter list makes no provider call.
- Photos: a racing batch stores four rows and four objects; the daily cap.
- Inputs: 41 flags refused, repeats send one update, the link ceiling.
- Delivery: an unconfirmed runner gets no Strava notice, still gets
  `verify_email`; an `{ address }` invite still goes.
- Auth sweep; the path matcher; Turnstile `wrong-action`; the prompt
  insert; payloads carry no run title; the purge skip and the count.

## Issues

- Refs #756 (ids ticked by the coordinator on merge).

## Open questions

Every number and sentence is a guess held for the owner (asked through
the coordinator, 2026-11-16); this lane does not ship until answered.

## Owner answers

Pending.
