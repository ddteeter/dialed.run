# Design: 261 restructure plan

> #850 step 4b, third part. Designs 258 and 260 ended in fifteen questions
> for the owner. The owner answered them on 2026-11-23. This doc records
> the rulings and turns them into lanes a coordinator can dispatch. No code
> changes here. Over the template's one page on purpose: the lane table is
> the deliverable.

## Problem

Design 258 ranked sixteen proposals inside today's fourteen modules.
Design 260 asked whether the fourteen are the right cut, answered yes, and
added a few rules. Between them they left fifteen decisions that were the
owner's. Those are now made, and several go further than either doc
recommended. Nothing yet says in what order the work runs, which lanes
can run together, or which need the owner's label because they change a
protected path.

## The owner's rulings (2026-11-23)

| #   | question                                    | ruling                                                                                                                                                                          | from                |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 1   | Design 258's proposals 1 to 10              | All ten, in its order.                                                                                                                                                          | 258                 |
| 2   | Do other modules import the narrowest door? | Yes, for all three split modules that still have wide parent doors: `safety`, `account` and `ops`. A line in CLAUDE.md says new imports take the narrowest door.                | 258 q1, proposal 13 |
| 3   | Names no source file imports                | Doors drop them. The four dead functions are deleted with their tests. `forecast` stays (see the correction below) and only leaves `weather`'s door.                            | 258 q6, proposal 14 |
| 4   | A direction between modules                 | A fifth number in the module ratchet, pinned and only falling.                                                                                                                  | 260 q1              |
| 5   | Which module writes which table             | Enforced by a lint rule at the call site, driven by one owner map. Not a test that scans the source, and not dependency-cruiser.                                                | 260 q2              |
| 6   | Does `safety` stay under the content?       | Yes. Its status columns are listed as its own in the owner map. The coupling is recorded in `docs/architecture.md` with a watch issue and a trigger.                            | 260 q3              |
| 7   | The purge                                   | Now: a check, derived from the schema, that every table carrying a runner's id is covered. Next: a design in which each module owns its forget step and its part of the export. | 260 q4              |
| 8   | The counters and `src/db/gave-up.ts`        | Both move into `ops` as floor units, `ops/limits` and `ops/gave-up`. `src/db` then holds the schema only.                                                                       | 258 q2, 260 q5      |
| 9   | Proposal 3's route                          | The full move: the Corrections page and its three server functions to `products`, the Desk form pieces to `src/ui`.                                                             | 258 q3              |
| 10  | A ceiling or a debt?                        | `dispatch` leaves the fan-out budget: composing every module is its job. `account`'s and `feed`'s pins each get a written reason.                                               | 258 q4              |
| 11  | A check for design 240 rule 4               | In the module ratchet: a split module's parent door is pinned and may only fall.                                                                                                | 258 q5              |
| 12  | Scripts that import past a door             | Left uncounted.                                                                                                                                                                 | 258 q7              |
| 13  | The runner's profile row                    | Design a profile module. The design settles whether it is top-level or a sub-module of `account`.                                                                               | 260 q6              |
| 14  | Follow-up designs                           | Four more: each email's words with its sender, a home for the Desk, where a run's delete lives, the open web in one place.                                                      | 260 q7              |
| 15  | Order and handover                          | The rules land first and the moves after. This doc is the handover, and a coordinator dispatches from it.                                                                       |                     |
| 16  | Dead code that knip misses                  | Knip runs in production mode over the module doors, so a door name no source file imports fails. The sweep over all of `src` is #1007, not in this plan.                        | asked after 260     |

Rulings 7 and 8 differ from design 260's recommendations. On 8 the
owner's reason is that `email` should hold email, and the cost design 260
named (pairs between `ops` and the modules its Desk imports) is met by
rulings 2 and 4: importers take the floor's own doors, and the direction
number counts the floor units apart. On 7 the owner's reason is that a
module should hold the responsibility for its own tables. The fan-out
objection is met by handing each step in through `dispatch`, which ruling
10 takes out of the fan-out budget.

