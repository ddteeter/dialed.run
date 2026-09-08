# Task 109 — Write-atomicity audit (post-merge)

## Goal

Every handler that writes more than once either does it in a single
`db.batch()`, or says why the writes are independent. Every write paired with
a call to something outside D1 goes through an outbox.

## Why this is a task and not a review comment

It was a review comment, twice, on the same PR — and by then three separate
handlers had already been written against a rule that existed and said the
right thing. The rule's phrasing was the problem ("if two or more writes
*must* land together"), and it has been inverted: batch by default, justify
splitting. This task is the sweep that the rewritten rule does not do on its
own.

It waits for the lanes to merge because the interesting cases are the ones
that cross modules, and no lane can see another's write paths.

## You own

- Every handler in `src/modules/**` that performs more than one write
- `docs/deferred.md` (retire the row this task came from)

## Method

Do not grep for `.batch(`. The failures are *absences*, and the shapes that
matter do not look alike textually. Read every function that writes, and for
each one answer two questions.

**1. Does it write more than once?** If so, the writes go in one batch unless
you can state why they are independent — and "they are about different
tables" is not a reason, since a notification and the status change it
announces are always different tables.

Three shapes are almost never independent:

| shape | why it fails invisibly |
| --- | --- |
| write + the notification/log/event recording it | the state changes and nobody is told; a transition guard means the next attempt stays silent too |
| **claim + the work it authorises** | the claim is what stops a retry, so a gap after it loses the work *permanently* rather than repeating it |
| delete + its cleanup | orphans nothing will ever look at again |

**2. Does it write to two systems?** A queue send, an HTTP call, an R2 put —
**and writes that span `DIALED_CORE` and `DIALED_WEATHER`**, which is the case
to look hardest for, because both are D1 and `batch()` looks like it should
cover them. It does not; it is per-database.

Then pick the answer (CLAUDE.md law 8c), and expect **reconciliation** to be
right more often than an outbox:

- if one side already holds durable "not finished" state that something
  re-drives, that is the answer and no new table is needed — `attach.ts` is
  the example, where `runs.weather_status` plus the hourly cron heals a
  half-completed write on its own;
- if there is no such marker, outbox;
- if a failure is visible and the user can retry, neither.

Adding an outbox where a marker already exists makes the code worse. Say
which of the three each site uses, in a comment.

## Known starting points

Fixed already, as reference shapes rather than places to revisit:
`recordRefreshFailure` and `processReminderJob` (batched),
`disconnectStrava` (outbox).

Worth reading first, from a rough scan — confirm rather than assume:

- `modules/feed/entries.ts` — `submitVerdict` batches, but the surrounding
  entry-creation and photo paths were not checked
- `modules/closet/photos.ts` — R2 put plus a row insert
- `modules/runs/imports.ts` — R2 put plus a row insert plus a queue send, the
  three-system case
- `modules/feed/photos.ts` — the same shape on the feed side
- onboarding and profile writes (105), when they exist

## Done when

- Every multi-write handler is batched or carries a comment saying why not.
- Every write-plus-external-call is either an outbox or has a comment
  explaining why a visible failure is acceptable there.
- A test per outbox proving the row survives a dispatch failure — that is the
  case the pattern exists for, and the one nothing else would catch.
- `npm run verify && npm test` green.

## Out of scope

- Read paths.
- Making individual writes idempotent — that is task 108, and the two
  overlap: a batched write that is also idempotent is the goal, but they are
  separate properties and separate sweeps.
