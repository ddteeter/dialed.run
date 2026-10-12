# Design: 139 Lane C · account and safety fixes

> Lane C of `docs/launch/before-public-plan.md` (tasks 126 and 128). One
> PR, small commits, no schema change.

## Problem

A banned runner who signs in gets a generic failure band: the ban gate
refuses with `ACCOUNT_CLOSED`, and neither sign-in path maps the code
(SAF-4). The morning digest goes to every operator's address, confirmed
or not (OPS-11). The CSP is still report-only, and nobody has run the
suites against an enforced policy. `entryCardResponse` has no caller
(OPS-16).

## Approach

- **SAF-4, built to the board.** Design-deltas item 23 (Round 27 Rulings,
  "Au1 account closed Google") is newer than Operator Screens D4. It
  draws D4 as a notice band on Au1, over the form at rest:
  `ACCOUNT CLOSED` · "This account was closed for breaking the community rules."
  · "Think we got it wrong? Reply to the email we sent you." There is no
  date, no reason and no case line, and the same band serves a password
  log-in. So `safety/components/AccountClosed` becomes that band, built
  on the module's `NoticeBand`. Its private Intl formatter goes with the
  date (STR-13). A banned runner has no session, so they can never open
  the full-page notice, and the band is the only place D4 can appear.
  The owner (2026-10-12) added one line under the drawn copy, "Or write
  to desk@dialed.run.", from `APPEAL_ADDRESS`. The notice shows only
  after a correct password, so it does confirm the password; the owner
  accepted that, because the account cannot be used.
  - The code moves to `lib/contracts/access.ts`, beside the other refusal
    codes, so that the client can read it without importing the
    server-only ban gate. The band's words live there too.
  - `credentials.signIn` throws `AccountClosedError` on the code.
    `useGoogleSignIn` reports `closed` when Google's round trip comes back
    with `?error=ACCOUNT_CLOSED`. Neither path draws its failure band
    then: there is no Au4 band and no Au6 band.
  - `AuthPage` draws the band in a new required `closed` slot, above the
    form. Its words also go through the screen's one status region. Both
    routes pass `<AccountClosed />` to the slot. The routes stay glue,
    because `AuthPage` decides when to show it. Au2 needs the slot too:
    Google from Au2 signs in an existing account, banned or not.
- **OPS-11.** `oweDigestEmail` reads which operators have a confirmed
  address, in one query on `user` by primary key. Only those operators
  are owed the email. If any operator was skipped, a
  `digest-unconfirmed` row goes in `cron_checkpoints`, in the same batch
  as the day's `digest-email` mark (no schema change). `todayCounts`
  reads that row in its existing batch, and Today prints one line while
  the row is from today: an undrawn surface, listed in design deltas.
- **CSP readiness.** This is a local experiment and is never committed.
  `CSP_HEADER` and `public/_headers` are flipped to enforce. A
  throwaway `SENTRY_DSN` in `.dev.vars` points `report-uri` at a local
  collector, so every violation from every spec is logged without
  editing the specs. Then e2e and the demos run, one at a time. Each
  violation is fixed in code. The evidence and the one-line flip go in
  the PR body.
- **OPS-16.** Delete `entryCardResponse`, its test, and anything knip
  then finds dead behind it.

## Contract touches

- Schema changes: **none**. `cron_checkpoints` already holds named marks.
- New route files: none. `routes/auth/login.tsx` and `signup.tsx` pass the
  band.
- Bindings/queues/crons: **none**. New server functions: **none**.
- Screens: Au1 and Au2 get item 23's band. Desk D0 gets one undrawn line
  (new design-deltas item).

## Test plan

- UI (DOM): log-in with a password that the gate refuses shows the band,
  with no Au4 band and no field error. The same for a Google return with
  `?error=ACCOUNT_CLOSED`, with no Au6 band. The band's own words and
  shape.
- Worker: the digest is owed only to a confirmed operator. An unconfirmed
  operator gets no email, and the Desk mark is written. Both cases run
  through `handleScheduled`. `todayCounts` reports the mark.
- E2E: in the safety demo, a banned runner signs in and sees the drawn
  band.

## Open questions

- **Answered by the owner (2026-10-12).** Item 23's copy stands, plus
  the fallback appeal line. The Desk line, the notice on Au2 and the
  kept typed fields ship as placeholders (design-deltas item 62).
