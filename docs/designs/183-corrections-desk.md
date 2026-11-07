# Design: 183 corrections-desk

> Wave 3 lane 183, on main at 5d59a771 (after #480). Decisions D-163,
> D-164, D-168; rulings R48·129–131 (`docs/design-deltas.md`, round 48).

## Problem

A runner who sees a wrong fact on a shared product has nowhere to say so
(R-74). Opening a review's reporters is promised to be logged and is not,
and the fold itself was never built (R-66). Follows ring nothing (R48·131).
And the moderation thresholds are read from source rather than config.

## Approach

1. **Corrections (D-163, R48·129–130).** `products/corrections.ts`:
   - `fileCorrection` (verified gate, idempotent): one waiting row per
     runner + product + field; a second while waiting replaces it (upsert on
     a partial unique index). Fields and their inputs come from one table
     in `lib/contracts/product-corrections.ts`, which the sheet, the zod
     schema and the apply step all read (derive, don't mirror).
   - `correctionsQueue`: waiting rows grouped by product + field + value,
     with the runner count. `applyCorrection` writes the product's column
     and resolves the group; `declineCorrection` takes an optional reason.
     Each resolves every filer's row and raises their bell row in one batch.
   - UI: `closet/components/CorrectionSheet.tsx` (Report's sheet pattern:
     field, typed input, "How do you know?", receipt in place, the
     "You sent …" line when one waits) behind §AG's WRONG? › on
     `GarmentDetail`. Desk: `safety/components/DeskCorrections.tsx` and
     `src/routes/desk/corrections.tsx`; the rail gains Corrections after
     Review, with its count in D1's style.
2. **Who reported (D-164).** Each review row with reporters gets the WHO
   REPORTED ▸ disclosure ("Folded. Opening it is logged. Never shown to the
   author."). Opening it calls `reportersFor(reviewId)`, which writes a
   `review_audit` row and reads the reporters in **one batch**: the names
   cannot be read without the audit row. The list (handle, reason, when) is
   undrawn: placeholder protocol, design-ask filed.
3. **Follow notifications (D-168, R48·131).** `feed/follows.ts` `follow`
   calls `notifications/follow-notices.ts` after the insert (law 5: a
   failure never fails the follow). Nothing if either runner blocked the
   other, or if `follow_notices` says this follower rang in the last 30
   days. Otherwise: no unread follow row → insert "@ada followed you.";
   one unread → update it to "@ada and N others followed you.". The bell
   row gets a link: one follower → their profile; a group → your own
   profile (guess: no followers list exists; design-ask filed). Correction
   outcomes link to the filer's garment.
4. **Moderation thresholds read from config.** `safety/thresholds.ts`
   parses a new secret, `MODERATION_THRESHOLDS`, through zod. Unset or
   malformed, it fails closed and tells Sentry. Values live in the private
   home; tests use invented ones. Behaviour is unchanged once it is set.

## Contract touches

- Schema (additive, core 0081+; renumber on rebase after dark-theme's 0080):
  `product_corrections`, `review_audit`, `follow_notices`, and a nullable
  `notifications.link_id` (what the row opens when it is not its subject).
  Notification kinds `correction_applied`, `correction_declined`,
  `followed`. Account purge covers the new user-keyed tables.
- Routes: `src/routes/desk/corrections.tsx`. Bindings/queues/crons: none.
  New secret `MODERATION_THRESHOLDS`: deploy checklists and
  `.dev.vars.example` only, never set here.
- Screens: §AG WRONG? sheet, Desk Corrections (D-rail), D1 who-reported
  fold, S2 follow rows. `docs/architecture.md` and `docs/contracts.md`
  updated.

## Test plan

- worker: `product-corrections.test.ts` (file, replace, verified gate,
  group, apply per field, decline, bell rows, name collision refused);
  `review-audit.test.ts` (one batch, audit row, operator gate);
  `follow-notices.test.ts` (single, group, read starts a new row, 30 days,
  blocked, self); `moderation-thresholds.test.ts` (parse, fail closed);
  purge rows; verification-class rows for the new server fns.
- ui: `correction-sheet.dom.test.tsx`, `desk-corrections.dom.test.tsx`,
  `who-reported.dom.test.tsx`, notification links in the list test.
- e2e: a demo of WRONG? → Desk Apply → the bell row.

## Issues

- Closes: #358, #387, #410, and the thresholds item (the Project draft).
- Opens: design-asks #497 (the fold open), #498 (a grouped follow row's
  link), #499 (WRONG? with no composition); owner question #500 (the bell
  rows' field words, and who Apply tells).

## Open questions

- Guess: a group follow row links to your own profile until a followers
  list exists.
- Guess: Apply on a name that collides with another product of the brand is
  refused with a line, not merged (no Merge, R48·130).
- Found on the board after this doc: the sheet quotes the current value
  ("It says Mid."), and Decline takes one of three fixed reasons. Built so.
- The fixed 48-hour clock is its own list (`reasonsOnTheClock`), so failing
  closed on a missing config never starts it for other reasons.
