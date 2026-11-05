# Design: 169 Breaker trip record (R-172)

## Problem

`reportBreakerTrips` (`ops/scheduled.ts`) runs in the hourly
`screening-retry` firing. It reads each cause's trailing hour only at that
moment. So a burst that reaches a ceiling across the boundary between two
firings can stay under the ceiling in both readings, and no Sentry event fires.
The holds themselves stay bounded, because the breakers read a sliding hour at
each hold. What can be lost is the alert. R-172 says closing the gap needs a
trip recorded when it happens, either as a row or as a Sentry call from the
upload paths.

## Options

1. **Sentry call at the trip.** The three checks live in `safety`
   (`isHeldAsRemovedCopy`, `isClassifierOver`, `canHideNow`). `ops` already
   imports `safety`, so `safety` can't import `captureException` without an
   import cycle. A `report` callback would have to be threaded through five
   callers: `feed/photos.ts`, `closet/photos.ts`, `fileReport`,
   `reconcileUnhiddenReports` and the screening consumer and retry. Worse, it
   fires on **every** refused hold. In a fingerprint bug that is every upload,
   one event each, spending the Sentry quota at exactly the wrong time. An
   in-isolate dedupe doesn't hold across isolates.
2. **A trip row.** A new `breaker_trips(cause, hour)` with insert-or-ignore,
   one row per cause per hour, written in `safety` next to the check. The cron
   alerts on rows written since its last firing. No threading is needed and
   the writes are bounded. The costs: an additive migration (0077 or later,
   law 11) and a write on the fallback path.
3. **Read the rows that already exist (premise check).** Every hold already
   writes a timestamped row. The cron is asking the wrong question ("is the
   hour ending now at the ceiling?"). The right question is "did any sliding
   hour ending since the last firing reach it?" Both can be answered from the
   same rows:
   - fingerprint and reports: `review_queue.opened_at`, through the existing
     `(source, opened_at)` index. A window function
     (`opened_at - lag(opened_at, ceiling - 1) <= 3600`) finds `ceiling` holds
     inside one hour.
   - classifier: a `held_back` screening _is_ the trip record (D-157). Any
     `held_back` row since the last firing means the breaker refused a flag.

**Pick: 3. Between the two R-172 named, 2 beats 1.** Option 3 needs no
schema, no new binding and no change on the upload paths. Only the cron's
read changes. The scan covers the last two hours, and the overlap is harmless
because the Sentry fingerprint `["breaker", cause, day]` already dedupes. The
live point read stays for Today's line.

**What 3 gives up.** `enqueueForReview` re-stamps `opened_at` when it
reopens a row, so a subject held twice in the window counts once after the
fact. The live breaker read counts it the same way, so the alert and the
breaker still agree. Reports' ceiling is read once per scan, not per hold. It
is the 10/h floor until the 28-day baseline grows past 2.5/h, so the two
differ only once there is real traffic.

## Contract touches

- Schema: **none** (option 3). Option 2 would add one additive table.
- New routes, bindings, queues or crons: **none**. Screens: none.

## Test plan (worker)

- A burst of 5 fingerprint holds spanning the top of the hour (3 before,
  2 after, all within 60 min) alerts. Today's point read misses it.
- 5 holds spread over 61 minutes don't alert. 4 inside the hour don't alert.
- Reports at floor − 1 and at the floor, split across the boundary. Profile
  reports aren't counted (`reportSubjectsThatHide`).
- A `held_back` screening in the last two hours alerts the classifier once.
  An older one doesn't.
- Two firings an hour apart over one burst still produce one issue a day.
- Remove R-172 from `docs/deferred.md`, and fix the stale "weekly headroom"
  comment above `reportBreakerTrips`.

## Open questions

- **Option 3 chosen** (owner, 2026-11-02). After a reopen, a subject held
  twice in the window counts once. That is accepted, since the live breaker
  counts it the same way.
- **As built.** `tripsSince(db, from, now)` in `safety/breakers.ts` takes
  the busiest sliding hour of each cause's Review rows. For the classifier
  it replays the reading at the last `held_back` flag: the hour up to it,
  with nothing screened after it. With no `held_back` flag it uses the
  reading now. The reports' ceiling comes from the baseline before the
  look, so a busy hour inside the look doesn't raise it, which errs toward
  alerting. The event line now says "reached N of C within an hour" rather
  than "in the last hour", because the hour may not be the last one.
