# Design: 150 The 3-year retention sweep (C7, D-131)

## Problem

D-131 keeps takedown requests, reports and moderation-decision records for
3 years after the decision, then sweeps them. Nothing deletes any of them
today, so the privacy policy's rows say "Until we delete them" and "Kept".
C7 makes the 3 years true.

## Approach

`safety/retention.ts` `sweepModerationRecords(db, now)`: one batch of five
deletes, run daily in `ops`' `runDailyDigest` beside the other sweeps
(`safety` is already imported there; no new cron, no `DailyUpkeep` field).
The cutoff is `now − 1096 days` (3 × 365 + 1), so no row goes before three
calendar years have passed, leap day included. Each row's clock is its
**decision**, and a row exactly on the line is kept:

1. **`takedown_requests`**: `resolved_at` (set only by Remove or Decline).
   A pending request has none and is never swept.
2. **`reports`**: the later of the report's filing and its subject's review
   decision (`review_queue.resolved_at`). A report whose subject has an
   open review (pending or reviewing: `resolved_at` NULL) is kept. A report
   that never reached a person (under the threshold) runs from its filing.
3. **`review_queue`** (the record of an Approve, which writes no audit
   row): `resolved_at`, and only once **no report** is left on the subject.
   Otherwise `reconcileUnhiddenReports` would find three reports with no
   queue row and hide the subject again. Statement 2 goes first, so they
   usually go together.
4. **`copyright_holds`**: `settled_at`, and only when `status` is
   `restored` or `purged`. **A live hold is never swept**: `hidden`
   (inside its 30 days, waiting on a counter-notice's restore, or held for
   a court case under D-146) and `purging` (whose `settled_at` is a lease
   stamp, not a decision). A litigation hold has no `settled_at` until
   the Desk ends the case, so its 3 years start then.
5. **`moderation_actions`**: `created_at`, but **not while a hold or a
   quarantine record still names it**: the hold's row reads its notice
   and actor, and the quarantine's names its preserved object. It goes
   with its hold (statement 4 runs first, in the same batch) or after the
   quarantine purge. Quarantine keeps its own `retain_until`; this sweep
   never touches `quarantined_content`.

Re-runnable (law 1): deletes past a fixed line, so a second pass finds
nothing. One batch: statements 3 and 5 read what 2 and 4 left.

**What changes for people, 3 years on.** A strike (`strikesOf`) lapses
when its hold is swept, 3 years after the purge. D-131's reason lists
repeat-infringer history among what 3 years covers. A swept report no
longer hides its kit from the reporter's feed (W1's reporter-scoped
hide). A Block is the lasting tool. A ban outlives its audit row: the
ban itself and its reason live on `user_profiles`. The run's "removed"
band goes with its audit row. Fingerprints (C16, design 146) live on the
photo and the quarantine snapshot, so this sweep does not touch them.

## Contract touches

- Schema (additive): six indexes so no statement scans. `reports(created_at)`,
  `review_queue(resolved_at)`, `takedown_requests(resolved_at)`,
  `moderation_actions(created_at)`, `copyright_holds(status, settled_at)`,
  `quarantined_content(moderation_action_id)`. Migration
  `0066_add_retention_sweep_indexes`.
- Routes, bindings, queues, crons: none. Rides `0 12 * * *`.
- Legal text: the privacy policy's retention rows and the two paragraphs
  that say "until we delete it", and their sources rows. No UI.

## Test plan

Worker (`test/safety/retention.test.ts`): each table at both edges (1096
days kept, 1096 days + 1 s swept); a report kept by an open review and by a
recent decision; a review row kept while a report remains; hidden,
litigation-held and `purging` holds kept however old; an action kept while
its hold or quarantine exists, swept with its hold; re-run is a no-op;
plans read by index. `test/ops/scheduled.test.ts`: the daily firing sweeps.

## Open questions

- Strikes lapsing at 3 years: `/copyright` says "three times" with no
  window. Proceeding on D-131's reasoning and asking the owner whether the
  page should say so.
- `takedown_blocks` (operator blocks on `/takedown`) are live state, not a
  record of a past decision, so they are kept while in force. Not swept.
