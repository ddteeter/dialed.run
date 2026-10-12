# Design: 140 lane D1 · notifications and feed

> Before-public plan, lane D1 (tasks 127 and 129): STR-9, FEED-3, FEED-9,
> STR-13. No schema change.

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

- **One a day.** Only the runner's _first_ reminder of their local day owes
  the email; a later one that day owes nothing. Decided by a read before the
  batch (the batch cannot branch): any `strava_reminder` row of theirs
  already today, or this event's own row (a redelivery), means no debt. The
  per-day key alone cannot say "one a day", because the drain deletes a row
  once sent and a later insert with the same key would be a fresh row; the
  key is what collapses two _concurrent_ first reminders into one row.
- **The next day counts both.** The first reminder of a day counts itself
  plus yesterday's later reminders still unread — the runs yesterday's
  email did not cover. That is the only way `runs` exceeds 1, which is why
  the drawn body for it says "yesterday and today".
- **Skipped by send time.** The outbox `email` payload gains an optional
  `unlessRead` (law 9: additive) naming the bell row. `emailHandler` skips
  the send when that row is read or gone. An upload pairs and reads the
  reminder (`pairWithReminder`), so a matched upload skips the email; so
  does a runner who already cleared it in the app — the round-26 "or the
  push was opened" rule, with the bell standing in for the push.
- **The preference** is the sender's own check (`optionalMail`), at send
  time, as is the confirmed-address rule.
- **The runner's day and clock.** Nothing stores a runner's zone, so the
  consumer takes `runnerZone(userId)`: the zone of their latest run with an
  observed zone (weather DB), UTC when none, and UTC — reported — if the
  lookup fails (law 5: the bell row must still land).
- **No activity data** (D-33): the payload holds a clock label, a count and
  our own notification id. No Strava id rides the outbox.

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

- Schema changes needed: **none**. Outbox `email` payload: optional
  `unlessRead` (wire format, additive).
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
2. **Cleared in the app skips the email** (proceeding): a read reminder,
   by upload or by Mark all read, sends nothing.
3. A held reminder the daily digest's drain happens to pick up is counted
   as an "owed" anomaly line, like any email row. Rare; left as is.
4. **FEED-9 (asking):** should the compact line go on E1 at all (where,
   with which states), or wait for E2? Does U2's pool toggle ship, and is
   it a new setting or D-108's `count_in_totals`? Needs design or owner.
