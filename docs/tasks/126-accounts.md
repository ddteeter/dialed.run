# Task 126 — Accounts

Lane 2 of 5 building to the launch development plan. Read
`125-129-launch-development.md` first: it holds the rules every lane
shares, the migration protocol and the cross-lane seams.

**Starts after PR #104 merges.** #104 rebuilds auth, the signed-out shell
and settings; this lane builds on what it leaves. **HIBP's breached-password
check was meant to be in #104 and is not on its pushed branch as of
a7255b2** (D-112): it is yours (ACC-14) unless #104 lands with it.

Today a runner who forgets a password is locked out for good, nobody can
leave, and anyone with a script can sign up. This lane gives the app an
account lifecycle: a gated way in, email, verification, recovery, change,
export and a way out. It is the biggest lane; its order below is the order
to build in.

**Round 26 drew most of this** (`Round 26 Rulings.dc.html`; design-deltas
"Answered in round 26", items 7, 11, 13–15, 17–20). It renumbers the auth
screens: its **Au2 is sign-up**, Au4 is "Check your email", Au5 is request
access. Where an owner decision of 2026-09-25 differs from the board
(decisions D-49, D-50, D-52), the decision wins.

## You own

- `src/modules/auth/**` except `instance.ts` (125). In `create-auth.ts`, 125
  adds the `baseURL`, `rateLimit` and cookie options; everything else in it
  is yours.
- `src/routes/auth/**`, `src/routes/index.tsx` (the request-access entry on
  the landing page), new `src/routes/join.tsx` (`/join?code=`)
- New `src/modules/email/**` and `src/modules/account/**`; new
  `src/routes/account/**` (verify, reset, request access, unsubscribe,
  export, delete)
- New `src/routes/privacy.tsx`, `terms.tsx`, `copyright.tsx`, and the legal
  links in `src/ui/SignedOutLayout.tsx` and the landing bar (additions only
  to those two)
- `src/routes/onboarding/settings/**`, `src/routes/onboarding/name.tsx` (O0),
  `src/modules/onboarding/naming.ts`, and the onboarding components that
  render settings and the handle step
- `src/routes/call/**` and `CallLadder` (ACC-16)
- `src/routes/desk/access*.tsx` (D7 Access)
- `wrangler.jsonc`: **the `send_email` binding only** (decision D-42)
- `e2e/auth/`, new `e2e/account/`, `test/auth/**`, new `test/email/**`,
  `test/account/**`

**And, for ACC-1 only**, rename-only edits to every `display_name` reader
in any lane (the shared packet, seam 1).

## Work, in order

