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
  25-hour day does not move it.
- **Skipped by send time** when the bell row is read (a matched upload
  reads it), the runner has disconnected Strava, or the day's email went.
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

**FEED-9: stopped, asked (not built).** The boards were read first, and
neither surface exists to reword. The compact line is drawn only on the
`unbuilt` post-MVP "E2 Feed your conditions" frame; no E1 frame has a
conditions line, and the built Your conditions tab already carries round
25's words in E2-lite's block. N's "privacy card" is U2 Privacy's
"conditions pool" card, whose toggle (leave the in-app pool) has no
column or setting behind it: a product call beside D-108, not wording.
Recorded at the round-25 entry in `design-deltas.md`; open question 4.

**STR-13.** `lib/dates` gains the long-weekday and month-year shapes;
`ops/components/Today.tsx` and `closet/retired-label.ts` use them.
`AccountClosed.tsx` is lane C's.

## Contract touches

- Schema: **one additive migration**, `add_reminder_email_days` (owner
  approved 2026-10-12). Outbox `email` payload: optional `reminder` (wire
  format, additive).
- New route files: none. New bindings/queues/crons: **none**.
- Screens: S2a (bell); Today (D5); C's retired tag. E1/N: not built.

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
4. **FEED-9 (asking):** should the compact line go on E1 at all (where,
   with which states), or wait for E2? Does U2's pool toggle ship, and is
   it a new setting or D-108's `count_in_totals`? Needs design or owner.
