# Design: 162 Outbox depth and hourly reports

## Problem

A monitoring review (2026-10-29) found four holes in what reaches a human:

1. **Outbox depth is invisible.** The drain takes 50 rows a kind a run, and
   its "owed" line counts only what it claimed, so 3,000 stuck
   `photo_delete` rows read "50 owed; 50 settled" for 60 days. Rows queued
   behind the cap never fail, so the 5-attempt check never sees them.
2. **Hourly findings go nowhere.** `handleScheduled` returns the hourly
   firings' `anomalies`; `src/server.ts` drops them. That includes the
   screening sweep's "OPENAI_API_KEY is not set", unhidden over-threshold
   reports, and export deletes that failed.
3. **The stale-cron check is promised and not built.** Comments in
   `scheduled.ts` say the digest flags stale `cron_checkpoints`; nothing
   does. Sentry Crons covers it (decided 2026-10-29: don't build).
4. **One throwing digest check skips the rest**, including the drain.

## Approach

All in `src/modules/ops/` (`outbox.ts`, `scheduled.ts`) with tests in
`test/ops/`.

- **Drain tallies.** `drainOutbox` returns `{ kind, claimed, settled }` per
  kind instead of pushing lines. The daily digest formats them as today's
  "owed" lines. The hourly firings report only `claimed > settled`: a held
  reminder (Strava, removal) the drain sends is the schedule, not a fault.
- **Still due after the drain** (gap 1). `checkOutboxBacklog` takes the
  drain's `now` and, per known kind, reads the count of rows with
  `next_attempt_at <= now` and the oldest of them. That read is a range on
  `outbox_kind_due`. Any row left is debt the cap could not reach:
  "N photo_delete outbox row(s) still due after the drain (50 a run);
  oldest due 38h". There is no tuned threshold, because a failed row moves
  to its backoff and is no longer due.
- **Hourly reports** (gap 2). A firing with any anomaly lines sends one
  Sentry event, fingerprinted `["hourly", cronName, day]` and tagged
  `digest: hourly`, `cron: <name>`. The default new-issue rule then alerts
  at most once per cron per day. It is deliberately not `digest: daily`,
  so the every-event rule does not page hourly.
- **Isolated digest checks** (gap 4). Each `digestKinds` check runs
  whatever the others do. The firing still throws afterwards, so its
  check-in closes as `error` (the `eachStep` shape).
- **Comments** (gap 3). Remove the stale-checkpoint promise from the
  `handleScheduled` docstring and the TODO in `runDailyDigest`.
- **Docs.** `docs/deployment.md` §8 says that hourly events alert through
  the default new-issue rule and need no rule of their own.

## Contract touches

- Schema changes needed: **none** (the index already serves the read)
- New route files: none
- New bindings/queues/crons: **none**
- Screens: none (Desk/email untouched — see open questions)

## Test plan

All in the `worker` project (integration against D1):

- `outbox.test.ts`: the drain returns its tallies. With 60 due rows and a
  succeeding handler, the backlog check reports 10 still due and their
  age. With 50, it reports nothing. A failed row in backoff is not
  "still due". Unknown kinds are excluded. Add a plan test that the
  still-due read uses `outbox_kind_due`.
- `scheduled.test.ts`: in a weather-retry firing, an email row whose
  handler throws produces one report with the hourly fingerprint and
  tags. A held reminder that settles produces no report. A screening
  firing with no API key reports its line. A firing with no lines reports
  nothing (the existing `anomalies: []` test stays).
- `scheduled.test.ts`: if `weather-backlog` throws, the outbox is still
  drained and checked, the firing throws, and the check-in is `error`.
- Stryker reaches 100% on `outbox.ts` and `scheduled.ts`.

## Open questions

- **Show outbox depth on the Desk's Today and in the morning email?** That
  is a designed screen (D5: three numbers), so it is out of scope here.
  I recommend deferring it until production gives a baseline.
- **Hourly alert noise.** Some hourly lines may turn out to be routine
  ("N review claims went stale…"). The bound is one alert per cron per
  day. If one proves routine, demote that line rather than the channel.
