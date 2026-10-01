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

## PR 2b-1, as built (invites, request access, D7, the username fixes)

2b split again: **2b-1** is the way in (ACC-5 with Turnstile and D7) and
the owner's username decisions of 2026-09-27; **2b-2** is the legal pages,
terms acceptance, export, deletion and the email hookups (the invite email
among them). Force-rename is lane 128's, through the account API (#126).

- **The flag** is `IS_INVITE_ONLY` in `lib/access.ts`, a constant: flipping
  it is a deploy, which is the owner's gate anyway (D-38). It drives the
  sign-up schema (`signUpSchemaFor`), Au2's field and request link, and
  the server gate. Turnstile does not hang off it — it stays after the
  public gate.
- **Where the code is checked: Better Auth's own hooks, not a wrapper
  server function.** A `before` hook on `/sign-up/email` and on
  `/sign-in/social` _with `requestSignUp`_ checks Turnstile then the code
  (`modules/auth/access-hook.ts`), so both ways in are refused before
  Better Auth does anything — for Google, before the redirect. The code
  and token ride in two headers (`x-invite-code`, `x-turnstile-token`):
  Better Auth's body is its own.
- **Google's code survives the round trip in Better Auth's OAuth state**,
  as _server_ context (`addOAuthServerContext`, Better Auth 1.7): written
  by the hook only after the code checked out, so it is validated before
  the redirect, carried in the state Better Auth already signs, stores and
  expires, and cannot be supplied by the client. Google is configured with
  `disableImplicitSignUp`, so only Au2's attempt (which asks with
  `requestSignUp`) can make an account; from Au1 an unknown Google address
  comes back `signup_disabled` ("No account uses that Google address.
  Create one first." — placeholder copy). A Google sign-in to an existing
  account needs no code, **from either page** (PR #127 review): Au2's
  press cannot know whether the Google address has an account, so a
  Google attempt from Au2 with the field empty is let through (Turnstile
  still asked), and a _new_ account with no code is refused by the create
  hook after the round trip, landing back on Au2 as
  `?error=INVITE_MISSING` with the field's own sentence in the band. A
  typed code is still checked before the redirect.
- **"Consumed at account creation, in the same batch".** Better Auth makes
  the user row, so no batch of ours can hold it. The user create hook
  (`claimInvite`) mints the account's id itself (Better Auth creates with
  `forceAllowId`) and claims the code against that id _before_ the row is
  written, in one batch: one conditional `INSERT … SELECT` that writes
  only if the code is live and has a use left (or this address already
  holds a live, unconfirmed claim on it — a retry), then read it back.
  **A use is an address**, counted by distinct email: a claim counts
  while it is confirmed, an account holds its address, **or** its
  10-minute hold is live. Nothing is deleted — an earlier version cleared
  "dead" claims by address on a retry, which also cleared a concurrent
  attempt still in flight and could reopen a single-use code (PR #127
  review) — so two sign-ups from different addresses racing for a
  single-use code cannot both land, a retry is the same use, and a Worker
  that dies between the claim and the account frees the code when the
  hold runs out. The create hook's `after` sets `confirmed_at`
  (`0039_add_invite_redemption_confirmed_at`), so deleting the account
  later (2b-2) does not hand the use back. A registered address never
  reaches the create hook, so it spends nothing and answers exactly as a
  new one.
- **One refusal for a code that will not work.** A spent code answers
  exactly as a revoked or unknown one (`INVITE_INVALID`, "That code
  doesn't work…"): round 26 #20's separate "already been used" sentence
  told a prober which codes exist, and is retired (PR #127 review).
  **Codes are 20 bits** (`DIAL-` + 4 of 32 characters, ~1M): acceptable at
  the friends stage, where each guess must also pass Turnstile and Better
  Auth's sign-up limit; the public gate (D-38) lengthens them or retires
  codes.
- **Au5** upserts by address (a repeat updates the note; a declined address
  that asks again is pending again), Turnstile first, then — on an https
  deployment only, as Better Auth's limiter — five an hour per visitor
  address (`cf-connecting-ip`), in `email_send_limits` under `access:{ip}`.
  The limiter's count and the request's upsert are one `db.batch()`, the
  upsert conditional on the count just made (`sendAllowed`). One receipt
  for everyone.
- **D7** (`/desk/access`) is the `/desk` layout's not-found plus
  `requireAdmin` on every server function. Send invite mints a single-use
  code labelled "{email} (request)" and moves the request, one batch,
  idempotent on the request (unique `request_id`); New code is idempotent
  on the form's key per operator (law 8b); Revoke is immediate with a 10 s
  Undo that clears `revoked_at`. **The invite email is not sent yet** — it
  is 2b-2's email hookups; until then the operator uses Copy link.
- **The owner's account** is a deployment step: one code inserted by
  `wrangler d1 execute` (deployment plan, stage 0). A seeded code in a
  migration would be a public way in.
- **Usernames** (D-72): the vendored LDNOOBW list (CC BY 4.0, attributed
  in `docs/legal/third-party-notices.md`) matched on whole parts only —
  substring matching refused `basement`, `scraping` and `raccoons` — less
  the listed words that are innocent in a handle (`INNOCENT_IN_HANDLES`:
  `tit` in `blue_tit`, `dick` as a name, `sucks`; PR #127 review); OpenAI moderation asked once, after the list, and failing
  open; both read as taken with no suggestion (D-57). Text moderation is
  **not** in `modules/safety` (it screens images only), so the handle's
  request is `account/handle-screen.ts`, reusing safety's model constant.
  Suggestions are `_runs`, `_miles`, then a digit; never the city.
- **No name**: every account is created with `name: ""` (the create hook,
  so Google's profile name is dropped too); `0038_blank_user_names` clears
  the stored ones.

Migrations (core): `0037_add_invite_codes_and_access_requests` (three new
tables, additive), `0038_blank_user_names` (data only) and
`0039_add_invite_redemption_confirmed_at` (one nullable column, additive).

## PR 2b-2 (legal pages, terms line, export, deletion, email hookups)

Branch `feat/126-accounts-2b2`. ACC-13, ACC-6, ACC-10, ACC-9 and the email
hookups. Built to round 27's drawings (#12–#15, #19) where they exist, and
to the owner's decisions where the two differ.

### Reconciling the packet against what is built

| item   | state                                                                                                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ACC-1  | built (PR 1, 2b-1)                                                                                                                                                                                                             |
| ACC-2  | built (2a)                                                                                                                                                                                                                     |
| ACC-3  | built (2a)                                                                                                                                                                                                                     |
| ACC-4  | built (2a)                                                                                                                                                                                                                     |
| ACC-5  | built (2b-1); **the invite email is here**                                                                                                                                                                                     |
| ACC-6  | here: the age line (D-71). **The terms line and its recorded acceptance wait for the terms text** (below)                                                                                                                      |
| ACC-7  | built (2a)                                                                                                                                                                                                                     |
| ACC-8  | built (2a)                                                                                                                                                                                                                     |
| ACC-9  | here                                                                                                                                                                                                                           |
| ACC-10 | here, as the packet's JSON download (below)                                                                                                                                                                                    |
| ACC-11 | built (2a)                                                                                                                                                                                                                     |
| ACC-12 | **outstanding, not in 2b-2.** Lane 128's Desk control writes `user_profiles.username_reset_reason`, but the runner-facing half (round 27 #16: O0's "USERNAME CHANGED BY A MODERATOR" field, Save / Keep) reads it nowhere yet. |
| ACC-13 | here: the reading layout and `/privacy`, gated on a finished text (below); `/terms` and `/copyright` wait for their text                                                                                                       |
| ACC-14 | built (`auth/breached-password.ts`)                                                                                                                                                                                            |
| ACC-15 | built (PR 1)                                                                                                                                                                                                                   |
| ACC-16 | built (PR 1)                                                                                                                                                                                                                   |

Not an ACC item but in the same seam: **127's STR-9 reminder email** is
not a one-line call — it needs the 20-minute hold, the one-a-day count and
the skip rule checked when due — so it stays 127's (needs from other
lanes). The `run_reminder` template and the switch it reads are built.

### ACC-13 · legal pages

- **One reading page for every legal text** (`account/components/
ReadingPage.tsx`): the 620 document measure (`max-w-column`), the
  `lead` step, a sticky contents column at the desk and a plain list under
  the H1 on the phone, an id and "↑ Contents" on every H2, underlined
  inline links, no accordions; the signed-in shell when signed in, the
  signed-out one otherwise.
- **The text is the file**: `docs/legal/*.md`, read at build time as a
  raw string and parsed server-side by a small parser for the subset the
  texts use (`account/legal-markdown.ts`: headings, paragraphs, lists,
  tables, block quotes, bold, code and links). No markdown dependency, and
  the text never reaches the client bundle — the loader returns the
  parsed blocks.
- **Nothing is published until the owner marks it so** (review of PR
  #130). A text shows only once its first three lines are exactly
  `---` / `published: true` / `---`; without them `legalDoc()` answers
  nothing and the route answers X1. The first version refused the draft's
  banner and `[OWNER:` notes instead — a blacklist, which a reworded
  banner or a `TODO` would have walked past. The source's own comment at
  the top of `docs/legal/privacy-policy.md` tells the owner how, and the
  page drops that comment (and any other) with the mark. The links show
  meanwhile (decision D-81).
- **`/terms` and `/copyright` are not routes yet**: their texts do not
  exist, and a route with nothing to render would be a placeholder on a
  public path. Adding one is a line in the doc table plus a route file.
- Links (D-52, round 27 #12): a footer on the signed-out shell (Privacy;
  Terms and Copyright join it with their texts, in that order), a
  **Settings › About** group (Privacy policy), and every email footer
  (already). Not under the log-in form.

### ACC-6 · the lines under sign-up

The age line ships now: "dialed.run is for runners 16 and over." (D-71,
round 27 #12). Round 27's terms line ("By creating an account you agree to
the Terms and have read the Privacy policy.") and the server's record of
the terms version and time need terms that exist; that record is an
additive migration (`add_terms_acceptance`) and a line in the sign-up hook,
and it is held rather than recording acceptance of a version nobody has
written. Until then the line under the form is the privacy half alone:
"Creating an account means you've read our Privacy policy." (round 26
#14). **Owner question.**

### ACC-10 · data export

**A JSON download, as the packet and the development plan say**, from
Settings › Account › "Export your data" · Get a copy: a `GET
/account/export` server route, the runner's own session, `Content-
Disposition: attachment`. It holds the profile (handle, place label, units,
calibration, share default), the closet (every garment, retired included),
every run with its **derived conditions only** — the per-run temperature,
feels-like, wind and sky the app shows, never a raw Visual Crossing row
(licence, §1.8) — and every entry with its items, tags, verdict, caption,
and photo links.

**Photos are links to the app's own photo route**, which serves a runner
their own photos, private or shared, while they are signed in (D-69: no
signed links). The export says so in its `photos` note. Run files are
listed by name and date, not included.

Round 27 #13 draws something bigger: a ZIP of CSVs, original run files and
photos, built by a queued job, stored in R2 and emailed as a 7-day link,
one a day. That is a queue message type, an R2 prefix with a lifecycle
rule, a ZIP library and an email — 125's queue and R2 as well as this
lane's — and it contradicts the packet's JSON. **The owner has decided
the ZIP ships before launch** (decision D-79), in a follow-up PR
(register D-116); the JSON ships here as the interim. Garment photos
link their full size, not the closet's card.

### ACC-9 · account deletion

Round 27 #14 draws it, and it is followed except where the owner decided
otherwise (the handle).

**Request** (Settings › Account › Delete account, a sheet): the current
password, or — for an account with no password — a Google sign-in within
the last 10 minutes ("Continue with Google" comes back to the sheet).
Then one batch: the claim row in `account_deletions` (`user_id` PK,
`requested_at`, `purge_after` = +7 days), **every session deleted**, and
the "delete scheduled" email owed through the outbox. Strava is
disconnected straight after, through runs' `disconnectStrava` — the grant
is revoked at request, as the packet says; a runner who keeps the account
connects again. The page lands on "Your account goes on {day}" (signed
out). Idempotent: a second request keeps the first date.

**Hidden at once, through the one rule.** `publiclyVisibleEntry` gains
`authorNotLeaving()` (a `NOT EXISTS` on `account_deletions`' primary key,
beside `authorNotBanned`), so the feed, profiles, photos and the Call's
consensus all drop the runner's entries without a second rule; and
`runnerVisibleToViewer` (feed's floor for search and H) gains the same
clause for the runner, so they leave search. Nothing is written to the
entries: **Keep brings everything back as it was**, share state included.

**Logging in during the week never cancels silently** (round 27 #14):
sign-in works, and the root's gate (`handleGate`, which already sends a
runner with no handle to O0 on every navigation) answers `leaving` for a
runner with a pending deletion and sends them to `/account/leaving`:
"Keep your account?" · Keep my account / Log out. Keep deletes the claim
row, but only while the purge has not started. Log out leaves the date.
Keep does not reconnect Strava, and the page says so.

**The server refuses a leaving runner too** (review of PR #130), because
a redirect is the client's to skip — the browser's has-handle memo skips
the question that carries it — and a garment saved after the purge's
closet step would outlive the account. In the one gate
(`auth/leaving-gate.ts`): `requireUserId` refuses any runner with an
`account_deletions` row (`AccountLeavingError`), reads and writes alike,
and only Keep's server function uses `requireUserIdWhileLeaving`, which
lets a runner inside the week through. Once the purge starts, the claim's
batch deletes the runner's sessions and a Better Auth session hook
(`deletionGate`, the ban gate's shape) makes no new one — answering
log-in's own "wrong email or password", so a sign-in says no more than
the handle page does (decision D-82). `requireSession` is unchanged: a
leaving runner who reaches a page loads its data through `requireUserId`,
which refuses.

**The purge** — **reconciliation, not an outbox** (law 8c). The claim row
is already the durable "not finished" marker, and something already re-runs
it: the daily firing. So each firing claims what is due (`UPDATE … SET
purge_started_at = now WHERE purge_after <= now AND (purge_started_at IS
NULL OR purge_started_at < now − 1h)`, law 2, at most 3 accounts) and walks
the steps; every step deletes what is left, so a purge that dies at any
step finishes on the next firing. The claim row is deleted in the **same
batch as the `user` row**, last. In order:

1. **`manual_conditions` in `DIALED_WEATHER`**, by the runner's run ids —
   first, because once the runs are gone nothing names these rows. A
   second database, so it is its own write (law 8c); a failure throws and
   the next firing redoes it.
2. **Runs and entries** through feed's `deleteRuns(db, userId, "all")`
   (128 · SAF-3): runs, entries, items, tags, reactions on them, photos,
   notifications about them, imports with a run, and the R2 debts for the
   entry prefix and each run file.
3. **The closet**: every garment and a `photo_delete` debt per garment,
   plus imports with no run and their files. Written here, beside the
   runs: closet's `deleteItem` refuses a garment an entry used (retire,
   don't delete) and is one garment per call; step 2 has already removed
   every entry, and deletion is **the stated exception to "retire, don't
   delete"**.
4. **The social rows**: follows and blocks both ways, the runner's
   reactions and notifications, their email switches, confirm links,
   password tries, send limits, access request, and any Strava row left.
   **Reports they filed stay, the reporter replaced** (decision D-78;
   open question 3's default): `reporter_id` becomes `deleted:{report id}`, which keeps
   one-per-reporter counts true and names nobody. Reports filed _about_
   them stay, as SAF-3 keeps them. Moderation actions and quarantined
   content stay (D-70: evidence outlives the account).
5. **The invite's use stays spent** (2b-1): the redemption row is kept
   with its address replaced by `deleted:{user id}`. **Every address the
   runner is known by** — the account's, the one they redeemed with, any
   they were moving to — loses its access request, its send counters and
   any invite code label naming it. D7 no longer copies a request's
   address onto its code at all: "{address} (request)" is read from the
   request at display time, so the purge forgetting the request takes the
   address off the Desk (review of PR #130).
6. **The handle is never released** (D-56, D-72(6) — round 27 #14's
   "handle is released" is overruled): it moves to `username_history`, as
   any handle given up does, and the profile row goes. Its `/@handle`, and
   any handle the runner gave up before, then says "This runner isn't
   here." (decision D-82), told apart from a rename by the missing
   profile.
7. **Better Auth last**: `session`, `account`, `user`, and the claim row,
   one batch.

**Where it runs.** The daily firing, as the packet says, but not as a
line in `ops/scheduled.ts`'s imports: `ops` → `account` → `ops` is a cycle
(account owes email through `ops`, and so does feed's `deleteRuns`).
`handleScheduled` takes the daily upkeep as a parameter and the Worker
entry (`src/server.ts`, 125's) hands it `purgeDueAccounts`; a digest kind,
`account-deletion`, reports a purge that failed or a backlog past the cap
(law 6).

### The email hookups

New kinds in `lib/email.ts`, all transactional (no switch):

- `invite` — D7's Send invite, owed in the same batch as the code (round
  26 #20: "Your dialed.run invite" · "Here's your code: DIAL-XXXX. It
  works once." · Create your account → `/join?code=`). The code is minted
  before the batch, and a batch that loses a double press to another
  deletes its own debt in the same batch, so no email carries a code that
  was never stored.
- `strava_disconnected` — 127's deauthorization, owed in its batch (round
  27 #19's email, with 127's neutral first line, since the event can be
  forged). A one-line hookup at 127's call site; `runs` reaches `ops`
  only through an injected `owe`, since `ops` imports `runs`.
- `deletion_scheduled` — ACC-9 (round 27's "Email delete scheduled").
- `digest` — 125's OPS-11 (Operator Screens D5): Today's three numbers,
  sent to each admin every morning from the daily firing, even at zero.
  Once a UTC day: the outbox key collapses overlapping firings, but the
  fast path deletes the row on success, so the day is also marked in
  `cron_checkpoints` (`digest-email`), in the batch that owes the mail —
  no migration.

### Migration

`0040_add_account_deletions` (core, additive: one new table). Lane 128's
safety 2b may also take 0040; whoever merges second renumbers.

## PR 2b-3: emailed export

Branch `feat/126-export-zip`. ACC-10 as round 27 #13 draws it and the
owner decided (D-79, register D-116): the interim JSON download goes, and
"Get a copy" queues a ZIP that is emailed as a link.

### What the board says, and where it is followed

Round 27 #13 (`Round 27 Rulings.dc.html`, the Export ruling, the U1 row
and "Email export"):

- The row: "Export your data" · "Runs, closet, entries, photos and your
  run files" · Get a copy. Pressed, the action becomes `[ Preparing ]`
  and the sub-line "We'll email a link when it's ready."
- **One export a day.**
- The ZIP: `runs.csv`, `entries.csv`, `garments.csv`, the original run
  files and the photos, and a README naming each column.
- The email: "Your dialed.run export is ready" · "Your runs, closet,
  entries, photos and original run files are in one ZIP." · Download
  export · "The link works for 7 days, only while you're logged in."

So: **expiry 7 days** (the board's), and **the link needs the owner
signed in** (the board's "only while you're logged in").

**Where the ZIP holds more than the board lists** (design deltas; the
owner kept both, decision D-83): a runner's kit rows carry a flag and a note per garment,
which one `entries.csv` row per entry cannot hold without packing a list
into a cell, so they are `kit.csv` (entry, garment, flag, note); and the
account and profile (email, joined, handle, place, units, calibration,
share default) — in the JSON today, and the runner's data — are
`profile.csv`, one row. Both are named in the README like the rest.

### Request

A server function, `requestExportFn`, from the row's button (a control
outside a form: `useControlAction`, the Sign-out pattern). It carries a
client key (`useIdempotencyKey`, law 8b), rotated after a success.

`requestExport` decides, in order:

1. **A repeat of the same key** returns what the first call made.
2. **One in flight** (`pending` or `building`): nothing new; the row
   shows Preparing.
3. **One a day**: a request made less than 24 hours after the last one
   that did not fail makes nothing. A failed one never counts, so "try
   again" works at once.
4. Otherwise one row (`pending`) and a queue message.

The table enforces 1 and 2 by itself: `UNIQUE (user_id,
idempotency_key)` and a **partial** unique index on `user_id WHERE status
IN ('pending','building')`, so two racing requests make one export
whatever the reads said. The insert is `ON CONFLICT DO NOTHING`, then the
row is read back.

The row goes first and the queue send second — two systems (law 8c).
**Reconciliation, not an outbox**: `status = 'pending'` is already the
durable marker, so a send that fails is reported and the hourly sweep
(below) re-sends it. The runner is told "We'll email a link when it's
ready", which stays true.

### Work: its own queue, `dialed-exports`

**One new binding, owner-approved (decision D-86).** The job is
`{ type: "account_export", exportId }` on `dialed-exports`
(`EXPORTS_QUEUE`), with its own DLQ `dialed-exports-dlq`,
`max_batch_size: 1` — one ZIP build a delivery — and `max_retries: 3` as
`dialed-imports` has. The first draft rode `dialed-imports` as a new
variant; the review moved it, and **moved** rather than kept it on both
queues, which law 9 allows only because nothing has deployed: no message
of the old shape can be in flight. `modules/ops/queues.ts` registers the
queue, so `test/bindings-conformance.test.ts` asserts it (law 10), and
the same test now holds the test pool's producers to `wrangler.jsonc`'s.

The wire format (`exportsQueueMessageSchema`) and both consumers are
`account`'s (`account/export-queue.ts`). `ops` cannot import `account`
(the cycle 2b-2 documents), so `handleQueueBatch` takes them from the
Worker entry as `ExportConsumers`, exactly as the purge is handed to
`handleScheduled`; a `dialed-exports` batch that arrives with none wired
throws, so the queue redelivers and dead-letters it rather than acking a
runner's export into nothing.

The ZIP is staged in the `IMPORTS` bucket under
`exports/{userId}/{exportId}/{claimId}.zip`. Not `MEDIA`: `IMPORTS` is
never served by any route, and `exports/` sits beside `imports/{userId}/`,
never inside it, so the `import_file_delete` kind cannot reach an export.

**The build** (`account/export-build.ts`, reached only from
`src/server.ts`, never from the barrel — it imports the zip library):

1. **Claim** (law 2): `UPDATE … SET status = 'building', claimed_at = now,
claim_id = <fresh> WHERE id = ? AND status IN ('pending','building')`.
   Nothing moved — finished, failed, or gone — is a no-op ack. `building`
   is re-claimable so a redelivery after a crash rebuilds, **which means a
   sweep re-send or a duplicate delivery can take the claim while another
   build is still running.** The first draft said two such builds "write
   the same key with the same bytes"; that was false — the rows can change
   between their reads, and the loser's ready batch still owed a second
   email (review finding 1). So each claim is its own: the ZIP key carries
   the claim id, and only the build still holding the claim can finish
   (step 5).
2. **Read** the runner's rows (the JSON export's reads, kept): profile,
   closet, runs with **derived conditions only** (never a raw Visual
   Crossing row, §1.8), entries with kit, tags and photos, uploads.
3. **List** `IMPORTS` `imports/{userId}/` and `MEDIA` `entries/{userId}/`
   and `items/{userId}/` — sizes for the files the rows name. Listing is
   R2, not SQL; the intersection with the rows is in code.
4. **Stream**: `makeZip` over an async generator that `get`s one object
   at a time, piped into a `FixedLengthStream` whose length
   `predictLength` computed from those sizes, which `IMPORTS.put`
   consumes. **At most one photo is in flight**; the CSVs are strings.
5. **Ready, and the email, in one batch**: `status = 'ready'`,
   `ready_at`, `expires_at = ready_at + 7 days` **where the row is still
   `building` under this claim**, and the `export_ready` email owed
   through the outbox (dedupe key `export_ready:{id}`) as an
   `INSERT … SELECT … FROM data_exports WHERE id = ? AND claim_id = ? AND
status = 'ready'` — so it owes a row only if that update did (a batch
   cannot branch on its own results; ops' `outboxInsertWhere`). If the
   update changed nothing — the claim was taken over, or the row was
   failed or purged mid-build — the build deletes the ZIP it wrote and
   stops: one export, one email, one ZIP, whoever wins; a purged or failed
   row gets neither. Then the fast path. **A file that vanished between
   list and get** is written as zeros of its listed size, so the upload
   completes at its promised length (an errored stream leaves R2's `put`
   with rejections nobody holds); then the half-made ZIP is deleted and
   the build throws, and the queue retries (law 3).

**Photos in the ZIP**: every entry photo the runner posted, shared or not
(their JPEG, as stored), and each garment's current photo — its
re-encoded `original.jpg`, the full size the app keeps, falling back to
`full.webp` for a photo stored before originals were. **Run files**: every
upload whose file is still there, as uploaded (GPX, FIT, TCX).

**Size.** `FixedLengthStream` + a single `put` is bounded by R2's 5 GB
single-object limit. At the app's photo sizes that is thousands of
photos; a runner past it gets "failed" and Sentry an event with the ids.
Multipart would lift it at the cost of part bookkeeping; not built.
CPU is the CRC32 over each byte, in JS — about a second a gigabyte.

### The zip library: `client-zip`

`client-zip` 2.5.1 (MIT, zero dependencies, 6.5 kB, last release
2026-09): streaming by design — it pulls the next file from an async
iterable only after the last is written, so the generator above decides
what is in memory; Web Streams in and out, which is what R2 speaks;
ZIP64, so a large export is still a valid file; `predictLength`, which is
what lets R2 take the stream with a known length; and CRC32 in plain JS
since 2.4 (no WebAssembly compile, which Workers forbid at runtime). It
stores rather than deflates, which costs nothing on JPEGs and a little on
the CSVs. `fflate` was the alternative: it deflates, but its streaming
`Zip` is push-based with callbacks, and bridging that to a pull stream
with back-pressure is code this repo would own.

Server-only: the build file is imported by `src/server.ts` alone, and
`npm run build`'s `check:bundle` confirms nothing of it reaches the
client chunk.

**The files, as built.** `data-exports.ts` (request, row state, DLQ fail,
download), `export.ts` (the reads), `export-files.ts` (which R2 objects
go in, under what name, and every sheet's rows), `export-sheets.ts` (the
five CSVs' column tables: name, README sentence, value),
`export-format.ts` (CSV cells, the README's lines), `export-queue.ts`
(the queue's wire format and consumers), `export-build.ts`,
`export-sweep.ts`. **Two additions to `.fallowrc.jsonc`'s `ignore`** came
from the commit gate's clone check: `export-sheets.ts` (a column table
reads as a copy of any other) and `src/lib/email-kinds.ts`, the email
kinds split out of `lib/email.ts` for the same reason, beside
`tap-list-data.ts`'s precedent. The coordinator kept both, on one
condition for the sheets: **every column there is a plain field read.**
The review found behaviour in it — the `joined_at` conversion, three map
lookups and a throw — so those moved onto `export-files.ts`' row-building
step, where the clone check reads them. The throw went altogether: each
entry's photos are now resolved beside the entry itself, so there is no
lookup that could miss.

A CSV text cell starting `=`, `+`, `-`, `@`, a tab or a CR is prefixed
with `'` (OWASP's CSV-injection advice): product names and captions are
other people's words, opened in a spreadsheet.

### Delivery

`GET /account/export/$token` (a server route, glue; `exportFileResponse`
decides):

- **Unguessable**: the link carries `link_token`, 128 random bits (hex),
  UNIQUE, minted with the row — not the row id, which is a ULID and
  partly a timestamp.
- **Single-runner**: the signed-in runner must be the export's owner;
  anyone else gets the same answer as a token that does not exist.
- **Signed out** → log in, and back to Settings › Account (a page route;
  log-in's return is a client navigation, which cannot land on a file),
  where the row offers the download.
- **Expiring**: `status = 'ready'` and `expires_at > now`; otherwise back
  to Settings › Account, where the row offers a new copy.
- The file: `application/zip`, `attachment;
filename="dialed-run-export-YYYY-MM-DD.zip"`, `private, no-store`, its
  length.

The token rides the outbox payload (the email's link), which "a payload
never carries a secret" allows only because **the token is not a bearer
credential**: without the owner's session it opens nothing.

### Expiry: the hourly `:00` firing

`handleScheduled`'s upkeep (the Worker entry's hand-off) gains
`sweepExports`, run on the `0 * * * *` firing. Claim-then-work (law 2)
and re-runnable (law 1):

1. **Expire**: claim `ready` rows past `expires_at` (and `expiring` rows
   whose claim is over an hour old) as `expiring`, capped at 50; delete
   each ZIP; then delete the row. A failure between leaves `expiring`,
   which the next firing re-claims.
2. **Failed rows** older than 7 days are deleted, **with their ZIP**: a
   failed export can hold a whole one, when the last build's `put`
   finished and its ready batch failed before the queue gave up (review
   finding 2; the first draft assumed nothing was staged). The claim's key
   goes first, then the row; an R2 failure leaves both for the next
   firing, reported, with an anomaly line.
3. **Re-send** `pending` rows older than 15 minutes and `building` rows
   claimed over an hour ago (a lost send, a lost message), capped at 50,
   with an anomaly line for the digest.

**An R2 lifecycle rule on `IMPORTS`' `exports/` prefix** (delete after 8
days) is the net behind the sweep (decision D-85), set by the owner at
deploy time (`docs/deployment.md` §2): it catches a ZIP a build left under
a claim no row holds, when it died between its upload and its ready
batch. No code.

Every hourly firing's steps now run whichever of them fail (law 5): a
sweep that throws no longer costs that hour's email drain, nor a weather
retry the sweep. The firing still throws afterwards — the one error, or
an `AggregateError` of all of them — so its check-in closes as an error
and the Worker entry reports it.

### Failures (law 6)

The DLQ's `fail` marks the export `failed` (only from `pending` or
`building`) and reports to Sentry with the export and runner ids — never
file names or contents. The row then says "Your export didn't work. Try
again." with Get a copy.

### Deletion (ACC-9)

The purge gains a step before the account rows: every object under
`exports/{userId}/` in `IMPORTS` (listed, so a ZIP an unfinished build
staged is found too), then the rows go in the last batch with the other
by-user tables. The purge test's `GONE` footprint gains `exports` and
`exportFiles`.

### The row's states

| state     | when                                           | sub-line                                           | action          |
| --------- | ---------------------------------------------- | -------------------------------------------------- | --------------- |
| idle      | no export, or the last is over a day old       | "Runs, closet, entries, photos and your run files" | Get a copy      |
| preparing | the last is `pending` / `building`             | "We'll email a link when it's ready."              | `[ Preparing ]` |
| ready     | the last is `ready`, requested under a day ago | "Emailed. The link works until {day}."             | Download        |
| failed    | the last `failed`                              | "Your export didn't work. Try again."              | Get a copy      |

Ready and failed are **undesigned** (design deltas): the board draws
idle and preparing only.

### Migration

`0041_add_data_exports` (core, **additive**: one new table, its indexes).
The review's `claim_id` column is folded into it, snapshot included,
rather than a second migration: `0041` has not merged anywhere.

### Privacy policy

The policy's "Export your data" lines are the owner's; what this makes
stale is listed in `docs/legal/privacy-policy-sources.md`, not edited in
`privacy-policy.md`.

### Owner questions

Answered by the owner, 2026-09-30:

1. `kit.csv` and `profile.csv` beyond the board's three CSVs: **kept**
   (decision D-83), a board delta for round 28.
2. A ready export shows Download on the row for its first day: **yes**
   (decision D-84), a board delta for round 28; so the link token stays
   stored in plain text, which the row reads back.
3. A lifecycle rule on `IMPORTS` `exports/` as a second net: **yes**, 8
   days, at deploy time (decision D-85).
4. The two `.fallowrc.jsonc` ignore entries: **kept**, the sheets' only
   once every column is a plain field read (above). Exports also got their
   own queue (decision D-86).

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
- Bindings: `send_email` `EMAIL` (decision D-42); the `dialed-exports`
  queue, its DLQ and `EXPORTS_QUEUE` (decision D-86, PR 2b-3). No cron.
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
