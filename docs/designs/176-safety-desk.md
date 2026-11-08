# Design: 176 safety-and-desk

> Wave 2 lane 176. Items from the Plan vs. Build survey (2026-11-05),
> re-read on main at 7a160a1a. Decisions D-161, D-162 (owner, 2026-11-06).

## Problem

Automatic holds hide a runner's photo without telling them (design 152,
D-162). An upheld intimate-image takedown leaves no trace on the poster's
account for an operator (R-147(1), D-161). "Intimate" is worded more widely
than the TAKE IT DOWN Act's line (R-147(2), D-161). D8 Runners lacks the
board's `PENDING DELETE` state (PR#126-1). Desk Today's ban count scans
`user_profiles` (PR#112-1).

## Approach

1. **Hold notice (D-162).** `safety/notices.ts` gains a screening notice:
   kind `content_hidden`, the same as a report's hide, re-raised. The words
   say "automatic screening" (pending the owner's wording). Sent from:
   - the classifier's `flag` in `screenPhoto`, in its one batch. The author
     is read first, only while the photo is still `pending`, so a photo a
     report already hid is not told twice;
   - the fingerprint hold in `feed/photos.ts` `wasStoredHeld`, by the
     uploader's id. The row is inserted in the same batch, so there is
     nothing to read.
   - **Not** for a garment photo (`closet/photos.ts`, classifier `garment`
     scope): only its owner ever sees it, so a hold restricts nothing.
   - **Not** for suspected CSAM: a quarantine sends nothing, as today.
   - **Approve** of a held photo (a classifier or fingerprint row whose photo
     is `hidden_pending_review`) sends the "left it up" notice, which the
     hide notice promises. `decisionNotices` in `review.ts` decides this.
2. **Desk flag (D-161 1).** Derived from what is already recorded. An
   account is flagged when a `moderation_actions` row with reason
   `intimate` and action `remove`/`takedown` has it as `subject_owner_id`,
   and no later operator decision on the profile (`ban`, `unban`, or a new
   `review` action, "Keep account") exists. It reads the
   `moderation_actions_owner` index. D8 shows a flag on the row and a
   `Flagged` filter. The right column offers Keep account next to Close
   account. No automatic ban.
3. **Statutory line (D-161 2).** The words only, all owner-approved first:
   the report reason label, `/takedown`'s intro, the Review row's intimate
   line, the Decline question and the declined email. Also a courtesy
   removal reason mapped to the existing `othersPhotos` rule, if the owner wants
   one (the open question below).
4. **PENDING DELETE (PR#126-1).** `RunnerState` gains `PENDING DELETE`,
   derived from an `account_deletions` row. `CLOSED` wins when both hold.
5. **Index (PR#112-1).** Additive migration
   `0079_add_user_profiles_banned_at_index` (`user_profiles_banned_at`).

## Contract touches

- Schema: **one additive index** (item 5). `moderation_actions.action` and
  `review_queue.source` are text enums with no CHECK, so adding `review`
  is TypeScript only. That still changes what `docs/contracts.md` lists for
  `moderation_actions`, which is why it is a question for the owner.
- Files outside `safety/`: `feed/photos.ts` (fingerprint hold notice),
  `ops/desk.ts` (comment only), `routes/desk/` runners loader if the
  filter needs it. The coordinator is told about the `feed/` touch because
  of the feed-cleanup lane.
- Bindings, queues, crons: **none**.
- Screens: D8 Runners (state, flag, filter, Keep), Review row (intimate
  line), W1 report sheet, `/takedown`, the bell row.

## Test plan

- worker: `screenPhoto` flag raises one `content_hidden` row for the
  author; pass/review raise none; a photo already hidden by a report is not
  re-told; a fingerprint hold raises one; a garment hold raises none.
- worker: Approve of a held photo raises the kept notice; Approve of a
  `review`-band row does not.
- worker: the flag derivation (an intimate Remove flags it; a non-intimate
  one does not; a later Keep/ban clears it; a later intimate Remove
  re-flags it). Also the `Flagged` filter SQL.
- worker: `deskRunners` state ACTIVE / PENDING DELETE / CLOSED, CLOSED
  winning.
- ui: DeskRunners renders the state, the flag and Keep account.
- migration chain test covers 0079. e2e: the Desk transcripts are
  regenerated.

## Owner answers (2026-11-06)

1. Hold notice: "Our automatic screening flagged a photo on your run…"; kept:
   "We reviewed the flagged photo on your run and left it up." Terms gain
   "When reports or our automatic screening hide…". **Built differently:**
   no version bump. Version 1 is unpublished and nobody has accepted it,
   so it is edited in place.
2. Runner-facing "intimate" labels stay (report reason, `/takedown`). The
   statutory line is stated on the Review row, the Decline hint and a new
   line in the declined email (pointing to desk@ for an ordinary report).
3. Add a courtesy Remove reason under the `othersPhotos` rule: "it shows
   someone who didn't agree to it".
4. Flag on D8 Runners: FLAGGED mark, Flagged filter, Keep account, cleared by
   Keep, a ban or an unban; Desk Today counts flagged accounts. Placeholder
   words until Design rules (sent to coordinator-2 for the Design batch).

## As built

- Notices: `notices.ts` `screeningNotice` (classifier flag, Approve) and
  `screeningHoldNotice` (fingerprint hold). Tests in
  `test/safety/hold-notices.test.ts`.
- Flag: `safety/account-flags.ts`. Placeholders (design-deltas 139) were
  replaced by round 47 (R47·124–126): Today's fourth number, the Flagged
  (N) chip last, the panel atop D8's column, focus to the name. "See the
  takedown" is dropped: round 48 #132 answered design-deltas 140.
- Coordinator handoff PR#286-1: Today's gave-up bracket is `aria-hidden`.
- Statutory line: `contracts.ts` `STATUTORY_LINE`, drawn by
  `components/StatutoryLine.tsx`.

## Register changes for the coordinator

- design-152 open question 2: answered by D-162 (built here).
- R-147: built here (D-161).
- PR#126-1, PR#112-1, PR#286-1: built here. No register row exists for any
  of them.
