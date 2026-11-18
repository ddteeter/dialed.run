# Design: 240 module breakdown

> Over the template's one page on purpose: the tree is the deliverable
> (#796 step 1) and wave 16 dispatches the moves from it. The first three
> sections and the open questions are the page to read; the rest is the
> tree, file by file, and the evidence.

## Problem

Four modules (`safety`, `feed`, `account`, `ops`) are large and mixed, the
module graph is one cycle, and nothing measures either (#796). This doc
proposes the sub-modules for each, the rule that keeps a sub-module behind
its `index.ts`, and a ratchet. Nothing moves in this lane: the owner
reviews the tree first, and wave 16 moves the files.

## What main measures today

Re-measured at `418583f9` (the issue's tables were taken at `ea712cfa`),
from the imports as dependency-cruiser resolves them, the same reading
`npm run diagrams:generate` draws from. Non-test code.

| module         | lines          | files   | modules it imports: all / service code | barrel names | of those, used by another module |
| -------------- | -------------- | ------- | -------------------------------------- | ------------ | -------------------------------- |
| `safety`       | 20,987         | 86      | 8 / 4                                  | 224          | 96                               |
| `feed`         | 17,628         | 96      | 10 / 8                                 | 15           | 10                               |
| `account`      | 14,142         | 60      | 9 / 9                                  | 35           | 16                               |
| `ops`          | 9,057          | 46      | 8 / 7                                  | 41           | 21                               |
| `runs`         | 10,546         | 50      | 6 / 3                                  | 15           | 15                               |
| `closet`       | 9,149          | 37      | 7 / 6                                  | 43           | 16                               |
| `auth`         | 5,811          | 41      | 4 / 4                                  | 20           | 11                               |
| `onboarding`   | 5,628          | 31      | 7 / 4                                  | 7            | 5                                |
| the other five | 1,098 to 2,895 | 9 to 24 | 1 to 3 / 0 to 2                        | 13 to 34     | 8 to 21                          |

| graph                                                | arrows | pairs that import each other          | modules in a cycle                                          |
| ---------------------------------------------------- | ------ | ------------------------------------- | ----------------------------------------------------------- |
| every import                                         | 69     | 14                                    | all 13 (`weather` joined: it imports `email`)               |
| service code only (no `functions.ts`, no components) | 50     | 2: `account`/`auth`, `account`/`feed` | 6: `account`, `auth`, `closet`, `feed`, `onboarding`, `ops` |

Three findings the tree is built on:

- **128 of `safety`'s 224 barrel names are imported by no source file
  outside `safety`**: only tests use them. The interface other modules use
  is 96 names. (`closet`: 26 of 43; `account`: 18 of 35.)
- **`ops`' outbox pulls its roof in with it.** `outbox.ts` imports
  `outbox-handlers.ts` for `settleOutbox`'s default handlers, and that file
  imports `email`, `runs`, `safety` and `weather`. So a module that only
  owes a debt still imports the dispatch side, which is why `ops` cannot
  import the modules that import it.
- **Past a barrel today**: `src/server.ts` imports 7 files past a module's
  `index.ts` (5 in `account`, 1 in `auth`, 1 in `feed`), and
  `named-not-found.tsx` 2 more that are not components. Routes import 40
  service files directly (80 imports): mostly client-side helpers a
  barrel cannot export because it reaches `env`, and a few server routes
  reading a service file. About twenty files carry a comment saying one
  module cannot import another.

## Approach: five rules

1. **A sub-module is a folder directly under a module with its own
   `index.ts`**, as `runs/parsers` and `weather/provider` already are. The
   generator already draws one as its own unit, nested in its module.
2. **Sub-modules of one module meet at the door.** A file in `feed/entries/`
   reaches `feed/conditions/` only through `feed/conditions/index.ts`. The
   sub-modules of one module therefore form a strict order with no cycle:
   a cycle between two doors is a file cycle, and `no-circular` fails it.
3. **A sub-module's door is public** (question 1). Another module may
   import `account/purge/index.ts`. This is what lets the dispatch take
   its jobs without the Worker entry handing them in.
4. **The parent's `index.ts` keeps exporting what other modules import
   today, re-exported from the doors, and gains nothing new.** So a move
   PR changes no importer in another module, and the four moves do not
   edit each other's files. New imports use the narrowest door; the
   parent's barrel only shrinks.
5. **Wiring stays at the parent in this pass** (question 3):
   `functions.ts`, `inputs.ts`, `components/` and the client-side helpers
   routes import. Four architecture tests, `knip.json`, a
   dependency-cruiser rule and the mutation config's negations all name
   `src/modules/*/functions.ts`. Components and helpers keep importing
   files directly, never a door: a door that reaches `env`, imported by
   value from a component, puts server code in the client bundle, and
   only `npm run build` sees it.

## The tree

Sizes are files / lines of the files that move (approximate where a file
splits). "Imports" is service code, at the proposed doors. Each list was simulated over today's import graph:
the sub-modules of each module have no cycle between them.

### `ops`, and a new top-level module `dispatch` (question 2)

`ops` is a floor seven modules import and a roof that imports eight. The
roof is the one piece of code that by its nature imports every area and is
imported by none, so it does not belong to `ops`' area or any other.

| unit             | files                                                                                                                                                                                     | size      | imports                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------- |
| **`dispatch`**   | `scheduled.ts`; `handleQueueBatch` and its consumers from `queues.ts`                                                                                                                     | 2 / 1,371 | every area's doors; nothing imports it but `server.ts`                  |
| `ops/sentry`     | `sentry.ts`                                                                                                                                                                               | 1 / 234   | nothing                                                                 |
| `ops/outbox`     | `outbox.ts`, `outbox-handlers.ts`, and `oweInCore` from `queues.ts`                                                                                                                       | 2 / 910   | `sentry`; `email`, `runs`, `safety`, `weather`                          |
| `ops/edge`       | `body-cap.ts`, `secure-response.ts`, `security-headers.ts`, `inline-script-hashes.ts`, `csp-report.ts`, `turnstile.ts`                                                                    | 6 / 770   | `sentry`, `public-web`; `email`, `runs`                                 |
| `ops/public-web` | `public-cache.ts`, `edge-purge.ts`, `public-photos.ts`, `og/**`                                                                                                                           | 9 / 1,405 | `sentry`; `email`, `safety`                                             |
| `ops/speed`      | `timing.ts`, `vitals.ts`, `vitals-queries.ts`, `vitals-rollup.ts`, `speed-digest.ts`, `speed-hourly.ts`, `perf-checks.ts`                                                                 | 7 / 1,438 | `sentry`                                                                |
| `ops/desk`       | `desk.ts`, `desk-gate.ts`, `digest-marks.ts`, `gave-up.ts`, `owner-handles.ts`, `crons.ts`, `health.ts`, `deployment-config.ts`, the queue registry and `enrichmentDeps` from `queues.ts` | 8 / 1,319 | `outbox`, `sentry`; `email`, `enrichment`, `products`, `runs`, `safety` |
| `ops/daily`      | `digest-email.ts`, `removal-reminders.ts`, `media-backup.ts`                                                                                                                              | 3 / 493   | `desk`, `outbox`, `sentry`; `email`, `safety`                           |
| `ops` (parent)   | `index.ts`, `functions.ts`, `inputs.ts`, `components/`                                                                                                                                    | 8 / 1,117 |                                                                         |

`ops/index.ts` still exports the 21 names other modules use (the outbox's
five, `captureException`, Turnstile's four, the two purges, `oweInCore`,
the seven public-page names `feed` uses, and `ExportConsumers` until step
E below removes the hand-in). It stops exporting
`handleScheduled`, `handleQueueBatch` and the 18 names only the Worker
entry and routes use: those import the door (`dispatch`, `ops/edge`,
`ops/speed`). One-file `ops/sentry` is deliberate: seventeen units import
it and it must import nothing.

### `safety`

| unit               | files                                                                                                                                                                                  | size        | imports                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------ |
| `safety/rules`     | `contracts.ts`, `visibility.ts`, `admin.ts`, `moderation-actions.ts`, `kit-cache-tags.ts`, `kit-pieces.ts`, `denylist.ts`                                                              | 7 / 1,071   | nothing                                                            |
| `safety/limits`    | `breakers.ts`, `at-once.ts`, `takedown-limits.ts`                                                                                                                                      | 3 / 713     | `rules`                                                            |
| `safety/notices`   | `notices.ts`, `notice-copy.ts`                                                                                                                                                         | 2 / 355     | `rules`; `notifications`                                           |
| `safety/review`    | `review.ts`, `review-audit.ts`, `other-photos.ts`, `photo-matches.ts`, `removed-fingerprints.ts`, `release.ts`, `withdrawn.ts`, `desk-kit.ts`, `duplicates.ts`, `duplicates-report.ts` | 10 / 3,242  | `rules`, `limits`, `notices`; `weather`                            |
| `safety/screening` | `screening.ts`, `thresholds.ts`, `retry.ts`, `stuck.ts`, `classifier/**`                                                                                                               | 6 / 1,244   | `rules`, `limits`, `notices`, `review`                             |
| `safety/reports`   | `reports.ts`, `reportable.ts`, `blocks.ts`, `retention.ts`, `removal-reminders.ts`                                                                                                     | 5 / 1,275   | `rules`, `limits`, `notices`, `review`, `screening`; `email`       |
| `safety/takedowns` | `takedown-requests.ts`, `request-subject.ts`, `requester-key.ts`, `copyright-holds.ts`, `run-removals.ts`, `quarantine.ts`                                                             | 6 / 1,980   | `rules`, `limits`, `notices`, `review`, `reports` (types); `email` |
| `safety/runners`   | `bans.ts`, `ban-gate.ts`, `account-flags.ts`, `runners.ts`, `rename.ts`                                                                                                                | 5 / 815     | `rules`, `notices`; `email`, `runs`                                |
| `safety` (parent)  | `index.ts`, `functions.ts`, `inputs.ts`, `components/`, `blur/` (client-side, imported only by `PhotoBlur.tsx`)                                                                        | 42 / 10,292 |                                                                    |

`safety/index.ts` drops to the 96 names another module imports; tests
import the door or the file. No new top-level module: everything here is
one area. `safety/rules` is the part most of the app depends on (the
visibility rule, the denylist, the vocabulary), and it imports nothing.

### `feed`

| unit              | files                                                                                                                                                                                                              | size       | imports                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------- |
| `feed/conditions` | `conditions.ts`, `judged-conditions.ts`, `units.ts`, `strip.ts`, `groups.ts`, `run-conditions-entry.ts`, `own-history.ts`, `garment-names.ts`, `count-where.ts`, `entries-query.ts`, `runner-visibility.ts`        | 11 / 690   | `account`, `safety`, `weather`                                                                  |
| `feed/entries`    | `entries.ts`, `share-default.ts`, `reactions.ts`, `retract.ts`, `photos.ts`, `band-signals.ts`, `band-runs.ts`, `chips.ts`                                                                                         | 8 / 2,696  | `conditions`, `public-web`; `account`, `closet`, `email`, `notifications`, `ops`, `safety`      |
| `feed/attach`     | `attach-context.ts`, `picker.ts`, `prefill.ts`, `backlog.ts`                                                                                                                                                       | 4 / 721    | `conditions`, `entries`; `closet`, `runs`                                                       |
| `feed/consensus`  | `consensus.ts`, `bar-share.ts`, `compact-conditions.ts`, `home.ts`, `garment-bands.ts`, `coverage.ts`, `ladder-read.ts`                                                                                            | 7 / 1,097  | `conditions`; `ops`, `safety`                                                                   |
| `feed/following`  | `feed.ts`, `follows.ts`, `follow-notices.ts`, `search.ts`, `profiles.ts`                                                                                                                                           | 5 / 1,197  | `conditions`, `consensus`, `entries`, `public-web`; `account`, `notifications`, `ops`, `safety` |
| `feed/public-web` | `public-kit.ts`, `public-kit-shape.ts`, `public-profile.ts`, `public-profile-shape.ts`                                                                                                                             | 4 / 816    | `conditions`; `account`, `closet`, `ops`, `safety`                                              |
| `feed/moderation` | `moderation.ts`, `garment-moderation.ts`, `missing-photo.ts`, `run-day.ts`, `removal-requests.ts`                                                                                                                  | 5 / 1,246  | `conditions`, `entries`; `email`, `notifications`, `ops`, `safety`                              |
| `feed` (parent)   | `index.ts`, `functions.ts`, `inputs.ts`, `components/`, and the helpers routes and components import: `route-decisions.ts`, `redirect.ts`, `attach-rules.ts`, `kit-push.ts`, `posted.ts`, `noted.ts`, `counted.ts` | 52 / 9,165 |                                                                                                 |

`feed/index.ts` keeps its 10 used names. No new top-level module.

### `account`

| unit                   | files                                                                                                                                              | size       | imports                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| `account/terms`        | `terms-acceptance.ts`, `legal-markdown.ts`, `legal.ts`, `licence-text.ts`, `open-source.ts`, `open-source-search.ts`                               | 6 / 1,460  | `notifications`, `runs`                                                             |
| `account/verification` | `verification.ts`, `email-links.ts`                                                                                                                | 2 / 933    | `email`, `ops`                                                                      |
| `account/handles`      | `username.ts`, `handle-screen.ts`, `handle-review.ts`, `handle-rescreen.ts`, `handle-copy.ts`                                                      | 5 / 1,422  | `terms`; `ops`, `safety`                                                            |
| `account/access`       | `access.ts`, `access-endpoint.ts`, `invites.ts`, `answered-requests.ts`, `closed-addresses.ts`, `accounts.ts`                                      | 6 / 1,142  | `terms`, `verification` (types); `email`, `ops`                                     |
| `account/data`         | `data-exports.ts`, `export-queue.ts`, `deletion.ts`, `account-view.ts`                                                                             | 4 / 765    | `terms`, `handles`, `verification` (types); `email`, `notifications`, `ops`, `runs` |
| `account/export-build` | `export.ts`, `export-files.ts`, `export-format.ts`, `export-sheets.ts`, `export-build.ts`, `export-sweep.ts`                                       | 6 / 1,484  | `data`; `email`, `ops`, `weather`                                                   |
| `account/purge`        | `purge.ts`                                                                                                                                         | 1 / 688    | `access`, `data`; `email`, `enrichment`, `feed`, `ops`, `runs`, `safety`, `weather` |
| `account` (parent)     | `index.ts`, `functions.ts`, `inputs.ts`, `components/`, `route-decisions.ts`, `theme.ts`, `theme-answer.ts`, `use-go-home.ts`, `use-saved-page.ts` | 30 / 6,248 |                                                                                     |

`account/index.ts` keeps its 16 used names. `export-build` and `purge` are
their own doors, never re-exported by the parent, for the two reasons
`docs/architecture.md` already gives: `purge` imports `feed`, which imports
`account`, and the build's zip library must stay out of every route's
reach. Whether `purge` is a sub-module or the dispatch's is question 4.

### The other nine

- `auth`: `expired-rows.ts` needs a door of its own (`auth/expired-rows/`)
  for the dispatch to import. `auth/index.ts` pulls the framework and no
  test can import it, so the dispatch must not.
- `runs` (10,546 lines, 50 files) is the size of `ops` and has two folders
  that are sub-modules in all but the `index.ts`: `strava/` and `garmin/`.
  Its coupling is low (3 service imports, every barrel name used). Propose
  it after wave 16, not in it: lane 15d is in `runs` now.
- `closet`: its barrel has 26 names only tests use. Narrow it when it is
  next touched; no split proposed.
- `onboarding`, `enrichment`, `email`, `products`, `notifications`,
  `weather`: no sign. `enrichment/model/` and `enrichment/rungs/` are
  folders inside one concern.

## Four knots the moves cut

Each is a small change inside the move's own PR, with behaviour unchanged.
The simulation fails without them.

1. **`queues.ts` splits three ways**: `handleQueueBatch` to `dispatch`,
   `oweInCore` to `ops/outbox`, the registry and `enrichmentDeps` to
   `ops/desk`. The Desk's retry reads the registry, so the file cannot go
   to the dispatch whole.
2. **`PUBLIC_ORIGIN` moves from `ops/og/site-head.ts` to `src/lib/`.**
   `sentry.ts` imports it, which would make `sentry` depend on
   `public-web`, which depends on `sentry`.
3. **`ops/index.ts` stops re-exporting the dispatch.**
4. **`PasswordCheck` is declared by `account`, its consumer.** It is the
   only thing `account`'s service code imports from `auth`, and it is a
   type. Declared in `account`, the `account`/`auth` pair is gone.

Not cut here, and named so it is not mistaken for done: `settleOutbox`
still defaults to every handler, so `ops/outbox` still imports `runs`,
`safety` and `weather`, and those three still cannot import the outbox
from service code. Passing the handler in is a behaviour-shaped change
and gets its own issue.

## Targets, in checkable terms

Each is a number the ratchet or the generated graph shows.

| target                                                               | today                                          | after wave 16                                                     |
| -------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| modules in a service-import cycle (the `modules` view)               | 6                                              | 3: `account`, `closet`, `feed` (0 if question 4 goes to dispatch) |
| units in a service-import cycle, each sub-module its own unit        | 6                                              | 0                                                                 |
| arrow `ops -> onboarding`                                            | drawn                                          | gone; nothing imports `dispatch`                                  |
| files `src/server.ts` imports past an `index.ts`                     | 7                                              | 0                                                                 |
| jobs handed to `handleScheduled` from another module (`DailyUpkeep`) | 7                                              | 0                                                                 |
| `safety/index.ts` names                                              | 224                                            | 96                                                                |
| `ops/index.ts` names                                                 | 41                                             | 21                                                                |
| service files left beside a parent's `index.ts`                      | `safety` 43, `feed` 52, `account` 36, `ops` 33 | only `inputs.ts` and the client-side helpers listed above         |

The every-import graph stays one cycle: the wiring arrows (the auth
gates, the error reporter) join everything, and that is not what this
work is for.

## The sub-module rule: a proposal for `.dependency-cruiser.cjs`

The owner's file; this lane edits it only on the owner's grant (question
5). dependency-cruiser is the right tool because it already enforces the
module boundary and the diagram reads imports through it; a test in
`test/architecture/` would be a second reader of the same imports.

```js
{
  name: "sub-modules-meet-at-the-door",
  severity: "error",
  comment:
    "Inside one module, a file in one folder reaches another folder only " +
    "through that folder's index.ts (design 240). Components are the " +
    "exception as importers: they import files, never a door, because a " +
    "door may reach env (the client-bundle rule).",
  from: {
    path: "^src/modules/([^/]+)/([^/]+)/",
    pathNot: "^src/modules/[^/]+/components/",
  },
  to: {
    path: "^src/modules/$1/(?!$2/)[^/]+/",
    pathNot: "^src/modules/[^/]+/[^/]+/index\\.ts$",
  },
},
```

Run from a scratch copy of the config against today's tree: **0
violations**, so it can land before any file moves. With the components
exemption taken out it fires three times, on `PhotoBlur.tsx` importing
`safety/blur/`, which shows the two captured groups match as intended.
Two edits to existing rules go with it:

- `no-cross-module-deep-imports`: `pathNot` becomes the two patterns
  `^src/modules/[^/]+/index\\.tsx?$` and
  `^src/modules/[^/]+/[^/]+/index\\.ts$`, so a sub-module's door is
  importable from another module (rule 3 above). As one pattern with an
  optional group, dependency-cruiser refuses it as an unsafe regular
  expression.
- `lib-browser-is-client-only` names server entries by path
  (`ops/(queues|scheduled).ts`, `account/(export-queue|export-build|export-sweep|purge).ts`).
  Its list gains the new homes alongside the old before the moves, so no
  move PR edits the owner's file, and loses the old ones after.

The gate's cruise does not follow type-only imports, so this rule does
not see one. The ratchet's reader does: a type-only import around a
module's door counts in "past the door". One between two sub-modules of
the same module is seen by neither.

## The ratchet

`test/architecture/module-shape.node.test.ts`, in the `node` project
because it reads the imports through dependency-cruiser, as the diagram
generator does (`scripts/diagrams/sources.ts`), and each barrel's names
through the TypeScript compiler. Four numbers:

| number        | of                    | what it counts                                                                                                               |
| ------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| fan-out       | each top-level module | the other modules its files import, sub-modules included                                                                     |
| door width    | each `index.ts`       | the names it exports                                                                                                         |
| past the door | each top-level module | imports of its service files from outside it, by anything but a route                                                        |
| files         | each unit             | the files in its folder, sub-modules' own files not counted (my addition: it is the number that says "propose a sub-module") |

Routes' imports of `functions.ts`, components and client-side helpers are
not counted: that is the documented way a route reaches a module, and a
count with no remedy would only block.

**A budget, and pins above it** (question 6). A number at or under its
budget moves freely. A number over it is pinned in
`test/architecture/module-shape.json` and may only go down: the test
fails when it rises, and also when it falls and the pin was not lowered,
so a gain cannot be given back. `npm run modules:pin` rewrites the file
from the imports and refuses to raise a pin or add one. A unit that leaves the file
has reached its budget; the file ends empty. Proposed budgets, set where
the nine modules that are not being split all pass: fan-out 7, door width
45, past the door 0, files 50. Over budget today: fan-out `account` 9,
`feed` 10, `ops` 8, `safety` 8; door `safety` 224; past the door
`account` 5, `auth` 1, `closet` 1, `feed` 1, `runs` 1; files `account`
60, `feed` 96, `safety` 86. `dispatch` will enter over the fan-out budget
by design, pinned at what it imports.

## Order of the moves (wave 16)

Before any move: the owner's answers below, then the rule and the ratchet
(this lane).

1. **A: `ops` and `dispatch`**, alone and first. It rewrites
   `src/server.ts`' imports, creates the module the others' jobs will
   move to, and cuts knots 1 to 3. The seven jobs stay handed in for now.
2. **B: `account`** (with knot 4), **C: `feed`**, **D: `safety`**, in
   parallel. Each stays inside its own `src/modules/<m>/`, its tests, and
   the routes that import its service files. No importer in another
   module changes (rule 4).
3. **E: the dispatch imports the doors.** `DailyUpkeep`'s seven hand-ins
   and `server.ts`' seven deep imports go; `auth/expired-rows` gets its
   door. After B and C.

What B, C and D share, so the lanes expect it:

- `docs/diagrams/structure.generated.c4`: regenerate after every rebase.
  A flow story's `// source:` comment that cites a moved file is updated
  in the PR that moves it (`npm run diagrams:stale` lists them).
- `src/server.ts`: B and C each change one import path on adjacent lines.
- `stryker.conf.json`: only A and D edit it (`ops` and `safety` are listed
  file by file; they become one glob per sub-module). `account` and `feed`
  are `**` globs and need no edit.
- Mutation: the push gate lists changed files with `--diff-filter=ACM`, so
  a renamed file is not mutated at push (read in guardrails-core, not
  measured). CI's `Mutation` shards for the moved module will miss their
  incremental cache once; a cold shard has taken two to three hours.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Forbidden-zone edits, each waiting on the owner: `.dependency-cruiser.cjs`
  (question 5), `CLAUDE.md` (the guidance paragraph, shown first).
- `docs/architecture.md` §Module dependency graph changes with the moves,
  in wave 16, not here.

## Test plan

- `test/scripts/module-shape.test.ts` (vitest, worker): the pure
  measuring and comparing. Fan-out counts a module once, from a
  sub-module's files too; a route's import, a door and wiring are not
  past the door; a rise fails; a fall without a lowered pin fails; a
  number at budget is free; a number over budget with no pin fails; the
  pin command lowers and refuses to raise or add.
- `test/scripts/module-doors.node.test.ts` (vitest, node): a door's
  names, and the two forms it refuses to count.
- `test/architecture/module-shape.node.test.ts` (vitest, node): today's
  tree against `module-shape.json`.
- The dependency-cruiser rule: run from a scratch config as above; once
  granted, a planted import across two sub-modules fails the commit gate
  and is removed (checked by hand, as design 143's rule was).

## The guidance: proposed wording for `CLAUDE.md`

Not committed to `CLAUDE.md` until the owner has seen it (#796 step 4).
It would sit in "Architecture rules", after the module bullets, and it
assumes questions 1 and 6 are answered as recommended.

> - **Sub-modules.** A folder in a module with its own `index.ts` is a
>   sub-module: the rest of the module, and other modules, reach its
>   files only through that `index.ts`. Propose one in your design doc
>   when your lane adds a concern with its own tables or vocabulary to a
>   module that already holds several, when the module ratchet
>   (`test/architecture/module-shape.node.test.ts`) would go over a
>   budget or a pin, or when you are about to hand a dependency in
>   through `src/server.ts` because a barrel cannot export it. A new
>   top-level module is for code that belongs to no area: ask the owner.
>   A pin is never raised to pass the test.

## Issues

- Refs #796 (stays open for step 5).
- Opens: `settleOutbox` takes its handler (the knot not cut); `runs`'
  `strava/` and `garmin/` as sub-modules; a client-side door for the
  helpers routes import past a barrel.

## Open questions

Each has a recommendation; none is decided.

1. **May another module import a sub-module's `index.ts`?** Recommended:
   yes. Without it the dispatch cannot import `account/purge` (the parent's
   barrel cannot export it without a cycle), and the Worker entry keeps
   handing jobs in. The alternative keeps doors private to their module
   and the seven hand-ins as they are.
2. **`dispatch` as a new top-level module?** Recommended: yes, and it is
   the only one. The cron and queue dispatch belongs to no area, and with
   it out, `ops` leaves the cycle. As `ops/dispatch` instead, the unit
   graph is the same but the `modules` view keeps `ops` in a cycle with
   everything the dispatch imports. The floor (outbox, Sentry) stays in
   `ops` either way: once the roof is gone, it imports nothing that
   imports it from service code.
3. **Do components move into the sub-modules?** Recommended: not in wave 16. They are half of each module's files, so the parents stay large
   (`feed` 52 files, `safety` 42), but moving them re-points 72 route
   imports and every component test, and changes no dependency. Do it as a second pass once the
   doors have settled, or say now and the move PRs carry it.
4. **`account/purge`: a sub-module, or one of the dispatch's jobs?**
   Recommended: a sub-module, by the owner's rule (it is account
   deletion). The cost is that the `modules` view keeps a three-module
   cycle (`account/purge` imports `feed`, which imports `account`); the
   unit graph has none. In `dispatch` the map has no cycle at all, and
   `account` no longer imports `feed`, `enrichment` or `weather`.
5. **The grant for `.dependency-cruiser.cjs`**: the new rule and the two
   edits above, in this lane, before the moves.
6. **The ratchet: budgets with pins, or every number pinned?** Recommended:
   budgets. Pinning every number means a small module cannot add one
   export without asking. Also for the owner to set or strike: the four
   budget values, and whether `files` is pinned at all.
7. **Names.** `dispatch`, `ops/edge`, `ops/daily`, `safety/rules`,
   `feed/following`, `account/data`, and `public-web` in both `ops` and
   `feed`, are working names.
