# Design: 163 Au7, the session-expiry carry (sending half)

## Problem

Design 124 built Au7's arrival (`/auth/login?carried=…`: the ink notice,
the prefilled email, focus on Password, the return to `redirect`), but
nothing sends a runner there. A form whose save is refused for a lapsed
session shows the "Nothing saved. You were signed out." band, and its Try
again is refused again. The Form Contract (`SESSION EXPIRED`: _"route to
sign-in carrying the payload, return to the filled form"_), product.md §4
and the Auth board (_"After Log in, the runner lands on the filled form
they left, and nothing re-submits on its own"_; the notice _"What you
entered is kept."_) all promise more than the route: the form's contents
come back.

## Approach

- `lib/carried-form.ts`: the notice's nouns (`run`, `garment`, `settings`)
  move here from `modules/auth/sign-in-search`, because `ui/` must name
  them and may not import a module.
- `lib/browser/carried-email.ts`: `CARRIED_EMAIL_KEY` with both halves,
  the write and the parsed read, in one file. `modules/auth/carried-email`
  keeps the hook.
- `signedInQuery` also returns the runner's `email`: once the session has
  lapsed the server cannot say who it was, so the client has to have kept
  it. The root's loader data already rides in every signed-in page.
- `ui/session-lapse.tsx`: a root-provided answer, the pattern of
  `ui/terms-refusal` (no router inside `useFormSubmit`). It writes the
  email to session storage and navigates to `/auth/login` with
  `redirect` (from `returnPathOf`) and `carried`.
- `useFormSubmit({ carry })`: a form that names its noun has a `session`
  failure answered by the root — no band, nothing announced, as for the
  terms refusal. A form without `carry`, or with no provider above it (a
  test), keeps the band.

**No form passes `carry` yet**, so nothing a runner sees changes in this PR.
Turning a form on is one line, but it would make the notice's _"What you
entered is kept."_ untrue: restoring the contents is not built (open
question 1).

## Contract touches

- Schema: **none**. Bindings/queues/crons: **none**. Routes: none new.
- `signedInQuery`'s result gains `email`.
- Screens: Au7 (sending half). No new copy.

## Test plan

- ui: `session-lapse.dom.test.tsx` — a carried form's lapsed save lands on
  log-in with `redirect` and `carried`, the email stored, no band; without
  `carry`, and without the provider, the band.
- ui: `carried-email` write/read (refused storage, a non-email dropped).
- Existing `auth-page.dom.test.tsx` and `system-state.dom.test.tsx` stay
  green with the moved key and nouns.

## Open questions

1. **Restore the form, or change the notice?** Restoring needs each form to
   hand its values to the carry and take them back (forms in `runs`,
   `closet`, `onboarding`, `account`), a rule for a photo mid-upload, and
   the runner's typed text (notes) in session storage. The owner declined
   the same restore for the terms refusal (D-96 / D-102, round 29) and
   chose a line saying what was not kept. Recommendation: the D-102 shape —
   carry the route and the email, and the notice says the entry was not
   kept (owner's wording).
2. Which forms carry, and with which noun? The board names three.
