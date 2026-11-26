# Design: 269 where a run's delete lives

> Design 261 §D, row D5 (#1052), from the owner's ruling 14. A design and
> one question. Nothing is built until the owner rules. Behaviour-neutral:
> no row, debt or purge a delete writes changes. Over the template's page
> by its claim and measurement tables.

## Problem

A runner deletes a run from its page. The delete lives in `feed`
(`src/modules/feed/entries/retract.ts`), not in `runs`, and its comment
at lines 20-25 says why: a cycle. Design 260 (strain 7) asked whether that
reason survived design 256. Design 261 row D5 says: if it does not, it is
a lane.

## The delete today

Route `src/routes/runs/$runId.tsx:59` hands `deleteRunFn`
(`src/modules/runs/functions.ts:235-240`, `requireUserId`) to
`DeleteRun.tsx`. The function calls `deleteRun` from `feed`'s door
(`functions.ts:19`). `deleteRun` (`retract.ts:646`) checks the run is the
runner's and that no live copyright hold names its entry, then
`deleteRuns(db, userId, [id])` (`retract.ts:559`) reads the upload keys,
the entry ids and the runs, and builds one statement list
(`runStatements`, `retract.ts:515-535`):

- **The entry's 10 statements** (`entryStatements`, `retract.ts:141-169`):
  open reviews settled (`review_queue`, twice), `outfit_entry_items`,
  `entry_tags`, `reactions`, `photo_screenings`, `entry_photos`,
  `notifications`, the entry half of `run_conditions`, `outfit_entries`.
  A photo under review adds a `moderation_actions` row and kept
  fingerprints (`withdrawnUnderReview`, design 232).
- **The run's 4**: its `notifications`, `imports`, its `run_conditions`
  copy, `runs`.
- **The debts**, as `outbox` rows: `entry_media_delete` per entry (R2
  media prefix), `import_file_delete` per upload (R2 imports object),
  `manual_conditions_delete` per run (`DIALED_WEATHER`, law 8c).

`commit` (`retract.ts:203-211`) puts all of it in **one `db.batch()`**,
then settles each debt on the fast path; the daily drain
(`dispatch/scheduled.ts`, `drainOutbox`) finishes what fails. The edge
purge runs after. Account deletion's purge calls the same `deleteRuns`
and `deleteRunsThrough` (`account/purge/purge.ts:86`). "Retire, don't
delete" is about garments; a run delete removes entry items, never a
garment.

## The comment, claim by claim

Measured at `740f4f852` with the ratchet's own reader (`readShapeFacts`,
`scripts/modules/read.ts`). The direction is scored as design 260 did: the
fewest import edges to cut so no module reaches itself, each
`functions.ts`, `account/purge` and `dispatch` left out. The scorer gives
today 4 (3 with `ops/outbox`, `ops/sentry`, `safety/rules` apart), design
260's numbers.

| claim (`retract.ts:20-25`)                                          | verdict                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "The packet named `runs/delete-run.ts`"                             | Holds. `docs/tasks/128-content-safety.md:28`.                                                                                                                                                                                                                                             |
| "`ops` imports the runs barrel for its queue consumer"              | Half. `ops` imports `runs`' door in three files: `ops/desk/gave-up.ts:38`, `ops/owed-email/owed-email.ts:28`, `ops/edge/body-cap.ts:16`. None is a queue consumer: those are in `dispatch` (`dispatch/queues.ts:12`).                                                                     |
| "as the outbox fast path must"                                      | Gone. Since design 256, `ops/outbox` imports no feature module (`docs/architecture.md:207-209`). What still reaches `runs` is `ops`' parent door (through `ops/edge`) and `ops/owed-email`, which `commit` settles for a moderation decision's email.                                     |
| "it cannot exist as an export … a cycle dependency-cruiser refuses" | Only on `runs`' parent door. There it is still a file cycle: `runs/index.ts` → the delete → `feed/entries/index.ts` → `retract.ts` → `ops/owed-email` → `owed-email.ts` → `runs/index.ts`. As a `runs/delete` sub-module that `runs/index.ts` does not re-export, it makes no file cycle. |
| "The feed already reads `runs` for every card it draws"             | Holds. `feed` reads the `runs` table in six files (e.g. `following/feed.ts:270`, `following/profiles.ts:301`, `public-web/public-profile.ts:133`) and imports `runs`' door in two (`attach/attach-context.ts:28`, `attach/backlog.ts:14`).                                                |
| "a run's deletion is mostly its entry's"                            | Holds. 10 of the 14 fixed statements are the entry's.                                                                                                                                                                                                                                     |

**The new reason is ruling 4.** In `runs`, the delete imports `feed`,
`ops` and `safety`, all three of which import `runs` (`safety/runners/
runners.ts`). The direction goes from 3 to 7 (4 to 8 with nothing apart),
and `runs`' fan-out from 6 to 7. Once A1 pins the direction, it may only
fall. So the comment's reason is stale, but its conclusion still holds.

## The options