Taken without a question, as small and already recommended: design 258's
proposals 11 and 16, and design 260's type move and four statements.
Proposal 12 is absorbed by ruling 2 for `ops`.

**A correction to design 258.** Its question 6 lists five exported
functions with no caller in `src`. Four have none: `searchProducts`,
`getProductAttributeDefaults`, `getProductComposition`
(`src/modules/products/service.ts`) and `isVerified`
(`src/modules/account/verification/email-links.ts:267`); only tests call
them. `forecast` has one: `src/modules/weather/zone.ts:25`. Only its
export on `weather`'s door is unused. This PR corrects that line.

## Approach

Four phases. Each lane writes its own design doc first, as every lane
does. Sizes: S is under about ten files, M under about thirty, L more.

### A. The rules

They land pinned at today's numbers, so every later move is made under
them. A4 was added after the rulings, when the owner asked how knip could
catch the dead code ruling 3 deletes.

| lane | what                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | size | owns                                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------- |
| A1   | The ratchet's three changes. (a) A fifth number: the fewest import statements to cut so that no module reaches itself, with each `functions.ts`, `account/purge` and `dispatch` outside it and `ops/outbox`, `ops/sentry` and `safety/rules` counted apart from their parents. (b) A split module's parent door is pinned and may only fall. (c) `dispatch` leaves the fan-out budget; `account`'s and `feed`'s pins carry a reason. A D-row beside D-201, and the paragraph and watch issue of ruling 6.           | M    | `scripts/modules/`, `test/architecture/module-shape.*`, `docs/decisions.md`, `docs/architecture.md`, CLAUDE.md §Architecture rules |
| A2   | The table-write lint rule. One owner map (table, and column group where a table has more than one owner, to module). A module that calls `insert`, `update` or `delete` on a table it is not listed for fails lint. It lands listing today's writers. Its design says how it treats a table passed in an array (the purge does that twice) or through a helper.                                                                                                                                                     | M    | `eslint.config.js`, the owner map, `.claude/rules/server.md`                                                                       |
| A3   | The purge coverage check. A test that reads the schema for every table with a column holding a runner's id, and fails unless the purge covers it or it is exempt with a reason.                                                                                                                                                                                                                                                                                                                                     | S    | one test beside `test/account/purge.test.ts`                                                                                       |
| A4   | Knip over the doors. `knip.json` marks the app's real entries for production mode and stops listing the module doors and `functions.ts` as entries. A check runs knip in production mode and fails when it reports more names on a door file than its pin: about 73 today, lowered by C1 to C4 to 0. The commit gate's knip analyzer runs with fixed arguments, so the check lives in this repo, as a node test or a CI step. Its design says which, and whether to ask for it upstream in guardrails-core (#1007). | S    | `knip.json`, one check under `test/architecture/`                                                                                  |

The fifth number reads 4 today with nothing counted apart, and 3 with the
floor units apart (design 260's `aside.json` and `layered.json`). A1 pins
what its reader reads. It reaches 0 when B2 and B3 land.

### B. The moves

Design 258's proposals keep their numbers. "After" is a hard order. "Not
beside" means the two edit the same files, so they do not run at the same
time.

| lane | what                                                                                                                                                                                                                                                                                                                                                                  | size | after | not beside      |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----- | --------------- |
| B1   | 258 proposal 1: the purge forgets the enrichment count through the counters.                                                                                                                                                                                                                                                                                          | S    |       | B5, B9, B12     |
| B2   | 258 proposal 2, and the backlog types (`src/modules/feed/attach/backlog.ts:55-93`) to `src/lib/contracts`.                                                                                                                                                                                                                                                            | M    |       | B4, B9          |
| B3   | 258 proposal 3, the full move.                                                                                                                                                                                                                                                                                                                                        | M    |       | B8, B11         |
| B4   | 258 proposal 4: the runner-standing clauses to `safety/rules`, with `feed/conditions/runner-visibility.ts`.                                                                                                                                                                                                                                                           | M    |       | B2, B9          |
| B5   | 258 proposal 5: the enrichment sweep leaves `dispatch`.                                                                                                                                                                                                                                                                                                               | M    |       | B1, B6, B12     |
| B6   | 258 proposal 6: the other sweeps leave `dispatch`.                                                                                                                                                                                                                                                                                                                    | M    | B5    | B7, B12         |
| B7   | 258 proposal 7, widened: `runs` exports the import retry, the weather retry (`src/modules/ops/desk/gave-up.ts:317`, a new export) and the write of a run's effort (`src/modules/feed/entries/entries.ts:354`).                                                                                                                                                        | S    |       | B6              |
| B8   | 258 proposal 8: two files leave `safety/limits`.                                                                                                                                                                                                                                                                                                                      | S    |       | B3              |
| B9   | 258 proposal 9: one copy of the live-hold status set. With it, `src/modules/feed/moderation/removal-requests.ts:86` calls a statement `safety/takedowns` exports.                                                                                                                                                                                                     | S    |       | B1, B2, B4, B12 |
| B10  | 258 proposal 10: `runDayOf` to `src/lib/dates.ts`.                                                                                                                                                                                                                                                                                                                    | S    |       |                 |
| B11  | 258 proposal 16: `turnstileAttempt` beside its type in `ops/edge`.                                                                                                                                                                                                                                                                                                    | S    |       | B3              |
| B12  | The floor grows: `src/modules/email/rate-limit.ts` to `ops/limits` and `src/db/gave-up.ts` to `ops/gave-up`. The 18 and 8 importing files import the new doors. Both join the floor list of A1 and the mutation ratchet. First step: check whether the `OutboxHandler` type can be declared in `src/lib/sql/outbox.ts`, which ends `src/modules/weather/store.ts:21`. | M    | B6    | B1, B5, B9      |
| B13  | 258 proposal 11: the two not-found constants through `client.ts`. First step: `npm run build`, for `check:bundle`.                                                                                                                                                                                                                                                    | S    |       |                 |

What may run together, as one reading of the last two columns:

1. B1, B2, B3, B7, B10, B13.
2. B4, B5, B8, B11.
3. B6, B9.
4. B12.

### C. The doors

After every move, so each importer is edited once.

| lane | what                                                                                                                                                                                                                                                   | size | after    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | -------- |
| C1   | 258 proposal 14 for `closet`, `products`, `enrichment`. Deletes the three dead `products` functions and their tests. Then `src/modules/feed/moderation/garment-moderation.ts:198` calls `closet`'s statement, which needs the room on `closet`'s door. | M    | B        |
| C2   | 258 proposal 14 for `account`, `auth`, `onboarding`. Deletes `isVerified`; its two test files read confirmation another way.                                                                                                                           | M    | B        |
| C3   | 258 proposal 14 for `feed`, `runs`, `weather`, `notifications`. `forecast` leaves `weather`'s door.                                                                                                                                                    | M    | B        |
| C4   | 258 proposal 14 for `safety`, `ops`, `email`.                                                                                                                                                                                                          | M    | B        |
| C5   | 258 proposal 13 for `safety`: 37 source files and 43 test files import the sub-module door each name lives on.                                                                                                                                         | L    | C1 to C4 |
| C6   | The same for `account`.                                                                                                                                                                                                                                | M    | C5       |
| C7   | The same for `ops`. Absorbs 258 proposal 12. Adds the CLAUDE.md line of ruling 2.                                                                                                                                                                      | M    | C6       |

C1 to C4 touch different doors and may run together. C5, C6 and C7 each
edit import lines in every area, so each runs whole and alone, with no
other lane open.

### D. The designs

Each is a design doc and a question for the owner. Nothing is built until
the owner rules on it. They can be written while B and C run.

| lane | the design                                                                                  | note                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| D1   | Each module owns its forget step and its part of the export; `dispatch` hands the steps in. | Builds on A3. `account`'s fan-out should fall; `dispatch` is outside the budget after A1.                          |
| D2   | A profile module for `user_profiles` and `username_history`.                                | Settles top-level (D-201 amended) or a sub-module of `account`. What `onboarding` keeps.                           |
| D3   | Each email's words with its sender.                                                         | `src/modules/email/content.ts` is the one measured cause of pull requests crossing modules (design 260 finding 4). |
| D4   | A home for the Desk.                                                                        | First step is a flow in `docs/diagrams` for a Desk decision on a photo.                                            |
| D5   | Where a run's delete lives.                                                                 | Check whether the reason at `src/modules/feed/entries/retract.ts:20-25` still holds. If not, it is a lane.         |
| D6   | The open web in one place.                                                                  | Today in `feed/public-web`, `ops/public-web` and `src/modules/closet/public-rotation.ts`.                          |

### What every lane shares

- **Protected paths.** `.github/workflows/protected-paths.yml` requires
  the owner's `owner-approved` label on a pull request that changes
  `scripts/`, `test/architecture/`, `stryker.conf.json` or the ESLint
  config, among others. A1 and A2 change them by design. Every B and C
  lane that moves a file edits `stryker.conf.json`, and every lane that
  lowers a pin edits `test/architecture/module-shape.json`. So nearly
  every pull request here needs the label, once per push. The coordinator
  asks for them in batches.
- **The pins file and the mutation config** are edited by most lanes, so
  merges go one at a time and each lane rebases before it ships.
- **The diagrams.** See the section below: most lanes regenerate the
  structure, and ten edit or re-read a drawn flow.
- **The owner map** of A2 is edited by any lane that moves a write: B5,
  B6, B7, B9, B12 and C1.

### The diagrams

Four things, by CLAUDE.md's workflow expectation 5 and skill `pr-ready`
step 7.

- **The generated structure.** A lane that changes a cross-module import,
  or adds or removes a sub-module, runs `npm run diagrams:generate` and
  commits the result. That is every B lane, and C5 to C7 where a module
  pair's arrow changes door. B12 adds two sub-modules, `ops/limits` and
  `ops/gave-up`, which need their lines in
  `docs/diagrams/structure.words.json`.
- **The ratchet and the diagram read imports through the same code**
  (`scripts/modules/shape.ts` imports `isWiring` and `owningUnit` from
  `scripts/diagrams/structure.ts`). A1 changes what the ratchet counts
  apart: the floor units, and `dispatch`. Its design says whether the
  modules view draws the floor apart too, so that the two go on agreeing.
- **The drawn flows.** A story cites its files in `// source:` lines, and
  `npm run diagrams:stale` lists the stories that cite a file a branch
  changed. Each such story is updated or re-read, and named under
  "Diagrams" in the pull request. A changed story is recorded with
  `npm run diagrams:record`. At `b689efa0`, the nine flows cite the files
  these lanes touch as follows:

| lane   | file                                                                     | `source:` lines | flows                                                                            | what to expect                                                |
| ------ | ------------------------------------------------------------------------ | --------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| B5, B6 | `src/modules/dispatch/scheduled.ts`                                      | 36              | import, enrichment, screening, export, deletion, outbox, public-photos, removals | Updated: a sweep's step is the owning module's once it moves. |
| B1, B9 | `src/modules/account/purge/purge.ts`                                     | 17              | deletion, removals                                                               | Re-read.                                                      |
| B9     | `src/modules/feed/moderation/removal-requests.ts`                        | 10              | removals                                                                         | Re-read; updated if the story names who sets the status.      |
| B2     | `src/modules/feed/functions.ts`                                          | 9               | screening, feed, public-photos, removals                                         | Re-read.                                                      |
| B7     | `src/modules/feed/entries/entries.ts`, `src/modules/ops/desk/gave-up.ts` | 6, 2            | public-photos, enrichment                                                        | Re-read; updated where the Desk's retry is a step.            |
| B3     | `src/modules/safety/functions.ts`                                        | 5               | public-photos, removals                                                          | Re-read.                                                      |
| B12    | `src/db/gave-up.ts`, `src/modules/email/rate-limit.ts`                   | 2, 2            | import, deletion                                                                 | Updated: both `source:` paths change.                         |
| B8     | `src/modules/safety/limits/`                                             | 2               | screening, removals                                                              | Updated if a cited file is one of the two that move.          |
| C1     | `src/modules/products/service.ts`                                        | 1               | enrichment                                                                       | Re-read.                                                      |

```sh
rg -c "source:.*dispatch/scheduled.ts" docs/diagrams/flows   # and so on for each file
```

The counts will have moved by the time a lane starts; `diagrams:stale`
is the check. B5 and B6 are the two lanes where the story itself
changes for most flows, so they are the ones to size for it.

- **A new flow.** D4's first step draws a Desk decision on a photo. D1 is
  likely to change the deletion and export stories when it is built.

### The grants

| file                                               | lane                                        | the change                                                                                                     |
| -------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `scripts/modules/shape.ts` and its readers         | A1                                          | The fifth number, the parent-door pin, `dispatch` outside the fan-out budget.                                  |
| `test/architecture/module-shape.json` and its test | A1, then most                               | New pins in A1. After that only lowered.                                                                       |
| `eslint.config.js`                                 | A2                                          | One rule and its owner map.                                                                                    |
| `knip.json`                                        | A4                                          | The app's entries marked for production mode; the module doors and `functions.ts` no longer entries.           |
| `stryker.conf.json`                                | B3, B4, B12, and any lane that moves a file | Entries follow their files. B3 adds one for `products`' components. B4 and B12 add files that have none today. |
| CLAUDE.md, `docs/decisions.md`                     | A1, C7                                      | The direction, the floor, the narrowest-door line, one D-row.                                                  |
| `.dependency-cruiser.cjs`                          | none planned                                | A lane that finds it needs a change stops and asks.                                                            |

The owner chose each of these changes on 2026-11-23 knowing whose file it
is. Each lane still names the exact change in its pull request, and a
change beyond what this table says is a new ask.

### The numbers this should leave

| number                         | today                  | after                                                 |
| ------------------------------ | ---------------------- | ----------------------------------------------------- |
| fan-out `account`              | 9                      | 8 after B1. A reason beside the pin.                  |
| fan-out `feed`                 | 10                     | 9 after B2. A reason beside the pin.                  |
| fan-out `safety`               | 8                      | 7 after B3. The pin leaves.                           |
| fan-out `dispatch`             | 11                     | Outside the budget after A1.                          |
| door `safety`                  | 95                     | 92 after B4, about 8 after C5. The pin leaves.        |
| past-the-door `closet`, `runs` | 1, 1                   | 0, 0 after B13. Both pins leave.                      |
| the direction (new)            | 3 or 4                 | 0 after B2 and B3.                                    |
| parent doors (new)             | `account` 35, `ops` 24 | Lower after C2, C4, C6 and C7. Measured by each lane. |

B12 also changes fan-out for the modules that imported `email` only for
the counters and already import `ops`. Design 258 called that fall "on
paper", and it is.

## Contract touches

None in this doc. No lane here is meant to change behaviour. A lane that
finds it must change a contract stops and asks.

## Test plan

No code changes, so no tests. A1, A2 and A3 are each a check. Every B and
C lane is behaviour-neutral and is held by the existing suite, the module
ratchet and the mutation ratchet at 100%.

## Issues

- Refs #850 (step 4b).
- Closes #982
- Closes #1005
- Opens: #1007, knip in production mode over all of `src`, in Needs owner.
- Each lane gets a build issue when the coordinator dispatches it. Ruling
  6's watch issue is opened by A1.

## Open questions

None for the owner. For the coordinator:

- How many lanes to run at once is theirs. The groups under B are the
  most that can run together, not a recommendation to.
- The wave starts after #850's step 4.

## Not checked

- The "not beside" columns are design 258's, read from the files each
  proposal names, plus this doc's reading for B7, B9 and B12. No lane was
  dry-run against another.
- Whether the lint rule of A2 can be written as per-folder syntax
  restrictions in `eslint.config.js` as it stands, or needs a small local
  rule. That is A2's design.
- Whether the `OutboxHandler` type moves without the two names declared
  beside it (B12's first step).
- The fifth number has no reader yet. 3 and 4 are design 260's scores.
- Door widths after C. Each lane measures its own with
  `npm run -s modules:pin -- --print`.
