# Design: 225 sec-auth

## Problem

Wave 12 lane 12a: eight items from the 2026-11-14 security audit, tracked by
id only in #756 (SA-M2, SA-M3, SA-M4, SA-M5, SA-M16, SA-M26, SA-L01,
SA-L06). This lane hardens sign-up, sign-in, the email links and the auth
instance's configuration.

## Approach

- **SA-M2, email links and Google.**
  - `/account/verify` reads the link with a new GET server function
    (`readEmailLinkFn`, sessionless; it claims nothing) and shows what the
    link would do. One button does it, over POST `confirmEmailFn`, as the
    unsubscribe landing does (D-64): "Confirm email" for a sign-up link,
    "Use this address" for a change link, which names the address.
  - `createAuth` sets `account.accountLinking.disableImplicitLinking`.
    Continue with Google for an address whose account has no Google login
    is refused, with the owner's sentence under the button: "That address
    already has an account. Log in with your password, or reset it."
    (`GOOGLE_REFUSALS`, `account_not_linked`).
- **SA-M3, the auth secret.** `createAuth` refuses a secret that is not a
  non-empty string, or that is Better Auth's built-in default. Health's
  `REQUIRED_CONFIG` names `BETTER_AUTH_SECRET`. `/verify-email` is closed
  (the app sends its own confirm links). The deploy docs say a missing
  secret stops the Worker.
- **SA-M4, sign-in tries.** `/verify-password` is closed over HTTP, as
  `/change-password` already is (`auth.api.verifyPassword` still works).
  Email sign-in counts wrong passwords per typed address in
  `email_send_limits` under a `signin:` key (11a's pattern): 10 in 15
  minutes. An address with no account is counted the same way. Past the
  limit the answer is 429 and the band says the owner's sentence: "Too
  many tries for this address. Try again at {time}, or reset your
  password."
- **SA-M5, invite codes.** `DIAL-` and eight characters in two groups,
  `DIAL-7KQ2-M9XP` (40 bits). The field takes the code with or without
  the middle hyphen. Nothing is deployed, so no 4-character codes remain.
- **SA-M16, email change.** A password reset, a password change and Sign
  out everywhere withdraw the runner's open change-email link (one
  statement exported by `modules/account`). Changing your own password
  inside the day therefore withdraws your own pending change, which costs
  one resend.
- **SA-M26, bans.** The ban gate also checks after a session is created:
  it re-reads the ban on the primary, and for a banned runner deletes the
  new session and answers `ACCOUNT_CLOSED`. Both reads use the primary.
- **SA-L01.** The breach screen covers `/reset-password`. Every Better Auth
  path the app does not call is in `disabledPaths`, and a test fails on
  any routed path that is neither on the app's allow-list nor closed.
  `/error` and `/reset-password/:token` stay on the allow-list, each with
  its reason.
- **SA-L06.** Sign-up answers a registered address with the same shape as
  a new account (`customSyntheticUser`: blank name, the same id form,
  dates to the second).

Ordering: SA-M4's limit kind (`send-limit.ts`), SA-M16 (`verification.ts`)
and SA-M26 (`safety/bans.ts`, `test/safety/ban-gate.test.ts`) wait for #786.

## Contract touches

- Schema changes needed: **none** (`email_send_limits` gets a `signin:`
  kind, a comment only).
- New route files: none (`src/routes/account/verify.tsx` changes its loader).
- New bindings/queues/crons: **none**.
- Screens: the confirm and change landings (round 26 #11) gain a state
  with a button. The log-in and sign-up Google band gains one refusal, and
  the log-in band gains one message. All three are design deltas.

## Test plan

- worker: `test/auth/account-security.test.ts` (closed paths answer 404
  and the server's own calls still work; reset and password change
  withdraw a change link while another runner's survives; the sign-in
  count, including the right password refused past the limit and an
  unknown address counted);
  `test/auth/create-auth.test.ts` (secret refusals; synthetic user shape);
  `test/auth/access-hook.test.ts` (Google refused as `account_not_linked`,
  no session, no row; existing round trips get a stable `sub`);
  `test/auth/breached-password.test.ts`; `test/account/verification.test.ts`
  (the read claims nothing); `test/safety/ban-gate.test.ts` (a ban that
  lands mid-sign-in leaves no session); `test/lib/access.test.ts`;
  `test/ops/health.test.ts`; a routed-paths allow-list test;
  `verification-class.test.ts` row for `readEmailLinkFn`.
- dom: the landing's button states; the new bands.
- e2e: the existing confirm journey presses the button (GET and HEAD of
  the link confirm nothing). Playwright, because only a real document load
  runs the loader on the server.

## Issues

- Refs #756 (ids ticked there by the coordinator on merge).

## Open questions

- Guess: the landing's button state reuses the unsubscribe landing's
  composition until Design draws it.
- Guess: the refusal lives in `createAuth` and throws when the instance is
  built. Whether Cloudflare's upload check runs the module with its
  secrets bound is settled at the first deploy.

Owner answers (2026-11-15): a button on the landings; refuse Google into an
email account; 10 wrong passwords per address per 15 minutes; codes
`DIAL-XXXX-XXXX`.
