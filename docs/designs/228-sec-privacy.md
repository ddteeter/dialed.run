# Design: 228 sec-privacy

## Problem

Wave 12 lane 12d: eight items from the 2026-11-14 security audit, tracked
by id only in #756 (SA-M8, SA-M9, SA-M15, SA-M40, SA-L02, SA-L09, SA-L14,
SA-L19). This lane makes blocks, bans, leaving and copyright holds hold on
every read and delete that names a runner, and keeps the open web and the
browser from carrying a runner's details off the app.

## Approach

- **SA-M8, SA-M9.** The blocked roster names a runner only when they have
  not blocked the viewer back. The bell's follower join takes the feed's
  `runnerVisibleToViewer` floor, handed in by `listNotificationsFn`, so a
  follow row links exactly when H would open.
- **SA-M15.** `isOpenWebPath` folds case the way the router does (`iu`).
  `secureResponse` turns a `public` `text/html` response for a request
  given a nonce into `private, no-store`; cards and images are untouched.
- **SA-M40.** An enforced `Content-Security-Policy: connect-src 'self'`
  goes beside the report-only policy, in the Worker and `public/_headers`.
- **SA-L02.**
  - The correction sheet quotes a product link by its domain, and not at
    all when it is denied; the Desk's queue keeps the full URL.
  - `follow` inserts only when the follower may see the followee. A block
    deletes the pair's follows both ways.
  - Useful counts count marks whose runner is in standing
    (`runnerInStanding`), in every read. Unmarking always works.
  - A runner retires at most 3 new handles in any 30 days, counted from
    `username_history` inside the claim's batch; past that the claim
    answers `too_often`.
- **SA-L09.**
  - The runner's own delete refuses a kit, run or photo a live copyright
    hold names. The account purge skips an account while any hold on it is
    live.
  - The purge deletes the follow rows it named on other runners' bells.
  - A closed account is purged on schedule, and its addresses' HMAC
    (`CLOSED_ADDRESS_SECRET`) is kept 3 years; sign-up refuses a match.
    With the secret unset, the purge keeps nothing and the daily digest
    says a closed account's address went unremembered (law 6).
  - The purge orders retried claims behind untried ones and claims in
    rounds while it has time.
  - A ban or leaving withdraws every public photo copy in one drain
    (batched R2 deletes), and the hourly sweep drains too.
- **SA-L14.** Au4's `?email=` parses as an address. A product link to
  `dialed.run` or a subdomain is refused at save and drawn as plain text
  at read (one host test in `lib/domain.ts`).
- **SA-L19.** CSP reports go to `/api/csp-report` on our origin, which
  caps, parses, strips queries, counts per address (`rate_limits` kind
  `csp-report`, 20 an hour) and forwards path-only reports to Sentry. Public pages leave
  `public, max-age=60, must-revalidate`.

## Contract touches

- Schema: core migration `0007_add_closed_addresses` (number from
  coordinator-12; owner, 2026-11-15): `closed_addresses` (`hash` primary
  key, `closed_at`), swept after 3 years. **HARD STOP** passed.
- New route: `src/routes/api/csp-report.ts`.
- New secret: `CLOSED_ADDRESS_SECRET` (owner, 2026-11-15), in the deploy
  checklists and `.dev.vars.example`.
- Screens: handle form (one refusal), correction sheet label, garment
  link error, held-kit delete refusal. Policy text: deletion paragraph,
  two retention rows, Sentry's row.

## Owner answers (2026-11-15)

Closed accounts: purge and remember the address, keyed. Held kits: refuse
and the purge waits. Renames: 3 per 30 days. Blocks end follows. The sheet
shows the domain. Unmarking always works. CSP: own-origin collector.
Own-host link: "That's a dialed.run page. Paste the address of the shop's
page." Held delete: "This kit is held while a copyright claim is settled,
so it can't be deleted yet." (run, photo alike). Policy wording as drafted.
A closed account in its deletion week shows [CLOSED] [PENDING DELETE] on
the Desk. The digest says "N account deletion(s) wait for a copyright hold
to settle". The policy names the per-address count of CSP reports.

## Test plan

All vitest (worker, ui, and the blur browser test). Each item gets a
failing-first test in its module's test file: the rename cap with
parallel claims, the held refusal through `controlRefusalAdapter`, the
CSP collector's cut and its per-address count. The enforced header is
pinned in `security-headers`' and `_headers`' tests, and the e2e suite
updates only `desk-door.spec.ts`'s cache-header expectation.

## Issues

- Refs #756. Opens: none yet.

## Open questions

- None. Design calls go to coordinator-12; guesses are marked here.
