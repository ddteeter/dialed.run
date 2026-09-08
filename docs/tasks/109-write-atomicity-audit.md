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

**2. Does it write *and* call something outside D1?** A queue send, an HTTP
call, an R2 put. Those are never atomic together. If the external call is the
point of the write — a revocation, a webhook we owe someone, an email —
it needs the outbox shape: intent written in the same batch as the state
change, dispatch separate, row deleted on confirmation, and something
scheduled re-dispatching what dispatch drops.

Not every pairing needs it. An R2 put whose failure simply fails the user's
upload is fine — the user sees it and retries. The test is whether a failure
between the two leaves the systems disagreeing *with nobody able to tell*.

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
