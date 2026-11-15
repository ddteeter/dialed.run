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
  count, in `email_send_limits` under a `change:runner:<id>` key. The
  answer is a new `runner-limited` status. Change email (Settings) shows
  the owner's sentence: "That's 5 address changes this hour. You can try
  again at {time}." The purge forgets the runner's key along with the
  address keys.
- **SA-H3, enrichment spend.** Three fixed-window counts
  (`modules/enrichment/spend-limit.ts`), kept in `email_send_limits` under
  `spend:` keys through `isWithinSpendLimit`: the table already counts keys
  that are not addresses (`access:`, `takedown:`), and sharing it shares
  the upsert, the sweep and the purge rather than restating them:
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
  - The send limits' daily sweep takes old windows; the purge forgets a
    runner's key.

## Contract touches

- Schema changes needed: **none** (a comment on `email_send_limits` only).
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
