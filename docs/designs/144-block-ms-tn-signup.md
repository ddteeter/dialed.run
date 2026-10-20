# Design: 144 No new accounts from Mississippi or Tennessee

## Problem

Owner decision, 2026-10-18 (D-141; the docket check that would lift it is
register row R-159). Mississippi's HB 1126 and Tennessee's Protecting
Children from Social Media Act (Tenn. Code Ann. §47-18-5701 et seq.) are in
force against every provider, and both require verifying the age of every
account creator. dialed.run asks for a date of birth and checks no ID, so
account creation from those two states is refused. Existing accounts and
signing in are not affected. Asking for access is not affected either: a
waitlist entry is not an account, so the request is taken, tagged with the
state, and shown on the Desk (owner's scope change, same day).

## Approach

- **One gate**, `blockedRegionOf(request: unknown)` in
  `lib/contracts/access.ts`, with `isFromBlockedRegion` as its yes or no.
  It parses `request.cf` with zod: `country` must be `"US"` and
  `regionCode` a key of `BLOCKED_US_REGIONS` (`MS`, `TN`). A missing or
  malformed `cf` (local dev, tests, a server-side call) is not blocked. The
  list maps each code to the state's name, and every sentence is built from
  those names. Lifting a state is one line, and only on an order enjoining
  the law as to non-parties.
- **Email sign-up**: the before-hook (`admitSignUp`) refuses first, before
  Turnstile, with `REGION_BLOCKED`. A registered address gets the same
  refusal, so the answer reveals nothing about which addresses have accounts.
- **Google sign-up**: refused in the user create hook (`claimInvite`) on the
  callback request. Au2's button cannot know before the redirect whether the
  address already has an account, the same as with the invite code. An
  existing account signs in from anywhere, and a new one comes back to Au2
  as `?error=REGION_BLOCKED`. Invite redemption happens in that same create
  hook, so it is covered too.
- **Au5 request access**: `requestAccess` takes a required `blockedRegion`,
  which the server function reads off `getRequest()`, and records it in
  `access_requests.blocked_region`. A repeat ask overwrites it with the
  latest place. The receipt for a tagged request is the waitlist copy, with
  no "Create an account" link. The marketing site's planned
  `POST /api/access-requests` is not built. When it is, it calls
  `requestAccess`, and the required field forces it through the gate.
- **D7**: each request shows `[MS]` / `[TN]` in mono. While the state is
  still listed, the row has no Send invite, only the reason, and
  `inviteFromRequest` refuses with that reason (`{ refused }`), minting and
  emailing nothing. D7 decides from the list, not from the tag, so lifting a
  state makes its requests invitable straight away.

## Contract touches

- Schema: **additive**. `access_requests.blocked_region` is a nullable text
  column, added by migration `0062_add_access_request_blocked_region`
  (core).
- New route files: none. New bindings/queues/crons: **none**.
- Screens: Au2, Au5 and D7, covered by design-deltas item 66 (undesigned
  copy).

## Test plan

- `test/lib/access.test.ts` (worker): MS and TN are blocked; another state,
  another country, a missing field, a wrong type and an inherited key are
  let through; no `cf` and no request are let through; the copy, tag and
  reason come from the list.
- `test/auth/access-hook.test.ts` (worker, real Better Auth on D1): email
  from MS or TN is refused before Turnstile, makes no account and leaves the
  code unspent; a new Google account from TN is refused on the callback;
  Google from OR works; an existing account signs in from MS and from TN.
- `test/account/invites.test.ts` (worker): a TN request is taken and
  tagged, limited or not; a repeat ask from elsewhere clears the tag; D7
  reads the tag; Send invite is refused with nothing minted or sent; a tag
  for a state no longer listed is invited.
- `credentials.test.ts`, `sign-up-page.dom.test.tsx` and
  `access-pages.dom.test.tsx` cover the band, the receipt and D7's row.

## Open questions

- All the copy is the owner's wording or a placeholder (item 66).
- Cloudflare places a request by its IP address, so a VPN gets past the
  gate. That is the usual standard for geoblocking.
