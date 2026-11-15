# Design: 221 sec-0-highs

## Problem

Wave 11 lane 11a: the three stage-0 items from the 2026-11-14 security
audit, tracked by id only in #756 (SA-H1, SA-H2, SA-H3). This lane
hardens account closure, the email-change request and enrichment spend.

## Approach

- **SA-H1, account closure.** `banUser` (`modules/safety/bans.ts`) writes
  the ban as an upsert on `user_profiles`.
- **SA-H2, email change.** `requestEmailChange` (`modules/account/verification.ts`)
  counts the requester as well as the new address: 5 requests an hour
  per runner, checked after the password and before the per-address
  count, in `rate_limits` as kind `change-runner` with the runner's id. The
  answer is a new `runner-limited` status. Change email (Settings) shows
  the owner's sentence: "That's 5 address changes this hour. You can try
  again at {time}." The purge forgets the runner's count along with the
  address counts.
- **SA-H3, enrichment spend.** Three fixed-window counts
  (`modules/enrichment/spend-limit.ts`), kept in `rate_limits` through
  `isWithinRateLimit`: the table already counted subjects that are not
  addresses (an IP for `access` and `takedown`), and sharing it shares the
  upsert, the sweep and the purge rather than restating them:
  - per runner: 50 enrichment requests a day, counted in
    `productLinkFor` only when the product is claimable. Over the cap, the
    garment still saves and links to its product, with no request (law 5);
  - across all runners: 200 page fetches an hour, checked in the consumer
    before the fetch. Over it, the job stays `pending` for the next sweep;
  - across all runners: 150 proxy calls a day. Over it, a refused page
    is a failed fetch, as it is with no proxy key.
  - Three hardening changes with no schema: a job uses the proxy at most
    once; a save re-claims a `failed` product only once its retry day is
    over; the sweep stops re-driving after a few tries.
  - The rate limits' daily sweep takes old windows; the purge forgets a
    runner's count.

## Contract touches

- Schema changes needed: core migration
  `0005_replace_email_send_limits_with_rate_limits` (owner, 2026-11-15,
  on #786). `email_send_limits` (`key`, `window_started_at`, `sends`)
  becomes `rate_limits` (`kind`, `subject`, `window_started_at`, `count`),
  primary key (`kind`, `subject`), with the window index kept. It held
  more than email sends, so the old name misled, and a column says what a
  `{kind}:{subject}` string only implied. **Destructive**: the old table
  is dropped, not copied; pre-approved before the first deploy (D-139),
  and its rows are hour-long counts. `kind` is `RATE_LIMIT_KINDS`
  (`lib/contracts/rate-limits.ts`), the email sends' five plus
  `change-runner`, `enrich-runner`, `page-fetch` and `proxy-call`;
  `subject` is the address, IP, runner id or `global`. The purge and the
  sweep query by column. The owner was first told SA-H3 would add a new
  `enrichment_limits` table; it was built and then dropped, because its
  upsert restated the send limits' row for row (the `dupes` gate). The
  daily sweep removes a row only once its window started more than a day
  and an hour ago, so a live day's count is never dropped
  (`test/enrichment/spend-limit.test.ts`).
- New route files: none.
- New bindings/queues/crons: **none** (the sweep rides the existing daily cron).
- Screens: Settings › Change email gets one new message state; no board change.

## Test plan

All vitest (worker, plus one dom test). No Playwright spec: no flow crosses
a new server boundary.

- `test/safety/bans.test.ts`: the upsert's insert and update branches.
  `test/safety/ban-gate.test.ts`: sign-in is refused after either.
- `test/account/verification.test.ts`: per-runner limit across addresses;
  another runner is not limited; the per-address test reworked so its
  claim is still observed.
- `ChangeEmail.dom.test.tsx`: the runner-limited sentence.
- Enrichment: the per-runner cap (new product, a re-saved failed product,
  a first link on someone else's product); the global fetch cap leaves the
  row `pending` without a fetch; the proxy cap; proxy once per job; the
  re-claim window; the sweep's try cap; the sweep and purge of the
  counters.

## Issues

- Refs #756 (SA-H1, SA-H2, SA-H3 ticked there on merge).

## Open questions

None. The owner set the numbers and the copy (2026-11-15).
