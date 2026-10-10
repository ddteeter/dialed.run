# Design: 134 18+ age gate

## Problem

The terms say "16 or over" and the app never asks. Admitting 16- and
17-year-olds makes Nebraska's Parental Rights in Social Media Act (LB383,
in force 2026-07-01) reach us: its parental-supervision duties (§28(4)) are
not enjoined and have no size threshold, and Mississippi and Tennessee have
similar unenjoined laws. Every minors law the launch research found draws
the line at 18. The owner's call (2026-10-09): **18 and over**, checked at
sign-up, with the terms saying so.

## Approach

The age rides exactly where the invite code already does
(`auth/access-hook.ts`), so both ways an account is made — the email form
and Google from Au2 — pass one gate.

- **`lib/contracts/age.ts`**: `MINIMUM_AGE = 18`, the `birthDate` field
  (a real calendar date, not in the future — shape only), `isOldEnough`,
  the copy, the header name and refusal codes. Client and server import it.
- **A neutral question.** Au2 asks "Date of birth" with no hint of the
  cut-off, and the form checks only the shape. The age decision is the
  server's, so the form cannot be used to probe for the answer that passes
  (the FTC's neutral age-screen guidance).
- **`admitSignUp`** reads `x-birth-date` after Turnstile, before the code:
  - email: missing → `AGE_MISSING` on the field; under 18 → `AGE_REFUSED`.
  - Google: missing passes (it may be an existing account, the invite
    code's rule); present and old enough → `addOAuthServerContext({
    ageChecked: true })`; under 18 → `AGE_REFUSED` before the redirect.
  - **The refusal sets a 24-hour cookie** (`dialed_age_refused`), and the
    gate refuses while it is present whatever date is typed, so Back and a
    different year does not get through.
- **`claimInvite`'s create hook** refuses a Google account made without
  `ageChecked` in its state (`AGE_MISSING`, back to Au2 as `?error=`) —
  regardless of the invite-only flag, which today returns early.
- **Nothing is stored.** The date is read and dropped; there is no column
  and no log of it. An account existing is the record that it passed.

## Contract touches

- Schema changes needed: **none**.
- New route files: none. Au2 (`routes/auth/signup.tsx`) gains one field.
- New bindings/queues/crons: **none**.
- Screens: Au2 gains "Date of birth" and the AGE_REFUSED band —
  undesigned, composed from `TextField` + `FormFailureBand`; logged in
  `docs/design-deltas.md`.
- Legal text: `terms.md` 16 → 18 and "we ask, we don't keep it";
  `privacy-policy.md` Children section filled. Both stay unpublished drafts.
- `docs/decisions.md`: D-114 (18+) and D-115 (stay open to EU/UK sign-ups,
  EU representative not appointed — an accepted risk).

## Test plan

- `test/lib/age.test.ts` (unit): birthday today, one day short, leap-day
  births, a future date, a non-date.
- `test/auth/access-hook.test.ts` (worker): each email and Google branch
  above; cookie set on refusal and honoured after; invite-only off still
  checks age; create hook refuses Google without `ageChecked`.
- `signup.dom.test.tsx` (ui): field renders, shape errors land on it,
  `AGE_REFUSED` lands in the band, the header carries the date.
- e2e `auth.demo.spec.ts`: sign-up fills the date; re-record the demo.

## Open questions

- **Accounts made before this ships are not asked.** Pre-launch every one
  is an invitee the owner knows. Proceeding on that; say if they should
  be asked at the terms prompt instead.
- **Refusal copy** (draft, owner's to change): "Sorry — dialed.run is for
  runners 18 and over." No appeal path.
