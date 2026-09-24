# Design: 124 Auth, shell, onboarding, settings, safety, the Call teaser

## Problem

Rounds 21–23 drew or ruled every state of the surfaces a runner meets
first and last: sign up and log in (Au1–Au7), the signed-out shell, the
404 / loader-failed / slow-route states, O1's location step, settings as
an index, the safety sheet and list, and the Call teaser. The build
predates all of it. This lane builds to the drawings and rulings.

## Approach

- **Shell** (`ui/`): `Wordmark` gains `brackets={false}` (the auth and
  landing boards draw the plain lockup). `TopBar.tsx` gains `LandingBar`
  (paper, hairline foot, wordmark → `/`, one optional action, 720 up only);
  `Layout.tsx` gains `SignedOutLayout` (landing bar, never a tab bar).
  `tabs.ts`: the You tab also owns `/onboarding/settings*` and
  `/safety/blocked`. Slow route: `TabBar`/`TopBar` read the router's
  pending state; after 300ms the lit label gains breathing brackets and
  `Layout`'s one status region says "Loading Closet." once.
- **Auth** (`modules/auth`): `AuthPage` rebuilt to Au1/Au2 (header,
  form, or-divider, google, cross-link as `data-part`s). `credentials.ts`
  maps Better Auth codes to field failures (Au3: password; taken email) and
  keeps the cause so the band can say server / connection / rate limit
  under "Not signed in" (Au4). `GoogleButton` goes through
  `useControlAction`: `[ Opening Google ]`, band above it, no pink (Au5,
  Au6); Log in cancels it; a cancelled consent returns to rest.
  `/auth/login` takes `{ redirect, carried, email }` search: Au7's notice,
  email prefilled, focus on Password, return to `redirect` after.
- **Landing** `/`: `SignedOutLayout` with "Log in" (hairline) or "Your
  closet" (ink); the hero's wordmark is phone-only.
- **System states** (`modules/auth/components/SystemState.tsx`): not
  found and loader failed, shell when signed in, bare when not. Root route
  loader reads `signedIn` once (`staleTime: Infinity`, invalidated on
  sign in/out); router wires `defaultNotFoundComponent`,
  `defaultErrorComponent`; no pending component, so the old screen stays.
- **O1**: city suggest (server function over Open-Meteo's keyless
  geocoder, 10s timeout, zod-parsed) → chip; "Use my location" as a text
  button with breathe / chip / denied line; units as two segmented pairs.
- **Settings**: `/onboarding/settings` becomes U1/N's index; sub-pages
  `/onboarding/settings/units` and `/onboarding/settings/sharing`, each
  its own small form; rows with no destination yet are absent.
- **Safety**: W1 from an entry has no block toggle, ✕ discards; W2 empty
  line; Unblock through `useControlAction` (`STILL BLOCKED`, row leaves on
  success); W3's two new lines and tap-to-undo.
- **K**: meter + the two ruled sentences, derived from
  `CALL_VERDICT_THRESHOLD`; the panel width at desk.
- **Folds**: expanded fold ends in "Fewer"; P2.5 with nothing to name is
  skipped.

## Contract touches

- Schema changes: **none**. Bindings/queues/crons: **none** (the
  geocoder is a keyless outbound fetch).
- New routes: `onboarding/settings.units.tsx`, `onboarding/settings.sharing.tsx`.
- Screens: Au1–Au7, Au2 1040, landing bar 720/1040, X1–X3, O1, U1/N, W1,
  W2, W3, K, P2.5, O3 fold.

## Test plan

- dom: auth page (every Au state), google button, system states, landing
  bar, slow-route label, calibrate form (suggest, locate outcomes,
  segments), settings index + sub-forms, W1/W2/W3, K, folds.
- worker: credentials error mapping, city search parse/timeout, sign-in
  search schema, route decisions.
- e2e conformance: `auth-*` (Au1–Au7, landing bar), `system-*` (X1–X3,
  settings index). Demos: auth, onboarding, safety, signed-out shell.

## Open questions

- The session-expiry _carry_ (Au7) needs `ui/use-form-submit` to route
  `kind: "session"` to sign-in with the payload — outside this lane; the
  sign-in half is built here.
- Au4/Au6 draw a band with no button and the primary relabelled; the
  shared `FailureBand` always carries its own Try again, and `SubmitButton`
  is always pink where Au draws ink. Using the primitives as they are.
- K's ruling says five verdicts; `CALL_VERDICT_THRESHOLD` is 15.
