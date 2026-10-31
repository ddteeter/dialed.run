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

- **Every signed-in form passes `carry`** (D-151): run forms `run`,
  the garment form `garment`, settings forms `settings`, and every other
  signed-in form `page`, which the notice says as "back where you were".
  `HandleForm` takes the noun as a prop, because it is both O0 (`page`)
  and Settings › Username (`settings`). Signed-out forms (log-in, sign-up,
  forgot and reset password, request access, unsubscribe, `/takedown` and
  its confirm) pass none.
- Au7's notice: "Log in and you're back on your {noun}." or "Log in and
  you're back where you were.", then "What you typed wasn't kept." Nothing
  is restored.

## Contract touches

- Schema: **none**. Bindings/queues/crons: **none**. Routes: none new.
- `signedInQuery`'s result gains `email`.
- Screens: Au7. The notice's second sentence, and its generic variant,
  differ from the board: design-deltas item 93.
- `carriedFormSchema` gains `page`.

## Test plan

- ui: `session-lapse.dom.test.tsx` — a carried form's lapsed save lands on
  log-in with `redirect` and `carried`, the email stored, no band; without
  `carry`, and without the provider, the band.
- ui: `carried-email` write/read (refused storage, a non-email dropped).
- Existing `auth-page.dom.test.tsx` and `system-state.dom.test.tsx` stay
  green with the moved key and nouns.
- ui: the notice for each noun and for `page` (`auth-page.dom.test.tsx`);
  `manual-run-form.dom.test.tsx` drives a lapsed save through the real
  root answer to log-in; every other form's test reads the noun it hands
  `useFormSubmit` (`test/ui/carry-spy.ts`), and the signed-out forms'
  read none.
- e2e: Au7's conformance spec allows the one sentence D-151 changes; the
  auth demo records a lapse mid-form, log-in, and the return.

## Open questions

Both answered by the owner, 2026-10-31 (D-151):

1. **Restore the form, or change the notice?** Change the notice, the
   D-96 / D-102 shape: carry the route and the email, and say "What you
   typed wasn't kept." Restoring would need each form to hand its values
   to the carry and take them back (forms in `runs`, `closet`,
   `onboarding`, `account`), a rule for a photo mid-upload, and the
   runner's typed text (notes) in session storage.
2. **Which forms carry, and with which noun?** Every signed-in form. Run,
   garment and settings forms keep the board's nouns; the rest say "back
   where you were" rather than a noun invented per form.
