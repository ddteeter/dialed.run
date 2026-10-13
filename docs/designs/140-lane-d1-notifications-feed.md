# Design: 140 lane D1 · notifications and feed

> Before-public plan, lane D1 (tasks 127 and 129): STR-9, FEED-3, FEED-9,
> STR-13. One additive migration (STR-9, owner-approved).

## Problem

A run landing on Strava writes a bell row and nothing else: the reminder
email (round 26 #19, D-43) is never owed. 14 routes draw a bell that can
only show a dot, and its name above nine says "9+" where round 27 #25 says
"more than 9". E1's compact line and N's privacy card still carry
pre-round-25 words. Two screens format dates with private `Intl` calls.

## Approach

**STR-9, the reminder email.** `runs/consumer.ts`'s reminder batch gains a
third statement: an `email` outbox row (`emailDebt` → `owe`), held
`notBefore` = landed + 20 min, keyed `run_reminder:{userId}:{local day}`.

- **One a day is a record of what was sent** (owner, 2026-10-12): table
  `reminder_email_days (user_id, day, sent_at)`, UNIQUE on
  `(user_id, day)`, migration `add_reminder_email_days` (additive; no
  rebuild). A table rather than a column: the fact is per runner per day,
  and no existing row has that grain — a column on `notifications` would
  mark one reminder, not the day, and one on `user_profiles` could hold
  only the last day. A reminder owes the email unless today's row exists;
  the email goes only if it still does not, and the row is written in the
  batch that marks the outbox row sent. So a first email skipped by an
  upload leaves the day open, a second debt for a sent day sends nothing,
  and a re-firing drain finds the row. The per-day outbox key still folds
  two reminders landing at once into one row (a second debt takes the row
  over; its payload stays).
- **Redelivery** stops at the event's claim (`processed_webhook_events`),
  read before any branch: the claim always lands with the bell row or the
  pairing, so a redelivery after a pairing cannot write a stale reminder.
- **The next day counts both.** Today's email counts itself plus
  yesterday's reminders still unread that came after yesterday's email went
  (all of yesterday's, if none went). "Yesterday" is the calendar day
  before today in the runner's zone (`previousCalendarDay`), so a 23- or
  25-hour day does not move it. What yesterday's email covered is the
  landing that owed it, not its send: a second reminder that day took the
  row over and left the first payload, so the email never mentioned it.
  The day's row records that landing (its `sent_at` column holds it).
- **Skipped by send time** when no reminder of the runner's from the
  owing landing on is still unread (a matched upload reads its own), the
  runner has disconnected Strava, or the day's email went. Any reminder,
  not the first: an upload for the first run must not silence the email a
  second run that day still owes (PR #187 review).
  **Mark all read also skips it** — the owner kept that (2026-10-12): a
  reminder the runner cleared in the app needs no email.
- **Pruned** with the Strava ids: the daily prune deletes rows older than a
  week (`reminder_email_days_sent`); nothing reads past yesterday.
- **The preference** is the sender's own check (`optionalMail`), at send
  time, as is the confirmed-address rule.
- **The runner's day and clock.** Nothing stores a runner's zone, so the
  consumer takes `runnerZone(userId)`: the zone of their latest run with an
  observed zone (weather DB), UTC when none. A failed lookup is reported
  and owes no email for that landing (the bell row still lands, law 5):
  reckoned in UTC instead, one day could be keyed two ways.
- **No activity data** (D-33): the payload holds a clock label, a count,
  our own ids and the runner's day. No Strava id rides the outbox.

**FEED-3.** `bellStateFn` moves to the terms-exempt gate (it is a read of
the runner's own counts, as `unreadNotificationCountFn` already was), every
bell route loads it and spreads it into `BelledLayout`, and
`unreadNotificationCountFn` is deleted. `verdictsWaiting` becomes required,
so a route that passes only a count no longer compiles. The legal pages
read `bellState` through `account/legal.ts`; settings sub-pages through
`settingsSubPageData`. The bell's _name_ says "more than 9 new"; the drawn
badge keeps "9+".

**FEED-9 (owner, 2026-10-12).** E1's compact line is built from the E2
frame's composition (design deltas item 63): `feed/compact-conditions.ts`
reads the viewer's saved place (profile primary key) and runs the one
consensus there (`entries_audience_created`; the cache's key for the
reading), in the Following feed's loader through `feedConditionsQuery`, which
reads the profile once for both the Conditions tab's home and the line.
A failed conditions read is reported and draws no line (law 5).
Matched only; otherwise no line. **The U2 privacy card is not wired**: its
drawn copy is about the in-app conditions pool, not the published totals
`count_in_totals` governs, so it went back to the owner (premise check).

**STR-13.** `lib/dates` gains the long-weekday and month-year shapes;
`ops/components/Today.tsx` and `closet/retired-label.ts` use them.
`AccountClosed.tsx` is lane C's.

## Contract touches

- Schema: **one additive migration**, `add_reminder_email_days` (owner
  approved 2026-10-12). Outbox `email` payload: optional `reminder` (wire
  format, additive).
- New route files: none. New bindings/queues/crons: **none**.
- Screens: S2a (bell); E1's compact line; Today (D5); C's retired tag.
  N/U2's pool card: not built (question 4).

## Test plan

- worker `test/runs/reminder-email.test.ts`: owed (row, key, 20 min hold,
  payload); same day deduped; redelivered message owes once, also after the
  row was sent; next day counts yesterday's later unread reminders; zone
  day boundary; zone lookup failure → UTC, reported; skipped by upload;
  opted out; unconfirmed; `unlessRead` read/missing/unread.
- ui `belled-layout.dom.test.tsx`/bell: "more than 9 new"; arch test: every
  `BelledLayout` route spreads `bellStateFn`'s state.
- `lib/dates` unit tests for the two new shapes.

## Open questions

1. **Runner's zone** (proceeding): latest observed run's zone, else UTC.
   The owner may prefer storing a zone — that would be a column.
2. **Cleared in the app skips the email**: decided (owner, 2026-10-12),
   kept as built.
3. A held reminder the daily digest's drain happens to pick up is counted
   as an "owed" anomaly line, like any email row. Rare; left as is.
4. **U2's pool card (asking):** its copy describes leaving the in-app
   conditions pool, which no setting controls; `count_in_totals` governs
   the published guides. Wire it to a new setting, reword it to the totals,
   or leave it unbuilt?