| number (today)                        | 1: statements to `runs`  | 2: `runs/delete` sub-module                                                               | 3: comment only |
| ------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------- | --------------- |
| the direction (3; 4 nothing apart)    | 3 (4)                    | **7 (8)**                                                                                 | 3 (4)           |
| fan-out `runs` (6), `feed` (10)       | 6, 10                    | **7**, 10                                                                                 | 6, 10           |
| fan-out `account` (9)                 | 9                        | 9 (8 once B9 moves `LIVE_HOLD` off `feed`)                                                | 9               |
| door `runs` (16)                      | 18 or 19 (budget 45)     | 16; new door `runs/delete` 3                                                              | 16              |
| door `feed` (16), `feed/entries` (34) | 16, 34                   | 13, about 37 (the frame `retractScoped`, `retractOneOf`, `keeping` and two more go on it) | 16, 34          |
| files `runs` (24)                     | 25                       | 24; `runs/delete` 2                                                                       | 24              |
| file cycles                           | none                     | none (one if put on `runs`' parent door)                                                  | none            |
| `feed` writes `runs`, `imports`       | no longer deletes either | no longer                                                                                 | still           |

Edges added for option 1: `retract.ts` → `runs/index.ts`. `feed` already
imports `runs`, so no arrow changes.

1. **The delete stays in `feed`; `runs` exports the statements for its
   own tables.** A new `runs/run-deletes.ts` holds the upload-key read and
   the two deletes (`imports`, `runs`) that `retract.ts:505-507, 531, 533`
   write today, scoped by runner as now. `runStatements` calls them in
   today's order. The comment at lines 20-25 gives today's reason. This is
   design 261's B7 pattern (a run's effort write leaves `feed` the same
   way), and it is what A2's owner map wants: `runs` writes `runs`.
2. **The packet's home.** Everything run-only in `retract.ts` (lines
   502-654) moves to `runs/delete/`. `runs/functions.ts` and the purge
   import its door. It raises a pin that ruling 4 says may only fall.
3. **Leave the code.** Rewrite the comment only, and close #1052.

**Atomicity, every option.** One batch, built by `feed`'s `commit`, the
same statements in the same order: every delete finds its rows through
the entries and runs still standing, so the runs go last. The weather
band stays a debt (law 8c). Nothing moves across two systems.

**Diagrams.** No flow draws the runner's own run delete. Four flows cite
`retract.ts` (`deletion.c4:127, 136`; `removals.c4:95, 106, 157, 192,
194`; `public-photos.c4:96`; `desk-review.c4:84, 95, 130`). Option 1:
`deletion.c4:127` gains the `runs` file; the rest re-read. Option 2:
`deletion.c4:127, 136` change path, the structure gains `runs` → `safety`
and `account` → `runs/delete`, and `docs/architecture.md:558` ("feed's
SAF-3 deletes") changes. Option 3: none.

## Contract touches

- Schema, bindings, queues, crons, routes, screens: **none**.
- `stryker.conf.json:62` lists `runs` files by name, so option 1's file is
  added there (protected, `owner-approved`). Option 1 also edits A2's
  owner map if A2 has landed; add the lane to 261's list of map editors.

## Build plan (option 1, one lane, S)

After B7 and B9, or folded into B7: all three edit `runs`' door or
`retract.ts`. Before C3, which narrows both doors.

1. `runs/run-deletes.ts` and its door names; `test/runs/run-deletes.test.ts`
   (worker): another runner's run or upload is never read or deleted.
   Done: the test green, `stryker.conf.json:62` lists the file.
2. `retract.ts` calls them; the comment gives today's reason. Done:
   `test/safety/retract.test.ts`, `copyright-holds.test.ts`,
   `edge-purges.test.ts` and `test/account/purge.test.ts` green with no
   expectation changed.
3. `deletion.c4:127`, `diagrams:generate`, `diagrams:stale`,
   `modules:pin -- --print` as tabled. Done: full `npm test`,
   `npm run build`.

## Test plan

The existing worker tests above are the proof of neutrality. One new
worker test for the runner scoping, since those statements now have a
caller outside their module. No Playwright spec: no screen changes.

## Issues

- Refs #1052, which the build lane closes (or option 3's comment fix).
  Opens nothing.

## Open questions

**For the owner: where does a run's delete live?**

1. **(Recommended) In `feed`, with `runs` writing its own two tables.**
   The delete is mostly the entry's, and moving it would raise the
   direction from 3 to 7 against ruling 4. Moving only the `imports` and
   `runs` deletes gives `runs` its writes, as B7 does for the effort, with
   no number rising. One S lane.
2. **In a `runs/delete` sub-module, as task 128's packet named it.** No
   file cycle now, but the direction rises by 4 and `runs`' fan-out by 1.
   It needs the owner to raise a pin ruling 4 made only-falling. M.
3. **Leave the code; fix the comment's reason** and close #1052.

## Not checked

- The direction was scored by a scratch reimplementation of design 260's
  method, not by A1's reader, which does not exist yet. It reproduces
  design 260's 4 and 3 for today.
- Option 2's `feed/entries` door count is read from what the moved code
  calls, not built.
- Whether D1 (each module owns its forget step) wants the purge's own
  `imports` delete (`purge.ts:529`) to call option 1's statement too.
