# Design: 126 accounts

## Problem

A runner who forgets a password is locked out for good, nobody can leave,
anyone with a script can sign up, and the only name a runner has is a
`display_name` nothing writes. This lane gives the app an account lifecycle:
a gated way in, a handle, email, verification, recovery, change, export and
a way out.

## Two PRs

1. **`feat/126-accounts`** — ACC-1 (usernames, the cross-lane rename every
   lane is waiting on, decision D-41), ACC-15 (the Google button), ACC-16
   (the Call at 15), and this doc. Small enough to merge first.
2. **`feat/126-accounts-lifecycle`**, stacked on 1 — ACC-2 to ACC-8,
   ACC-10 to ACC-14. ACC-9 (deletion) and the Turnstile/D7 halves of ACC-5
   wait on seams 3–5 (PRs #112, #113 and 128's SAF-3); each is sequenced
   last and says so in the PR body if its seam has not merged.

## Approach

**ACC-1.** The handle is `user_profiles.username`, not Better Auth's
`username` plugin: every reader already joins `user_profiles`, O0 comes
_after_ sign-up (the plugin wants it at sign-up), and it keeps auth's schema
Better Auth's. Stored lowercased; one `UNIQUE (username COLLATE NOCASE)`
index is both the case-blind uniqueness and search's prefix index (LIKE is
NOCASE, so the collations match). Old handles go to `username_history`
(`username` PK, `user_id`, `retired_at`) and are **never reclaimable by
anyone else** — so `/@old` can say "changed their name" without ever
pointing at a different runner. The rule (3–20 of `[a-z0-9_]`, no leading
`_`, messages included) is `usernameSchema` in `lib/contracts.ts`; the
reserved/deny list and the claim live in `modules/account/username.ts`.
A reserved handle reads as taken (the list is not disclosed). The
suggestion is the typed handle + `_` + the city slug, else + a digit 2–9,
whichever is free and passes the rule. O0 is a **new** route,
`/onboarding/handle` (`routes/onboarding/name.tsx` is P2.5's garment
naming, not a handle step); `/` sends a runner with no handle there before
O1. Sign-up loses its Name field (Better Auth's `user.name` is sent empty;
nothing reads it). Settings › Username reuses the form.

**ACC-2, the email module — the interface 125, 127 and 128 build against:**

```ts
// lib/email.ts — the wire format (an outbox payload is a deploy boundary, law 9)
type EmailTemplate =
  | { kind: "verify_email"; url: string }            // 126, sent now
  | { kind: "existing_account" }                      // 126, sent now
  | { kind: "reset_password"; url: string }          // 126, sent now
  | { kind: "email_change"; url: string; newEmail: string } // 126
  | { kind: "email_changed"; newEmail: string }      // 126, to the old address
  | { kind: "invite"; code: string }                  // 126, outbox
  | { kind: "renamed"; handle: string }               // 126 ACC-12, outbox
  // added by their lanes, additions only: run_reminder (127),
  // strava_revoked (127), content_removed (128), banned (128), digest (125)
type EmailRecipient = { userId: string } | { address: string };
interface EmailPayload { to: EmailRecipient; template: EmailTemplate }

// modules/email — the only sender
emailDebt(payload, { dedupeKey, notBefore? }): OutboxMessage // put in YOUR db.batch via ops' oweOutbox + outboxInsert
deliverEmail(db, payload, sender?): Promise<"sent" | "skipped">  // throws on a failed send
```

