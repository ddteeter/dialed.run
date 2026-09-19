# Task 110 — The Desk (operator surfaces, after 106)

## Goal

Build the admin section design drew in round 8 (`Operator Screens.dc.html`).
Lane 106 shipped the mechanics and a placeholder screen; this makes the
operator surfaces the thing the artboards describe.

**This is not a prerequisite for the launch gate.** 106 satisfies the gate:
reports are filed, thresholds hide, a reviewer can see a reported photo and
decide, bans work, the digest counts. What is missing is a designed place to
do it from, and three surfaces that exist as mechanics with no screen.

## The decision this lane implements

Design's, round 8, and it settled the question 106 could not: **dialed.run
has an admin section.** One route, `/desk`, behind the existing admin check,
with its own shell. Never linked from the runner app — an operator knows the
address. Always dark whatever the operator's own theme, "because it's a tool,
not the product", with hi-viz as its only accent and pink left to the runner
app. Desktop-first; nobody moderates from a phone on purpose.

**Three destinations, not four**, which is a better decomposition than the
one 106's design doc proposed: Today, Review, Duplicates, Runners. Banning is
not a destination — it is something you do to a runner, so it lives on the
runner's page. The digest is not a destination either — it _is_ Today, and
the email is Today sent to you.

## Scope

1. **D0 · The shell.** `/desk` with a left rail (Today / Review / Duplicates
   / Runners), the DESK wordmark, operator identity and sign-out. Always
   dark, hi-viz accent, desktop-first. Behind `requireAdmin`.

2. **D1 · Review.** Replaces `/safety/review`. What 106 already has —
   reported photo, reasons in the reporters' own sentences, distinct-reporter
   count — plus what it does not:
   - **One row per reported _thing_, never per photo.** A reported photo
     shows large with a hi-viz frame and its siblings small for context; a
     reported entry shows all photos at one size.
   - **The Remove button names its own scope** ("Remove this photo" /
     "Remove this entry") so the operator never infers it.
   - **Decided rows stay**, collapsed in place to one struck-through line —
     what it was, the decision, the time, who — until the day rolls over,
     with **Undo live the whole time**. "A decision you can't see is a
     decision you can't check." This is a real behaviour change: today a
     decided row vanishes and `resolveReview` refuses a second decision on
     the same row.
   - **Who reported, behind a fold, and opening the fold is logged.**
     Coordinated reporting is itself a moderation case. The promise to the
     reporter is that the _author_ never learns — not that the reviewer
     cannot see.
   - **Screener-sourced rows** read "0 PEOPLE · HIDDEN UNTIL YOU LOOK". The
     row type exists in the schema and nothing writes it yet (see Open
     questions).

3. **D2 · Duplicates.** The read-only report 106 built, drawn as a heading
   and its variants rather than rows and columns: brand, the probable name in
   bold, then how many pieces hide under the wrong one. Sorted by pieces
   affected, with a header count.

4. **D3 · Ban a runner.** A panel at the bottom of a runner's page under
   Runners. One required field whose label is the policy: _"they will read
   this exactly as written"_. One confirmation, not two — the reason IS the
   confirmation. The mechanics exist in `modules/safety/bans.ts`.

5. **D4 · The notice.** The only screen in this lane a runner sees. "Your
   account is closed", not "banned" — not softer, more accurate. The
   operator's reason verbatim, a case number, no button at all, ink on paper
   only, nothing animates, appeal to an address with a stated response time.

6. **D5 · The digest.** An email at 07:00 local **every day including the
   empty ones**, so a missing email is a broken pipeline rather than a quiet
   one. Its body is Today; its one link goes to the Desk.

## What 106 leaves for this lane

- `/safety/review` and `/safety/review-photo/$` move under `/desk`. The photo
  route's rule does not change: admin or 404.
- `pendingReviewQueue` already returns reasons, reporter counts and resolved
  subjects. It does not return _who_ reported, resolved-today rows, or
  anything to undo with.
- `resolveReview` refuses a second decision by design (law 2, claim-then-work).
  Undo needs that relaxed deliberately rather than by accident, and probably
  a `review_queue` column rather than a delete.

## Open questions for the owner

1. ~~**Nothing enqueues a classifier-sourced review row.**~~ **Answered and
   built in 106** (PR #73 review). `screenPhoto` now writes a
   `source: "classifier"` row in the same batch as the verdict and the
   visibility write, so D1's third row has something to render. It queues
   two bands, not one: over `thresholds` the photo is hidden and queued,
   and in the new middle band — at or above `reviewFloors`, below
   `thresholds` — the photo **stays visible** and is queued anyway, so a
   reviewer's agreement or disagreement is the calibration signal the eval
   cannot produce. Garment photos are excluded on purpose (a closet is
   private); that half is D-69.
2. **Opening the "who reported" fold is logged** — logged where? There is no
   audit table. Sentry is for errors. A `review_audit` table is the obvious
   answer and it is a schema change.
3. **Undo's window** is "until the day rolls over". Whose day — the
   operator's local midnight, or 24 hours?

## Test expectations

- `desk-shell.dom.test.tsx` — the rail, the admin gate, sign-out.
- `review-row.dom.test.tsx` — one row per thing; the Remove button's scope
  wording; a decided row collapsing struck-through; Undo restoring it.
- `who-reported.test.ts` — the fold's contents, and that opening it writes
  the audit row.
- `ban-panel.dom.test.tsx` — the required reason, the label, no second
  confirmation.
- `notice.dom.test.tsx` — the reason rendered verbatim, no button, no accent.
- `digest.test.ts` — sent on an empty day.
- Everything joins the ratchet at 100% in the PR that finishes it.

## Demo

`e2e/desk/` is a new feature directory. The journey: a report arrives, the
operator opens the Desk, sees the photo, removes it, and undoes it.

**Before any of that can be recorded, the harness has to be able to be an
admin — and today it cannot.** This is the first thing to do in this lane,
not the last, because every assertion above depends on it and because 106
shipped its whole admin surface with no video for exactly this reason
(D-72, raised twice on PR #73).

`isAdmin` reads one thing, `env.ADMIN_USER_IDS`. Seeding a user row cannot
make an admin — admin-ness is env, not data — and the usual escapes do not
apply: the unit tests reach it with `Reflect.set(env, …)` inside the
workers pool, which cannot touch a live dev server; `@cloudflare/vite-plugin`
(1.54) has no `process.env` → worker-vars passthrough, so Playwright's
`webServer.env` cannot carry it; and `wrangler.jsonc` has no `vars` block at
all. A demo also cannot skip itself when the var is absent, because `.skip`
is forbidden — so this lands green or not at all.

The one place it can be set is `.dev.vars`, and CI already writes one:
`ci.yml`'s e2e job does `echo "BETTER_AUTH_SECRET=ci-only-secret" > .dev.vars`.
So the work is:

1. **Owner, one line** — append `ADMIN_USER_IDS=<the fixed demo id>` to that
   `ci.yml` line. It is a forbidden zone, which is why 106 stopped here.
2. Give the demo account a **deterministic** user id. Today
   `accounts.setup.ts` signs each one up fresh, so there is no id to name in
   advance.
3. Document the same line in `.dev.vars.example` for local runs — the two
   vars this needs are already listed there.

Then `e2e/desk/` can assert the admin gate itself: a signed-in non-admin
gets a 404 from `/safety/review-photo/$`, and the operator does not.
