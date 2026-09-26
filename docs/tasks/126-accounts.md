# Task 126 — Accounts

Lane 2 of 5 building to the launch development plan. Read
`125-129-launch-development.md` first: it holds the rules every lane
shares, the migration protocol and the cross-lane seams.

**Starts after PR #104 merges.** #104 rebuilds auth, the signed-out shell
and settings; this lane builds on what it leaves. (HIBP's breached-password
check is already in #104; do not redo it.)

Today a runner who forgets a password is locked out for good, nobody can
leave, and anyone with a script can sign up. This lane gives the app an
account lifecycle: a gated way in, email, verification, recovery, change,
export and a way out. It is the biggest lane; its order below is the order
to build in.

## You own

- `src/modules/auth/**` except `instance.ts` (125). In `create-auth.ts`, 125
  adds the `baseURL`, `rateLimit` and cookie options; everything else in it
  is yours.
- `src/routes/auth/**`, `src/routes/index.tsx` (the request-access entry on
  the landing page)
- New `src/modules/email/**` and `src/modules/account/**`; new
  `src/routes/account/**` (verify, reset, request access, export, delete)
- `src/routes/onboarding/settings/**`, `src/routes/onboarding/name.tsx`,
  `src/modules/onboarding/naming.ts`, and the onboarding components that
  render settings and the name step
- `src/routes/desk/invites*.tsx`, `src/routes/desk/requests*.tsx`
- `wrangler.jsonc`: **the `send_email` binding only** (decision D-42)
- `e2e/auth/`, new `e2e/account/`, `test/auth/**`, new `test/email/**`,
  `test/account/**`

**And, for ACC-1 only**, rename-only edits to every `display_name` reader
in any lane (the shared packet, seam 1).

## Work, in order

**ACC-1 · Usernames replace `display_name` [F]** (§5, §7; decision D-41).
Your first PR. The migration `replace_display_name_with_username` adds the
column with a case-insensitive unique index and drops `display_name` and
its search index **in the same change** — the one sanctioned exception to
law 8, because the app has never been deployed. Say so in the PR, cite
decision D-41, and note that the exception expires at the first production
deploy, so this PR must merge before it. Check the generated table rebuild
by hand (law 8's expression-index trap is exactly this index).

- Where the column lives is a design-doc decision: `user_profiles`, where
  every reader already joins, or Better Auth's `username` plugin on `user`.
  Say which and why.
- A reserved and deny list checked at claim time (`admin`, `dialed`,
  `support`, `strava`, `moderator`, and the obvious impersonations);
  normalised the same way the unique index compares. The list lives in one
  place, in the schema's error message path.
- Search (129's) keeps its prefix index on the new column.
- Every reader moves in this PR: feed, safety, onboarding, tests, e2e.
- Design ask: the claim field and its errors (round 24's open ask).

**ACC-2 · Email plumbing [F]** (§2.3, §4; decisions D-42, D-43).

- Add the `send_email` binding to `wrangler.jsonc` and assert it in
  `test/bindings-conformance.test.ts` (law 10). Say in the PR that the
  owner authorised it.
- **First, check React Email renders in workerd** (a worker test that
  renders one template to HTML and text). If it does, use it; if not, typed
  template functions producing both. Record the result in the design doc.
- `modules/email` exposes one interface: send a named template to a user,
  honouring `notification_preferences`. **Publish it in your design doc on
  day one**; 125, 127 and 128 build against it.
- Sending is a secondary effect wherever it is not the thing the user asked
  for (law 5). Consider #101's outbox with an `email` kind, so the event row
  and the send intent commit together and the drain retries.
- `add_notification_preferences` (additive, yours): the reminder switch,
  default on. Transactional kinds have no row and no switch.
- Nothing commercial, so no `List-Unsubscribe` machinery yet; the reminder
  gets a one-click off link anyway (best practice, §4).

**ACC-3 · Email verification [F]** (decision D-42). Required for
email/password accounts (Better Auth's `requireEmailVerification`); Google
accounts arrive verified. Check your inbox, verified, expired link, resend.

**ACC-4 · Password reset [F]** (§2.3). "Forgot it?" on Au2–Au4 and Au7
(#104 left it absent on purpose). Request, check your inbox, set a new
password (the `PASSWORD_MIN_LENGTH` floor), expired link. The request
answers the same whether or not the address has an account.

**ACC-5 · Invite codes and request access [F]** (decision D-39).

- `add_invite_codes_and_access_requests` (additive, yours).
- **Sign-up requires a valid code**, email and Google alike. Google creates
  its account on the OAuth return, so the code has to survive the round
  trip (validated before the redirect, carried in something short-lived and
  signed) and be checked in the create hook. A Google sign-in to an
  existing account needs no code.
- A code is single-use unless created multi-use; usage is recorded (who,
  when).
- **Request access**: a public form (email, a line about themselves),
  Turnstile-guarded (125's widget), rate-limited, idempotent per address.
- **Desk · Invites**: create a code, see each code's uses. **Desk ·
  Requests**: list them, and issue a code to one. Under 125's D0 shell.
- Turnstile on Au1 too.
- Design asks: the code field and its states; request access and its
  receipt; both Desk pages.

**ACC-6 · Terms acceptance [F]** (§1.1, §1.3). A line on Au1 linking 125's
`/legal/terms` and `/legal/privacy`, with the minimum age the owner's terms
set; acceptance recorded (timestamp and terms version).

**ACC-7 · Password change and sign out everywhere [P]** (§2.4). U1 Account.

**ACC-8 · Email change [P]** (§2.4). Confirmed from the new address; a
notice to the old one.

**ACC-9 · Account deletion [P]** (§2.1, 0.9, §7). After 128's SAF-3 and
127's STR-1/2 have merged (seams 4 and 5).

- **Claim, then delete.** `add_account_deletions` (additive, yours) holds
  the claim. At request: sessions revoked, content hidden through the one
  visibility rule (seam 6), Strava refresh-then-revoke queued. **A 7-day
  tombstone** the runner can cancel by signing in, then a purge run from
  the daily firing (additions to `ops/scheduled.ts`).
- The purge reaches everything the audit lists: core rows (no foreign keys,
  so it is application code), `manual_conditions` in `DIALED_WEATHER`
  (cross-database, law 8c — the claim row is the reconciliation marker),
  R2 `MEDIA` and `IMPORTS` through 128's primitives and #101's outbox, and
  Better Auth's rows last. Shared `products` stay.
- It is an explicit exception to "retire, don't delete"; say so.
- **Ask the owner** about reports this runner filed against others (the
  development plan's default: keep them, reporter nulled).
- Tests: every table and prefix empty for the user afterwards, and nobody
  else's rows touched; a purge interrupted at each step finishes on the
  next firing.

**ACC-10 · Data export [P]** (§2.2). JSON: profile, closet, runs, entries,
photo links. Per-run derived conditions only, never raw Visual Crossing
rows (licence, §1.8). Signed-URL links from 128's SAF-7 where the photo is
public; say in the design doc how private photos are included.

**ACC-11 · Notification settings [P]** (§4; decision D-43). U1
Notifications: the reminder email switch. 127 reads it (STR-9).

**ACC-12 · Moderator force-rename [P]** (§5, 0.3). A Desk control beside
128's ban panel; the renamed runner is told, and the old name is not
immediately reclaimable.

## Tests

Worker tests for every server path: a code refused (missing, used,
expired), a Google create without a code refused, a reserved name refused
in any case, verification required before sign-in, a reset link single-use
and expiring, sessions gone after sign out everywhere, the email handed to
the binding with the right recipient and template. ui tests for every new
form's states. `modules/email` and `modules/account` join the mutation
ratchet at 100% in the PR that finishes them.

## Demos

- `e2e/auth/`: sign up with a code, verify, sign in; forgot password.
- New `e2e/account/`: request access; the Desk issuing a code; change
  password; sign out everywhere; export; delete and cancel inside 7 days.
- The onboarding and feed demos re-recorded after ACC-1 (`@username`).
