# Design: 230 sec-request

## Problem

Wave 13 lane 13a: five items from the 2026-11-14 security audit, tracked
by id only in #756 (SA-M1, SA-M25, SA-M35, SA-L03, SA-L13). This lane
makes a server function answer only its own origin, makes a payload
carry data and never a callable, pins every cookie to the app's host, and
ties two GET-reachable effects to the runner's own navigation.

## Approach

- **SA-M1.** `src/start.ts` registers TanStack Start's
  `createCsrfMiddleware`, filtered to `handlerType === "serverFn"` with no
  method condition, so every `/_serverFn/*` request, GET or POST, must be
  `Sec-Fetch-Site: same-origin` (or, with no fetch metadata, carry this
  origin's `Origin` or `Referer`). Anything else answers 403 before the
  payload is read. Server functions called during a server render do not
  go over HTTP and are unaffected.
- **SA-M25.** `lib/refuse-server-fn-argument.ts`: an adapter under the
  framework's `$TSS/serverfn` key, listed first in `src/start.ts`. It never
  matches a value on the way out and throws on the way in, so no payload
  turns into a server function. The app never passes one as an argument.
  Every POST server function has a validator: the six that take no input
  parse `lib/no-input`'s empty object, and their routes send
  `{ data: {} }`.
- **SA-M35.** Every cookie is `__Host-`: the browser keeps it only as this
  host set it (`Secure`, `Path=/`, no `Domain`).
  - Session: on https `createAuth` sets `useSecureCookies: false`,
    `cookiePrefix: "__Host-better-auth"` and `secure: true` on every
    cookie Better Auth writes. On http (local dev) the names are
    unchanged. Everyone signed in is signed out once; nothing is deployed.
  - `d1b` and `dialed_age_refused` become `__Host-d1b` and
    `__Host-dialed_age_refused`, as 12c did for the Strava state.
- **SA-L03.** `completeOnboardingFn` writes only for a request whose
  `Sec-Fetch-Site` is `same-origin` or `none`, or absent. A decision in
  `modules/onboarding` reads the header. *(Guess, Q3.)*
- **SA-L13.**
  - `wireErrorAdapter` parses what arrives with the schema it already
    holds, and builds the `Error` from the parsed copy only.
  - The terms prompt's "you'll go back to …" name travels in the
    navigation's history state, set by `ui/terms-refusal.tsx`, not in
    `?save=`. It shows after mount. *(Guess, Q4.)*

## Contract touches

- Schema: **none**. Bindings: **none**. Routes: none new.
- Cookie names change (`docs/legal/privacy-policy-sources.md`).
- Screens: the terms prompt's return note (where its name comes from).

## Test plan

- Vitest, text scans of what no test can import:
  `test/architecture/server-fn-request-check.test.ts` (the middleware and
  the adapter's place), `post-functions-take-input.test.ts` (every POST
  function has a validator), `loaders-do-not-write.test.ts` (a loader
  calls no POST function; two guarded routes, each with its reason).
- Vitest units: `test/lib/` (`fetch-site`, `no-input`,
  `refuse-server-fn-argument`, `auth-signal`), the cookie names and the
  emitted `Set-Cookie` (`test/auth/`, `test/lib/d1-session`), onboarding,
  and `useSavedPage` (dom).
- `e2e/auth/server-fn-origin.spec.ts` (edge case): only a running Worker
  shows a foreign `Sec-Fetch-Site` answered 403 on GET and POST, and a
  payload naming a server function refused.

## Issues

- Refs #756 (ids SA-M1, SA-M25, SA-M35, SA-L03, SA-L13).

## Open questions (asked of coordinator-13, 2026-11-16)

- Q3 (owner): a cross-site arrival at `/onboarding/done` no longer
  finishes onboarding.
- Q4 (owner): the terms prompt's page name from history state.

Coordinator (2026-11-16): the validators, yes; `lib/fetch-site` is
shared with 13b.

## Owner answers

Pending (Q3, Q4).
