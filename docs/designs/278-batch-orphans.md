# Design: 278 batch orphans (wave 19, lane F2)

## Problem

Four D1 batches make a decision before the batch and then write as though it
still holds. When the world moves in between, a guarded statement misses
quietly and its unguarded neighbours still land: an orphan Desk row, a
retimed run marked settled for hours nobody fetched, or a Strava reminder
claimed with nothing written. None of them is a security issue; all four
are correctness bugs a runner or an operator would see.

## Approach

The fix shape, by preference: fold the condition into the dependent
statement's own `WHERE`, so the batch is right whichever way the race goes.

1. **#1086, `safety/screening/screening.ts` (verdict on a deleted photo).**
   `enqueueForReview` (safety/review) gains an optional `onlyIf`, and its
   insert is now an `INSERT … SELECT … WHERE onlyIf` (true unless given), as
   `notificationInsertWhere` is, built by a new `src/lib/sql/row-where.ts`
   that reads the select's columns from the table. The verdict's review row and its "hidden" notice take the same
   "photo still exists" condition the screening insert already has, written
   once (`photoStillThere`).
2. **#1087, `safety/screening/stuck.ts` (escalation after a long pass).** Each
   escalation's `onlyIf` is "the photo exists and is still pending" (entry
   `screen_status`, garment `visibility` with a photo).
3. **#1088, `weather/attach.ts` (`setStatus`).** `resolveAndAttach`'s closing
   status write is held to the `started_at` and `duration_s` it fetched
   hours for. A retimed run stays `pending`, so the hourly cron settles it
   for its real hours. The copy (`run_conditions`) and the Gave-up clear in
   the same batch stay as they are: the copy is read from the run as it is
   now, and the cron clears a pending run's half before re-attaching it
   (`retryPendingWeather`), so nothing wrong outlives the next pass.
4. **#1089, `runs/consumer.ts` (reminder pairing).** The claim on the event is
   an `INSERT … SELECT` that lands only when the run is paired at this
   event's time, after `pairRunWith` in the batch. When it did not land,
   another reminder paired the run first: the job decides again from fresh
   reads (it finds another unpaired run or writes the reminder). Two events
   for one runner with the same `event_time` would still collapse; Strava
   times are seconds apart in practice, and that is recorded here as a
   known limit.

Tests drive the interleaving with one shared worker helper,
`test/before-write-batch.ts`: it runs a write against the local D1 just
before the code under test sends its next batch that writes, which is
exactly the gap the bugs live in.

## Contract touches

- Schema changes needed: **none**
- New route files: none
- New bindings/queues/crons: **none**
- Screens: none (Desk rows and notices only)

## Test plan

All worker vitest (they need D1):

- `test/lib/row-where.test.ts`: given values, plain, SQL and computed
  defaults, a generated column, and a condition that does not hold.
- `test/safety/screening.test.ts`: a flag, and a review-band verdict, on a
  photo deleted before the batch open no Review row and raise no notice;
  a garment photo removed likewise.
- `test/safety/stuck-photos.test.ts`: a photo
  deleted, or screened, before the escalation batch opens no row; the rest
  of the list still escalates.
- `test/weather/attach.test.ts`: a run retimed while its hours were fetched
  stays `pending`; an unretimed run still attaches.
- `test/runs/reminder-match.test.ts`: two reminders for one unpaired run — the one
  whose pairing lost writes its reminder; the winner still pairs.

## Unsure items triaged

The audit's other non-security unsure items, re-read against the code. The
dead-letter paths through `src/db/gave-up.ts` are B12's.

| site                                                       | verdict                                                                                                                                                                                                           |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runs/consumer.ts:415`, two imports insert two runs        | fix, #1090                                                                                                                                                                                                        |
| `feed/entries/entries.ts:217`, attach beside a delete      | fix (low), #1091                                                                                                                                                                                                  |
| `ops/daily/digest-email.ts:156`, two digests               | fix (low), #1092                                                                                                                                                                                                  |
| `account/handles/handle-rescreen.ts:170`, re-opened review | fix (low), #1093                                                                                                                                                                                                  |
| `runs/strava/deauthorize.ts:113`, notice after a reconnect | fix (low), #1094                                                                                                                                                                                                  |
| `feed/entries/photos.ts:316`                               | safe: the insert's `returning` decides the second batch, which takes back the review row and the notice by the fresh id. Only a Worker dying between the two batches leaves them, naming a photo no one can reach |
| `weather/attach.ts:473`, tries counted twice               | safe: only the Gave up row's count is wrong; a failed run is never a candidate again, so it cannot grow                                                                                                           |

## Follow-ups (PR 2, after #1129)

The five fixes the triage filed, and `guarded()` (design 277 §2, #1130) at
this design's own sites where it fits (#1101). Each guard is the
dependent write itself; a miss rolls the batch back and the caller decides
what the miss means.

| issue | site                                  | fix                                                                                                                                | a miss means                                                                                 |
| ----- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| #1090 | `runs/consumer.ts` `saveDraft`        | the run is `INSERT … SELECT … WHERE NOT EXISTS` a run in the duplicate window (`duplicateRunWhere`), guarded                       | another import saved the activity first: decide again, which ends a `duplicate`              |
| #1091 | `feed/entries/entries.ts` `attachKit` | the entry is held to its run and guarded; kit rows are selected from the garments still in the closet                              | the run was deleted: `run not found`, nothing written. A deleted garment is left off the kit |
| #1092 | `ops/daily/digest-email.ts`           | the day's mark is a claim (`claimDayStatement`: upsert only while the mark is before today's UTC midnight), guarded                | another firing owed the day: nothing written, nothing sent                                   |
| #1093 | `account/handles/handle-rescreen.ts`  | the flagged settle is guarded, and replaces the read before the batch                                                              | the handle changed since the claim: no review row is opened or re-opened                     |
| #1094 | `runs/strava/deauthorize.ts`          | the revocation is selected from the row the delete removes (`revocationOf`, moved here from `oauth.ts`), and the delete is guarded | the runner reconnected since the read: no notice, email or revocation                        |
| #1101 | `runs/consumer.ts` reminder pairing   | the pairing is guarded; the folded claim (`claimWhere`, `runPairedAt`) goes                                                        | another reminder paired the run: decide again                                                |

**Left as they are (#1101).** The screening verdict, the stuck escalation
and the weather status write fold their condition into the dependent
statement, and a miss there is correct with nothing to report. Strava's
connect and disconnect revocations are selected from the row the batch
removes, and nothing there can miss. The garment version hold refuses only
a changed photo; `guarded()` on an update of the garment would also refuse
a garment its owner deleted, which today lands the whole takedown, so it
stays a NOT NULL hold. F1's sites are F1's.

**Tests.** Each issue gets a worker test that lands the other write just
before the batch (`beforeNextWriteBatch`) and fails on main. The
idempotency test that forced a failed kit with a repeated garment now uses
a trigger, because a repeated garment is now one kit row.

## Issues

- Closes: #1086 #1087 #1088 #1089
- Opens: #1090 #1091 #1092 #1093 #1094.
- PR 2 closes: #1090 #1091 #1092 #1093 #1094, and addresses #1101 (F2's half).

## Open questions

None. Guess I am proceeding on: holding the weather copy as it is (see 3).
