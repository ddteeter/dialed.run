# Design: 264 purge coverage check

> Design 261 §A, row A3; ruling 7 ("now"). Issue #1045.

## Problem

The purge (`src/modules/account/purge/purge.ts`) deletes an account's rows
table by table, and nothing makes a new table that holds a runner's id
join that list. A table added next month would outlive the account it
names, and every test would stay green. This lane adds a check that fails
until the purge covers the table, or the table is exempt with a reason.

## Approach

One worker test, `test/account/purge-coverage.test.ts`. No production code.

1. **Which columns hold a runner's id**, read from the four schema files
   (`getTableConfig` over every `SQLiteTable` they export, never a list of
   tables). A column holds one when it is `user.id`, has a foreign key to
   it, or its name is classified as one. Every column whose name ends in
   `_id` or `_by` must be classified, by name, as a runner, an operator (an
   operator's account is a runner's too), a subject, or what it names
   instead (`entry_id`: an entry). A new name that is not classified fails
   the test, so a new kind of id cannot slip past as "not a runner".
   `subject_id` holds a runner's id where the table's `subject_type` can say
   `profile` (read from its enum; an untyped one counts as able to).
   `verification.value` is the one column named otherwise (Better Auth's
   reset link names the runner in it); it is listed beside the rule.
2. **Seeded generically.** For each such column, one row whose column names
   a fresh runner, and whose other columns get type-shaped values from the
   column's own metadata (its enum's first value, `0`, a fresh string).
   A row that cannot be written fails the test.
3. **Purged** with `purgeAccount`, its seams as `purge.test.ts` sets them.
4. **Compared both ways**: the columns still naming the runner must be
   exactly the exempt ones. A leftover not exempt is a gap; an exempt
   column the purge cleared is a stale exemption.

A row seeded alone cannot show coverage that goes through another table
(a follow's ring on someone else's bell is found through `follow_notices`),
so `notifications.link_id` is exempt with a pointer to the `purge.test.ts`
case that proves it. Ids buried inside a string (`rate_limits.key`, an
outbox payload) are not columns holding an id; `purge.test.ts` covers them.

## Contract touches

- Schema changes needed: **none**
- New route files: none
- New bindings/queues/crons: **none**
- Screens implemented: none

## Test plan

- `purge-coverage.test.ts` (worker, D1): "classifies every id column the
  schema has", and "leaves a runner's id only in the columns exempt with a
  reason". A worker test because the check runs the real purge on D1.

## Issues

- Closes: #1045
- Opens: #1055 (Needs owner), for the exemptions no decision covers yet
  (operators' ids on the Desk's records; a settled copyright hold's
  `owner_id`). The test exempts them pointing at it, so the build stays
  green while the question is open.

## Open questions

- Proceeding on: a Desk operator's id on the Desk's own records (who
  decided, resolved, added) stays when that operator's account is purged,
  as the record of who acted. In the owner issue.