**ACC-1 · Usernames replace `display_name` [F]** (§5, §7; decision D-41;
round 26 #7). Your first PR. The migration
`replace_display_name_with_username` adds the column with a
case-insensitive unique index and drops `display_name` and its search index
**in the same change** — the one sanctioned exception to law 8, because the
app has never been deployed. Round 26 says the drop "goes expand→contract";
the owner reaffirmed the same-change drop on 2026-09-25. Say so in the PR,
cite decision D-41, and note that the exception expires at the first
production deploy, so this PR must merge before it. Check the generated
table rebuild by hand (law 8's expression-index trap is exactly this index).

- **Sign-up asks email and password only.** Everyone, email or Google,
  picks a handle at **O0**, the first onboarding step ("What should runners
  call you?", STEP 1 OF 4).
- **The rule**: 3–20 of `[a-z0-9_]`, not starting with `_`, unique
  regardless of case, lowercased as typed, checked on Next (not while
  typing). The three refusals and the taken message with **one real free
  suggestion** (the handle plus the city slug, else plus a digit), as round
  26 draws them. The rule lives in the schema, messages included.
- A reserved and deny list checked at claim time (`admin`, `dialed`,
  `support`, `strava`, `moderator`, and the obvious impersonations),
  normalised the way the unique index compares.
- **Settings › Username** changes it later. **Old handles are kept**
  (`add_username_history`, additive, yours; it may fold into the same
  migration) so 129 can answer `/@old` with "This runner changed their
  name." and never redirect.
- Where the column lives is a design-doc decision: `user_profiles`, where
  every reader already joins, or Better Auth's `username` plugin on `user`.
  Say which and why.
- Every reader moves in this PR: feed, safety, onboarding, tests, e2e.
  Search keeps its prefix index on the new column. The one display style
  (Archivo 600, "@" included, lowercase, never mono) is 129's to apply
  (FEED-10), and the report sheet's wording 128's (SAF-15).

**ACC-2 · Email plumbing [F]** (§2.3, §4; decisions D-42, D-43; round 26
#19). Round 26 splits sending to 125; it is here because this lane owns the
email module and the binding.

- Add the `send_email` binding to `wrangler.jsonc` and assert it in
  `test/bindings-conformance.test.ts` (law 10). Say in the PR that the
  owner authorised it.
- **First, check React Email renders in workerd** (a worker test that
  renders one template to HTML and text). If it does, use it; if not, typed
  template functions producing both. Record the result in the design doc.
- `modules/email` exposes one interface: send a named template to a user,
  honouring `notification_preferences`. **Publish it in your design doc on
  day one**; 125, 127 and 128 build against it. It takes an optional
  not-before time, for 127's 20-minute reminder delay.
- Sending is a secondary effect wherever it is not the thing the user asked
  for (law 5). Consider #101's outbox with an `email` kind, so the event row
  and the send intent commit together and the drain retries.
- `add_notification_preferences` (additive, yours): per kind, default on
  for the reminder. Transactional kinds have no row and no switch.
- **Unsubscribe** (round 26 #19): `List-Unsubscribe` with one-click on the
  reminder; a signed, never-expiring link per address and kind that
  unsubscribes on open, with no log-in or confirm, landing on "Run reminder
  emails are off" · Turn them back on; the invalid-link page. Every email
  footer links the privacy policy (decision D-52).

**ACC-3 · Email verification [F]** (decision D-42; round 26 #11; decision
D-50).

- **Every email sign-up ends on Au4** "Check your email", whether the
  address is new or registered; a registered address gets "You already have
  a dialed.run account", so the page reveals nothing (Au3's exception is
  retired). The link works once, for 24 hours. Resend: `[ Sending ]`, "Sent
  ✓" for 60 s (the old link stops working), and the rate-limited band. Link
  expired, used and success pages. Google accounts skip Au4.
- **Unverified runners can sign in and do everything private.** Their
  entries **save private**, and verifying restores their default (decision
  D-50). **Do not build round 26's queued-share state**: `docs/contracts.md`'s
  sharing model does not change. Tell design in your PR's "Design deltas".
- Useful, report, email change and reset-by-email wait: export
  `isVerified` and the "Confirm your email first" sheet; 129 wires Useful and
  the nag band (FEED-11), 128 wires report (seam 7).
- Tests: an unverified runner's new entry is private whatever their
  default; verifying flips it to their default; the registered-address path
  sends the other email and renders the same page.

**ACC-4 · Password reset [F]** (§2.3). "Forgot it?" on the log-in form.
Request, check your inbox, set a new password (the `PASSWORD_MIN_LENGTH`
floor), expired link. The request answers the same whether or not the
address has an account, and waits for verification (round 26 #11). Undrawn:
design ask.

**ACC-5 · Invite codes and request access [F]** (decision D-39; round 26
#20).

- `add_invite_codes_and_access_requests` (additive, yours).
- **INVITE CODE is the sign-up form's first field**, above email and
  Google; `/join?code=` fills it. The used and invalid messages as drawn.
  Codes are `DIAL-XXXX` without 0/O/1/I, case ignored.
- **Sign-up requires a valid code**, email and Google alike. Google creates
  its account on the OAuth return, so the code has to survive the round trip
  (validated before the redirect, carried in something short-lived and
  signed) and be checked in the create hook. A Google sign-in to an existing
  account needs no code. **A code is consumed at account creation**, not at
  verification.
- **Au5 request access**: email plus an optional 280-character note;
  "You're on the list" for a new, repeat or registered address alike, a
  repeat updating the note. Turnstile-guarded (125's widget), rate-limited.
- **Desk · D7 Access**, under 125's shell: **Requests**, oldest first; Send
  invite mints a single-use code, emails it ("Your dialed.run invite") and
  moves the row to Codes; Decline is silent. **Codes**: label, uses limit,
  used-by @handles, Copy link, Revoke with a 10 s undo and no confirm.
- The owner's account is seeded (say how in the design doc: a data seed or
  a deployment step).
- **One flag removes the field and the request link.** Build it and leave
  it on; flipping it is the owner's call at the public gate.
- Turnstile on the sign-up form too.

**ACC-6 · Terms acceptance [F]** (§1.1, §1.3). Under the sign-up form, beside
the privacy line ("Creating an account means you've read our Privacy
policy."), a line linking `/terms`, with the minimum age the owner's terms
set; acceptance recorded (timestamp and terms version). Undrawn: design ask.

**ACC-13 · Legal pages [F]** (D-105; round 26 #14; decision D-52). `/privacy`
is a reading page: sticky contents column at the desk, a plain list under
the H1 on the phone, an id and "↑ Contents" on every H2, no accordions,
underlined inline links, the signed-in shell when signed in. **Contract
values, not the board's**: the 620 document measure and the `lead` step.
`/terms` and `/copyright` (the DMCA contact) use the same layout. Linked
from the signed-out footer, under the sign-up form, from Settings › About
and from every email footer; **not under the log-in form**. The privacy text
is the owner's review of PR #109's draft (`docs/legal/privacy-policy.md`);
the terms and copyright text are the owner's. Do not write policy prose.

**ACC-14 · Breached password [F]** (round 26 #17–18; D-112). If #104 lands
without it: the HIBP range check at sign-up and password change, failing
open when unreachable. Copy: "That password has turned up in a data breach.
Pick another." (never "your password was breached"); the hint "At least 10
characters.", the refusal "Use at least 10 characters.", and no length hint
on the sign-up form.

**ACC-15 · The Google button [F]** (round 26 #13; decision D-49). The
official G, Google's colours, stroke and shape, 48 high, "Continue with
Google" on both forms, light and dark. **The label is Archivo, not Roboto.
Check Google's branding guidelines on the label font before building**; if
they require Roboto, stop and ask. `data-part="google-button"` is exempt
from the palette and icon checks, and nothing else is: add exactly that
exemption to those tests. Focus follows §06.

**ACC-7 · Password change and sign out everywhere [P]** (§2.4). U1 Account.

**ACC-8 · Email change [P]** (§2.4). Confirmed from the new address; a
notice to the old one. Waits for verification.

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
  R2 `MEDIA` and `IMPORTS` through 128's primitives and #101's outbox, the
  handle history, and Better Auth's rows last. Shared `products` stay.
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

**ACC-11 · Settings › Notifications [P]** (§4; decision D-43; round 26 #19).
Email switches per kind: Run reminders (on by default), Useful ("IN THE APP
ONLY"), Account and security ("ALWAYS SENT", no switch). **No push column**:
PWA push is out of scope (decision D-44), so the board's Push switches are
absent. 127 reads the reminder switch (STR-9).

**ACC-12 · Moderator force-rename [P]** (§5, 0.3). A Desk control beside
128's ban panel; the renamed runner is told, and the old handle goes into
the history so it is not immediately reclaimable.

**ACC-16 · The Call teaser at 15 [P]** (round 26 #15). 15 cells, `4 OF 15
VERDICTS`, "Log 15 verdicts and the Call starts.", "11 to go. …", and at 0
"Your first verdict is one run away."

## Tests

Worker tests for every server path: a code refused (missing, used, revoked),
a code consumed at creation, a Google create without a code refused, a
handle refused for each rule and each reserved name in any case, an
unverified runner's entry saved private, a reset link single-use and
expiring, an unsubscribe link that works without a session and a tampered
one that does not, sessions gone after sign out everywhere, the email handed
to the binding with the right recipient, template and headers. ui tests for
every new form's states. `modules/email` and `modules/account` join the
mutation ratchet at 100% in the PR that finishes them. Conformance specs
against round 26's frames (O0, Au2 invite code, Au4, Au5, D7, the Google
button, the privacy page, settings notifications).

## Demos

- `e2e/auth/`: sign up with a code, check your email, verify, pick a handle
  at O0; forgot password.
- New `e2e/account/`: request access; D7 sending an invite; change password;
  sign out everywhere; the unsubscribe link; export; delete and cancel
  inside 7 days.
- The onboarding and feed demos re-recorded after ACC-1 (`@handle`).