- **Two paths, one renderer.** What the runner just asked for (verify,
  reset, email change) is sent **now**, one attempt (law 3); a failure is
  reported and the page's Resend is the retry — those carry a live token,
  which an outbox row should not hold. Everything secondary (invite,
  reminder, notices, digest) is an **outbox row of kind `email`** written in
  the same batch as the event (law 8c), settled by the fast path and
  re-driven by the drainer. Email rows are also drained on the three hourly
  firings, so `notBefore` (127's 20-minute reminder) lands 20–50 minutes
  after the run. `email` is a new `outbox` kind, no schema change.
- **Preferences at send time.** `notification_preferences (user_id, kind,
email, updated_at)`; no row means the default (the reminder: on).
  Transactional kinds have no row and no switch. Optional mail goes only to
  a verified address.
- **Templates are React Email** (`@react-email/*` components, rendered to
  HTML and text). _Verified first_: a worker-pool test renders one to both
  in workerd (`test/email/render.test.tsx`). Every footer links `/privacy`.
- **Unsubscribe**: HMAC-SHA256 over `userId|kind` with a key derived from
  `BETTER_AUTH_SECRET`; never expires. `List-Unsubscribe` +
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` on the reminder; the
  link unsubscribes on GET with no session and no confirm.
- The `send_email` binding `EMAIL` (owner-authorised, decision D-42) is read
  only by `modules/email`, asserted in `test/bindings-conformance.test.ts`.

**ACC-3.** Better Auth's `emailVerification` (`sendOnSignUp`,
`expiresIn: 24h`), with `requireEmailVerification` **off** — unverified
runners sign in. Sign-up _always_ answers Au4: a registered address is
swallowed in a `before` hook that sends `existing_account` and returns the
same body. D-50: `share_default` is read through `isVerified`, so an
unverified runner's new entry saves private; verifying changes nothing
stored, so the default simply applies again. Exports: `isVerified`,
`ConfirmEmailSheet`. **ACC-4** is Better Auth's reset (`sendResetPassword`,
single use, 1 h), answered identically for unknown addresses.
**ACC-5**: `invite_codes`, `invite_redemptions`, `access_requests`;
`INVITES_REQUIRED` in `lib/` is the one flag. A code is checked in
`databaseHooks.user.create.before` and consumed in the same hook's batch;
Google carries it in a short-lived signed cookie set before the redirect.
The owner is seeded by a deployment step (`docs/deployment.md` is 125's, so
the step goes in the PR body). **ACC-9** holds its claim in
`account_deletions` (reconciliation marker for the weather DB and R2, law 8c)
with a 7-day tombstone purged from the daily firing.

## PR 2, as built (split in two)

PR 2 grew past one reviewable diff, so it is two, stacked:
**2a** (`feat/126-accounts-lifecycle`) — the O0 memo, email plumbing,
verification, reset, password and email change, sign out everywhere,
Settings › Notifications and the unsubscribe link; **2b** — invites and
request access (with lane 125's Turnstile and Desk D7), the legal pages,
terms acceptance, export, force-rename, and the email hookups for lanes
125 and 127. ACC-9 (deletion) waits on lane 128's delete primitives.

Where 2a departs from the plan above, and why:

- **React Email renders in workerd** (`test/email/render.test.ts` runs in
  the workers pool). The components are React Email's; the renderer is
  React's `renderToStaticMarkup` plus `html-to-text`, not
  `@react-email/render`, which imports Prettier's standalone build at module
  scope for an optional `pretty` flag.
- **Confirm links are ours, not Better Auth's `emailVerification`.** Its
  tokens are signed and stateless, so "the old one no longer works" and
  "already confirmed" could not be true. `email_verifications` holds one
  row per runner and purpose (`verify`, `change`), the token's SHA-256,
  24 hours, `used_at`. An email change reuses it and moves the account
  only when the new address's link is opened; the old address is told
  through the outbox.
- **Sign-up signs nobody in** (`autoSignIn: false`). A registered address
  must read exactly as a new one (round 26 #11), and a session for one and
  not the other is a difference; Better Auth then answers a registered
  address with the same body and calls `onExistingUserSignUp`. Au4 drops
  the board's "You're signed in" line for a signed-out visitor and offers
  "Carry on without confirming? Log in" (a design delta).
- **The `EMAIL` binding is not `remote: true`.** `remote` changes only
  local dev, and there it needs a `CLOUDFLARE_API_TOKEN` or `vite dev`
  will not start — which stops CI's e2e. Local dev gets Miniflare's
  simulated sender.
- **Decision D-50** is two gates on one read: `isVerified` (Useful,
  report, change — an account that is gone is not verified) and
  `isUnconfirmed` (sharing — only an account that exists can be
  unconfirmed). The share default and `submitVerdict` both read the second.
- **Rate limits** are per address and kind (`email_send_limits`), counted
  whether or not the address has an account, so the limit cannot reveal
  one.
- **The account's settings pages are one route**, `/account/$section`
  (`sign-in`, `email`, `password`, `notifications`), as Settings' own
  sections are.

Changed on review of PR #119:

- **An email change asks for the current password** (Better Auth's
  `verify-password`, through `auth`'s `checkCurrentPassword`), and when its
  link is spent every other session is signed out; the one the link was
  opened in stays.
- **A link is claimed before it is acted on** (law 2): `UPDATE … WHERE
used_at IS NULL AND token_hash = ?`, and only the claimer confirms or
  moves the account. A failure after the claim hands the link back.
- **Reset tokens are stored hashed** (`verification.storeIdentifier:
"hashed"`).
- **Reset is open to an unconfirmed runner, and a spent reset confirms the
  address** (D-63). This retires the `isVerified` gate on reset by email.
- **No email is sent on the request path.** Better Auth's sends go through
  `advanced.backgroundTasks` (`waitUntil`), the new-account hook likewise,
  and Resend claims its limit and hands the rest to the background, so no
  answer is slower for an address that has an account.
- **The O0 memo is keyed to the runner**, with the owner in `localStorage`
  so a sign-in as someone else in another tab unkeys every tab's memo.

Changed on the second review of PR #119:

- **No `Message-ID` of ours.** Cloudflare Email Service sets it and
  refuses a sender's with `E_HEADER_NOT_ALLOWED`; the sent mark alone
  guards an owed email (D-66, corrected). The test double refuses every
  header on Cloudflare's disallowed list.
- **The email change owes its email through the outbox**, settled after
  the answer: the link to a free address, round 27's existing-account
  email to the owner of a taken one. Both paths do one lookup and one
  batch, so the answer's timing says nothing.
- **Tries at the current password are limited** — 5 per 15 minutes per
  runner, in `password_attempts` (additive migration
  `0032_add_password_attempts`). `auth.api.verifyPassword` called
  server-side never passes Better Auth's HTTP limiter.
- **A completed email change withdraws the old inbox's links**: Better
  Auth's `verification` rows naming the runner (open reset links) and
  their confirm link, in the move's batch.
- **The drain reads one index range**: marking a row sent makes it due, so
  `claimDue` no longer ORs in `sent_at IS NOT NULL`.

## Contract touches

- Schema (all core): `replace_display_name_with_username` (**destructive,
  authorised**, decision D-41, expires at the first production deploy — the
  history table folds in), `add_invite_codes_and_access_requests`,
  `add_notification_preferences`, `add_account_deletions`, plus
  `add_terms_acceptance` (**additive, not in the shared list — flagged**).
  PR 2a adds two more, both additive: `add_email_verifications_and_send_limits`
  (the confirm links and the per-address limit) and
  `add_verification_identifier_index` (Better Auth's reset lookup scanned
  its `verification` table).
- Binding: `send_email` `EMAIL` (decision D-42). No queue, no cron.
- Routes: `/onboarding/handle`, `/account/*`, `/join`, `/privacy`, `/terms`,
  `/copyright`, `/desk/access`.

## Test plan

Worker: handle rule and each reserved name in any case, taken + suggestion,
concurrent claim, history kept and not reclaimable; readers renamed;
render in workerd; binding handed the right recipient/template/headers;
preference honoured; unsubscribe with no session, tampered link refused;
unverified entry private, verify restores default; reset single-use and
expiring; code refused (missing, used, revoked), consumed at creation,
Google create without code refused. UI: every new form's states.

## Open questions (building to the default in brackets)

1. Google's guidelines (updated 2026-07-07) give the label font as **Google
   Sans Medium** — not Roboto, and not "any". Their "don't" list does not
   name fonts. [Archivo, per D-49; the owner confirms or picks Google Sans.]
2. Old handles never reclaimable by others [yes].
3. Reports a deleted runner filed [keep, reporter nulled].
