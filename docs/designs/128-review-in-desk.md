# Design: 128 Review moves into the Desk (R-173)

> Hard cap: one page (~60 lines). If you exceed it, cut. The reviewer reads
> this on a phone. Diagrams count as clarity, not length.

## Problem

D-35 says the Desk is always dark, and D-87 makes Review one of its five
destinations. But Review was built (task 106) before the Desk, at
`/safety/review`, and never moved: it renders on the runner app's light
ground, with no rail and no `data-ground="ink"`. Task 128's packet owns
`src/routes/desk/review*.tsx`; the move was never built (R-173, owner,
2026-11-01, a pre-friends launch item).

## Approach

- **`/desk/review`** (`routes/desk/review.tsx`) renders the same six parts
  (ReleaseHolds, RemovalRequests, ReviewQueue, Takedown, CopyrightHolds,
  QuarantineRecords) inside `DeskShell current="review"`, as Runners and
  Access do. It sits behind `/desk`'s `operatorOrNotFound`, and every
  server function still checks `requireAdmin`.
- **`/safety/review` is deleted**, not redirected (owner, 2026-11-03):
  nothing has launched, so no bookmark or sent email points at it.
- **The photos move too** (owner, 2026-11-02): `/safety/review-photo/$`
  becomes `/desk/review-photo/$`, unchanged inside (`reviewerPhotoResponse`
  is still the gate, not `/desk`'s `beforeLoad`, which is for pages). The old address is deleted, not redirected: only Review's
  own `<img>` tags use it, and nothing has launched. The prefix is written
  once, `reviewPhotoSrc` in `modules/safety/components`, instead of in
  three components.
- **The rail** links Review to `/desk/review`; the "until 128 moves it"
  note goes. The four "Open Review" emails link `/desk/review`.
- **The ink ground**: every part is checked on the Desk in the browser, and
  a class that only reads on chalk (a tint, a hairline, hi-viz text) is
  fixed in place. **Found:** every pink button read chalk on pink.
  `SubmitButton` (`ui/form.tsx`) and the copyright hold's presses set
  `text-ink` on `bg-action`, and inside `data-ground="ink"` `--ink` is
  chalk. Both now take `text-accent-ink`, the fixed ink `tokens.css` names
  for text on an accent. That also clears the two contrast findings the
  a11y baseline carried for Runners and Access. Tints, hairlines and
  hi-viz text raised nothing.

- **Round 44** (design deltas 104–106, 2026-11-03): the Desk's main
  button is a chalk pill, first in its bar; Review's other decisions are
  outline pills and Cancel underlined text; the heading reads "Review"
  with `[N WAITING · M DECIDED TODAY]`, from Today's counts.

- **One bar per decision** (2026-11-04): every board draws a Desk's
  buttons side by side in one wrapping row, chalk pill first, then
  outline pills, then Cancel, and the build had stacked three groups (a
  takedown request's Take it down, Decline and Block and decline all;
  Block's answer and Cancel; a copyright hold's answer, under Not yet).
  `DeskForm` now draws that row (`ACTION_BAR`) with the submit first and
  `also` after it. Block's question takes the row's place, as round 37
  draws it. Decline's reason opening under the row is undrawn (design
  delta 107).

## Behaviour change

`/safety/review` sent a signed-out visitor to sign in. `/desk/*` answers
not-found to anyone who is not an operator, signed out included (D-35:
the Desk is never linked, and a refusal would confirm it exists). So an
operator who opens an "Open Review" email while signed out sees a 404 and
has to sign in first. Accepted in the plan (owner, 2026-11-02).

## Contract touches

- Schema changes needed: **none**
- New route files: `src/routes/desk/review.tsx`,
  `src/routes/desk/review-photo.$.tsx`; `src/routes/safety/review.tsx`
  and `src/routes/safety/review-photo.$.tsx` are deleted.
- New bindings/queues/crons: **none**
- Screens: Operator Screens D0's rail and Review on the ink ground.

## Test plan

- ui: `desk-shell.dom.test.tsx` — the rail links Review to `/desk/review`.
- ui: the review parts' `src` assertions name `/desk/review-photo/`.
- worker: `verification-class.test.ts` names the moved GET.
- worker: `email/render.test.ts` — the buttons link `/desk/review`.
- e2e: the three demos that open Review go to `/desk/review`; the a11y
  baseline's Review rows follow the route.
- demo: `e2e/desk/review-in-desk.demo.spec.ts` — an operator follows the
  old address, lands on the dark Review with the rail, and decides a row.

## Open questions

None.
