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
   `enqueueForReview` (safety/review) gains an optional `onlyIf`: given, the
   insert is an `INSERT … SELECT … WHERE onlyIf`, as `notificationInsertWhere`
   is. The verdict's review row and its "hidden" notice take the same
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
`test/before-next-batch.ts`: it runs a write against the local D1 just
before the code under test sends its next batch, which is exactly the gap
the bugs live in.

## Contract touches

- Schema changes needed: **none**
- New route files: none
- New bindings/queues/crons: **none**
- Screens: none (Desk rows and notices only)

## Test plan

All worker vitest (they need D1):

- `test/safety/screening.test.ts`: a flag, and a review-band verdict, on a
  photo deleted before the batch open no Review row and raise no notice;
  a garment photo removed likewise.
- `test/safety/stuck.test.ts` (or the existing escalation suite): a photo
  deleted, or screened, before the escalation batch opens no row; the rest
  of the list still escalates.
- `test/weather/attach.test.ts`: a run retimed while its hours were fetched
  stays `pending`; an unretimed run still attaches.
- `test/runs/consumer.test.ts`: two reminders for one unpaired run — the one
  whose pairing lost writes its reminder; the winner still pairs.

## Unsure items triaged

Filled in from the lane's read of the audit's non-security unsure items:
see the table below (added before the PR).

## Issues

- Closes: #1086 #1087 #1088 #1089
- Opens: listed under the triage table.

## Open questions

None. Guess I am proceeding on: holding the weather copy as it is (see 3).
