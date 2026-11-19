# Design: 240 module breakdown

> Over the template's one page on purpose: the tree is the deliverable
> (#796 step 1) and wave 16 dispatches the moves from it. The owner
> reviewed it on 2026-11-18; the answers are in the last section and the
> tree below is the approved one.

## Problem

Four modules (`safety`, `feed`, `account`, `ops`) are large and mixed, the
module graph is one cycle, and nothing measures either (#796). This doc
gives the sub-modules for each, the rule that keeps a sub-module behind
its `index.ts`, and a ratchet. Nothing moves in this lane: wave 16 moves
the files.

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
3. **A sub-module's door is public.** Another module may import
   `account/purge/index.ts`. This is what lets the dispatch take its jobs
   without the Worker entry handing them in.
4. **The parent's `index.ts` keeps exporting what other modules import
   today, re-exported from the doors, and gains nothing new.** So a move
   PR changes no importer in another module, and the four moves do not
   edit each other's files. New imports use the narrowest door; the
   parent's barrel only shrinks.
5. **Components move with the code whose data they show; they never
   import a door.** A sub-module's screens live in its own `components/`
   folder. A component imports files directly, in its own sub-module or
   another's: a door may reach `env`, and a component that imports one by
   value puts server code in the client bundle, which only `npm run
build` sees. So the rule exempts every `components/` folder as an
   importer, and a door never re-exports a component for another
   sub-module's use. What stays beside the parent's `index.ts`:
   `functions.ts` (four architecture tests, `knip.json`, a
   dependency-cruiser rule and the mutation config's negations all name
   `src/modules/*/functions.ts`), `inputs.ts`, the client-side helpers
   routes import, and the few pieces with no data of their own that
   several sub-modules' screens use.

## The tree

Sizes are files after the move (approximate where a file splits).
"Imports" is service code, at the doors. Each list was simulated over
today's import graph: the sub-modules of each module have no cycle
between them. Components are listed without their folder: each goes in
its sub-module's `components/`.

### `ops`, and the new top-level module `dispatch`

`ops` is a floor seven modules import and a roof that imports eight. The
roof is the one piece of code that by its nature imports every area and is
imported by none, so it belongs to no area. It is the only new top-level
module.

| unit             | service files                                                                                                                                                                             | components                                                       | files | imports                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----- | ----------------------------------------------------------------------- |
| **`dispatch`**   | `scheduled.ts`; `handleQueueBatch` and its consumers from `queues.ts`                                                                                                                     |                                                                  | 2     | every area's doors; nothing imports it but `server.ts`                  |
| `ops/sentry`     | `sentry.ts`                                                                                                                                                                               |                                                                  | 1     | nothing                                                                 |
| `ops/outbox`     | `outbox.ts`, `outbox-handlers.ts`, and `oweInCore` from `queues.ts`                                                                                                                       |                                                                  | 2     | `sentry`; `email`, `runs`, `safety`, `weather`                          |
| `ops/edge`       | `body-cap.ts`, `secure-response.ts`, `security-headers.ts`, `inline-script-hashes.ts`, `csp-report.ts`, `turnstile.ts`                                                                    |                                                                  | 6     | `sentry`, `public-web`; `email`, `runs`                                 |
| `ops/public-web` | `public-cache.ts`, `edge-purge.ts`, `public-photos.ts`, `og/**`                                                                                                                           |                                                                  | 9     | `sentry`; `email`, `safety`                                             |
| `ops/speed`      | `timing.ts`, `vitals.ts`, `vitals-queries.ts`, `vitals-rollup.ts`, `speed-digest.ts`, `speed-hourly.ts`, `perf-checks.ts`                                                                 |                                                                  | 7     | `sentry`                                                                |
| `ops/desk`       | `desk.ts`, `desk-gate.ts`, `digest-marks.ts`, `gave-up.ts`, `owner-handles.ts`, `crons.ts`, `health.ts`, `deployment-config.ts`, the queue registry and `enrichmentDeps` from `queues.ts` | `DeskPage`, `DeskShell`, `DeskSignOut`, `ReviewHeading`, `Today` | 14    | `outbox`, `sentry`; `email`, `enrichment`, `products`, `runs`, `safety` |
| `ops/daily`      | `digest-email.ts`, `removal-reminders.ts`, `media-backup.ts`                                                                                                                              |                                                                  | 3     | `desk`, `outbox`, `sentry`; `email`, `safety`                           |
| `ops` (parent)   | `index.ts`, `functions.ts`, `inputs.ts`                                                                                                                                                   |                                                                  | 3     |                                                                         |

`ops/index.ts` still exports the 21 names other modules use (the outbox's
five, `captureException`, Turnstile's four, the two purges, `oweInCore`,
the seven public-page names `feed` uses, and `ExportConsumers` until step
E below removes the hand-in). It stops exporting `handleScheduled`,
`handleQueueBatch` and the 18 names only the Worker entry and routes use:
those import the door (`dispatch`, `ops/edge`, `ops/speed`). One-file
`ops/sentry` is deliberate: seventeen units import it and it must import
nothing.

### `safety`

| unit               | service files                                                                                                                                                                          | components                                                                                                                                                                             | files | imports                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------ |
| `safety/rules`     | `contracts.ts`, `visibility.ts`, `admin.ts`, `moderation-actions.ts`, `kit-cache-tags.ts`, `kit-pieces.ts`, `denylist.ts`                                                              |                                                                                                                                                                                        | 7     | nothing                                                            |
| `safety/limits`    | `breakers.ts`, `at-once.ts`, `takedown-limits.ts`                                                                                                                                      |                                                                                                                                                                                        | 3     | `rules`                                                            |
| `safety/notices`   | `notices.ts`, `notice-copy.ts`                                                                                                                                                         | `NoticeBand`                                                                                                                                                                           | 3     | `rules`; `notifications`                                           |
| `safety/review`    | `review.ts`, `review-audit.ts`, `other-photos.ts`, `photo-matches.ts`, `removed-fingerprints.ts`, `release.ts`, `withdrawn.ts`, `desk-kit.ts`, `duplicates.ts`, `duplicates-report.ts` | `ReviewQueue`, `RemovalDecision`, `WhoReported`, `PhotoMatches`, `OtherPhotos`, `ReleaseHolds`, `DeskKit`, `DeskDuplicates`, `DeskCorrections`, `kit-origin.ts`, `review-photo-src.ts` | 21    | `rules`, `limits`, `notices`; `weather`                            |
| `safety/screening` | `screening.ts`, `thresholds.ts`, `retry.ts`, `stuck.ts`, `classifier/**`                                                                                                               |                                                                                                                                                                                        | 6     | `rules`, `limits`, `notices`, `review`                             |
| `safety/reports`   | `reports.ts`, `reportable.ts`, `blocks.ts`, `retention.ts`, `removal-reminders.ts`                                                                                                     | `ReportSheet`, `ReportAffordance`, `BlockedRunners`                                                                                                                                    | 8     | `rules`, `limits`, `notices`, `review`, `screening`; `email`       |
| `safety/takedowns` | `takedown-requests.ts`, `request-subject.ts`, `requester-key.ts`, `copyright-holds.ts`, `run-removals.ts`, `quarantine.ts`                                                             | `RemovalRequests`, `Takedown`, `TakedownConfirm`, `TakedownRequest`, `CopyrightHolds`, `QuarantineRecords`, `RunRemovals`                                                              | 13    | `rules`, `limits`, `notices`, `review`, `reports` (types); `email` |
| `safety/runners`   | `bans.ts`, `ban-gate.ts`, `account-flags.ts`, `runners.ts`, `rename.ts`                                                                                                                | `DeskRunners`, `NotRenamedBand`, `AccountClosed`                                                                                                                                       | 8     | `rules`, `notices`; `email`, `runs`                                |
| `safety/blur`      | `blur/**` as it is today: client-side, and its door reaches no `env`                                                                                                                   | `PhotoBlur`                                                                                                                                                                            | 6     | nothing                                                            |
| `safety` (parent)  | `index.ts`, `functions.ts`, `inputs.ts`                                                                                                                                                | shared, in `components/`: `DeskForm`, `DueClock`, `StatutoryLine`, `ElsewhereHelp`, `short-id.ts`, `use-settled.ts`, `use-focus-when.ts`, `counted.ts`                                 | 11    |                                                                    |

`safety/index.ts` drops to the 96 names another module imports; tests
import the door or the file. No new top-level module: everything here is
one area. `safety/rules` is the part most of the app depends on (the
visibility rule, the denylist, the vocabulary), and it imports nothing.

### `feed`

| unit              | service files                                                                                                                                                                                               | components                                                                                                                                                                                                                                                                     | files | imports                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ----------------------------------------------------------------------------------------------- |
| `feed/conditions` | `conditions.ts`, `judged-conditions.ts`, `units.ts`, `strip.ts`, `groups.ts`, `run-conditions-entry.ts`, `own-history.ts`, `garment-names.ts`, `count-where.ts`, `entries-query.ts`, `runner-visibility.ts` | `ConditionsCell`                                                                                                                                                                                                                                                               | 12    | `account`, `safety`, `weather`                                                                  |
| `feed/entries`    | `entries.ts`, `share-default.ts`, `reactions.ts`, `retract.ts`, `photos.ts`, `band-signals.ts`, `band-runs.ts`, `chips.ts`                                                                                  | `VerdictForm`, `VerdictChips`, `EffortField`, `SpecificsPage`, `SpecificsSheet`, `BandHistory`, `NotedReceipt`, `BandRunsCard`, `EntryDetail`, `OwnerAudience`, `UsefulButton`, `useful-reaction.ts`, `RetractEntry`, `PhotoPager`, `PhotoSlot`, `VerdictBadge`, `UnderReview` | 25    | `conditions`, `public-web`; `account`, `closet`, `email`, `notifications`, `ops`, `safety`      |
| `feed/attach`     | `attach-context.ts`, `picker.ts`, `prefill.ts`, `backlog.ts`                                                                                                                                                | `AttachKit`, `KitPicker`, `ThisRunCard`, `BackToRun`, `PushPage`                                                                                                                                                                                                               | 9     | `conditions`, `entries`; `closet`, `runs`                                                       |
| `feed/consensus`  | `consensus.ts`, `bar-share.ts`, `compact-conditions.ts`, `home.ts`, `garment-bands.ts`, `coverage.ts`, `ladder-read.ts`                                                                                     | `ConditionsTab`, `CompactConditions`                                                                                                                                                                                                                                           | 9     | `conditions`; `ops`, `safety`                                                                   |
| `feed/following`  | `feed.ts`, `follows.ts`, `follow-notices.ts`, `search.ts`, `profiles.ts`                                                                                                                                    | `Feed`, `PostCard`, `FlushBand`, `Follow`, `OtherProfile`, `OwnProfile`, `RunnerAtHandle`, `RunnerSearch`, `RunRow`, `Avatar`, `Handle`, `BackToFeed`, `ReportFoot`, `SpokenDistance`                                                                                          | 19    | `conditions`, `consensus`, `entries`, `public-web`; `account`, `notifications`, `ops`, `safety` |
| `feed/public-web` | `public-kit.ts`, `public-kit-shape.ts`, `public-profile.ts`, `public-profile-shape.ts`                                                                                                                      | `PublicFrame`, `PublicKit`, `PublicProfile`                                                                                                                                                                                                                                    | 7     | `conditions`; `account`, `closet`, `ops`, `safety`                                              |
| `feed/moderation` | `moderation.ts`, `garment-moderation.ts`, `missing-photo.ts`, `run-day.ts`, `removal-requests.ts`                                                                                                           |                                                                                                                                                                                                                                                                                | 5     | `conditions`, `entries`; `email`, `notifications`, `ops`, `safety`                              |
| `feed` (parent)   | `index.ts`, `functions.ts`, `inputs.ts`, and the helpers routes import: `route-decisions.ts`, `redirect.ts`, `attach-rules.ts`, `kit-push.ts`, `posted.ts`, `noted.ts`, `counted.ts`                        |                                                                                                                                                                                                                                                                                | 10    |                                                                                                 |

`feed/index.ts` keeps its 10 used names. No new top-level module.

### `account`

| unit                   | service files                                                                                                                       | components                                                                                        | files | imports                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------- |
| `account/terms`        | `terms-acceptance.ts`, `legal-markdown.ts`, `legal.ts`, `licence-text.ts`, `open-source.ts`, `open-source-search.ts`                | `LegalPage`, `ReadingFrame`, `OpenSourcePage`, `TermsPrompt`, `AccountWhileBehind`                | 11    | `notifications`, `runs`                                                             |
| `account/verification` | `verification.ts`, `email-links.ts`                                                                                                 | `ChangeEmail`, `CheckEmail`, `ConfirmEmailBand`, `ConfirmEmailSheet`, `ResendLink`, `LinkLanding` | 8     | `email`, `ops`                                                                      |
| `account/handles`      | `username.ts`, `handle-screen.ts`, `handle-review.ts`, `handle-rescreen.ts`, `handle-copy.ts`                                       | `HandleForm`, `HandleStep`, `OnboardingHandle`                                                    | 8     | `terms`; `ops`, `safety`                                                            |
| `account/access`       | `access.ts`, `access-endpoint.ts`, `invites.ts`, `answered-requests.ts`, `closed-addresses.ts`, `accounts.ts`                       | `DeskAccess`, `DeskCodes`, `desk-rows`, `RequestAccess`                                           | 10    | `terms`, `verification` (types); `email`, `ops`                                     |
| `account/data`         | `data-exports.ts`, `export-queue.ts`, `deletion.ts`, `account-view.ts`                                                              | `DeleteAccount`, `Leaving`, `ExportRow`                                                           | 7     | `terms`, `handles`, `verification` (types); `email`, `notifications`, `ops`, `runs` |
| `account/export-build` | `export.ts`, `export-files.ts`, `export-format.ts`, `export-sheets.ts`, `export-build.ts`, `export-sweep.ts`                        |                                                                                                   | 6     | `data`; `email`, `ops`, `weather`                                                   |
| `account/purge`        | `purge.ts`                                                                                                                          |                                                                                                   | 1     | `access`, `data`; `email`, `enrichment`, `feed`, `ops`, `runs`, `safety`, `weather` |
| `account` (parent)     | `index.ts`, `functions.ts`, `inputs.ts`, `route-decisions.ts`, `theme.ts`, `theme-answer.ts`, `use-go-home.ts`, `use-saved-page.ts` | shared, in `components/`: `ActionCard`                                                            | 9     |                                                                                     |

`account/index.ts` keeps its 16 used names. `export-build` and `purge` are
their own doors, never re-exported by the parent, for the two reasons
`docs/architecture.md` already gives: `purge` imports `feed`, which imports
`account`, and the build's zip library must stay out of every route's
reach. The purge stays in `account`: it is account deletion, it names
thirty tables and calls seven modules' deletes, and wherever it lived it
would sit above every area. Keeping it here keeps `dispatch` to deciding
what runs when.

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

| target                                                               | today                                          | after wave 16                                                |
| -------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| modules in a service-import cycle (the `modules` view)               | 6                                              | 3: `account`, `closet`, `feed`                               |
| units in a service-import cycle, each sub-module its own unit        | 6                                              | 0                                                            |
| arrow `ops -> onboarding`                                            | drawn                                          | gone; nothing imports `dispatch`                             |
| files `src/server.ts` imports past an `index.ts`                     | 7                                              | 0                                                            |
| jobs handed to `handleScheduled` from another module (`DailyUpkeep`) | 7                                              | 0                                                            |
| `safety/index.ts` names                                              | 224                                            | 96                                                           |
| `ops/index.ts` names                                                 | 41                                             | 21                                                           |
| the largest unit, in files                                           | `feed` 96, `safety` 86, `account` 60, `ops` 46 | `feed/entries` 25; no `files` pin is left                    |
| service files left beside a parent's `index.ts`                      | `safety` 43, `feed` 52, `account` 36, `ops` 33 | only `inputs.ts` and the client-side helpers the tables list |

The three-module cycle that stays on the `modules` view is the view
drawing `account` as one box: `account/purge` imports `feed`, and `feed`
imports `account/handles`. No unit depends on itself. If the map should
show that, draw a split module by its sub-modules; do not move the purge.

The every-import graph stays one cycle: the wiring arrows (the auth
gates, the error reporter) join everything, and that is not what this
work is for.

## The sub-module rule, in `.dependency-cruiser.cjs`

The owner's file. The owner granted these edits on 2026-11-18, and they
land with the ratchet, before any file moves. dependency-cruiser is the
right tool because it already enforces the module boundary and the
diagram reads imports through it; a test in `test/architecture/` would be
a second reader of the same imports.

```js
{
  name: "sub-modules-meet-at-the-door",
  severity: "error",
  from: {
    path: "^src/modules/([^/]+)/([^/]+)/",
    pathNot: [
      "^src/modules/[^/]+/components/",
      "^src/modules/[^/]+/[^/]+/components/",
    ],
  },
  to: {
    path: "^src/modules/$1/(?!$2/)[^/]+/",
    pathNot: "^src/modules/[^/]+/[^/]+/index\\.ts$",
  },
},
```

- **No violations on today's tree.** Checked with planted files, since
  removed: an import of `runs/parsers/shared.ts` from `runs/garmin/` is
  refused, the same import from `runs/garmin/components/` passes, and an
  import of `runs/parsers` through its `index.ts` passes.
- **`no-cross-module-deep-imports`** allows a sub-module's `index.ts` as
  well as a module's (rule 3 above). Its `pathNot` is two patterns:
  dependency-cruiser refuses the one pattern with an optional group as an
  unsafe regular expression. Planted from `weather/`: the door passes,
  the file behind it is refused.
- **Not granted, and wave 16's to ask for:** `lib-browser-is-client-only`
  names server entries by path (`ops/(queues|scheduled).ts`,
  `account/(export-queue|export-build|export-sweep|purge).ts`). Each of
  those files moves, so the list needs the new paths, and that edit needs
  its own grant. Lane A asks for `dispatch/`'s, lane B for `account`'s.

The gate's cruise does not follow type-only imports, so this rule does
not see one. The ratchet's reader does: a type-only import around a
module's door counts in "past the door". One between two sub-modules of
the same module is seen by neither.

## The ratchet

`test/architecture/module-shape.node.test.ts`, in the `node` project
because it reads the imports through dependency-cruiser, as the diagram
generator does (`scripts/diagrams/sources.ts`), and each barrel's names
through the TypeScript compiler. Four numbers:

| number        | of                    | what it counts                                                                                                                           |
| ------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| fan-out       | each top-level module | the other modules its files import, sub-modules included                                                                                 |
| door width    | each `index.ts`       | the names it exports                                                                                                                     |
| past the door | each top-level module | imports of its service files from outside it, by anything but a route                                                                    |
| files         | each unit             | the files in its folder, sub-modules' own files not counted (not one of #796's three: it is the number that says "propose a sub-module") |

Routes' imports of `functions.ts`, components and client-side helpers are
not counted: that is the documented way a route reaches a module, and a
count with no remedy would only block.

**A budget, and pins above it.** A number at or under its
budget moves freely. A number over it is pinned in
`test/architecture/module-shape.json` and may only go down: the test
fails when it rises, and also when it falls and the pin was not lowered,
so a gain cannot be given back. `npm run modules:pin` rewrites the file
from the imports and refuses to raise a pin or add one. A unit that leaves the file
has reached its budget; the file ends empty. The budgets, set where
the nine modules that are not being split all pass: fan-out 7, door width
45, past the door 0, files 50. Over budget today: fan-out `account` 9,
`feed` 10, `ops` 8, `safety` 8; door `safety` 224; past the door
`account` 5, `auth` 1, `closet` 1, `feed` 1, `runs` 1; files `account`
60, `feed` 96, `safety` 86. `dispatch` will enter over the fan-out budget
by design, pinned at what it imports.

## Order of the moves (wave 16)

The rule and the ratchet land first (this lane's second PR).

1. **A: `ops` and `dispatch`**, alone and first. It rewrites
   `src/server.ts`' imports, creates the module the others' jobs will
   move to, and cuts knots 1 to 3. The seven jobs stay handed in for now.
2. **B: `account`** (with knot 4), **C: `feed`**, **D: `safety`**, in
   parallel. Each stays inside its own `src/modules/<m>/`, its tests, and
   the routes that import its files. No importer in another module
   changes (rule 4).
3. **E: the dispatch imports the doors.** `DailyUpkeep`'s seven hand-ins
   and `server.ts`' seven deep imports go; `auth/expired-rows` gets its
   door. After B and C.

Each of A to D moves its components in the same PR as its service code
(the owner's answer to question 3), so nearly every file of the module
changes path: `feed` 86 of 96, `safety` 75 of 86, `account` 51 of 60,
`ops` 43 of 46. A move PR changes paths and imports and nothing else; a
behaviour change found on the way is its own issue.

What the lanes share, so they expect it:

- `docs/diagrams/structure.generated.c4`: regenerate after every rebase.
  A flow story's `// source:` comment that cites a moved file is updated
  in the PR that moves it (`npm run diagrams:stale` lists them).
- `src/server.ts`: B and C each change one import path on adjacent lines.
- `stryker.conf.json`: only A and D edit it (`ops` and `safety` are listed
  file by file, `safety/components/**/*.ts` among them; they become one
  glob per sub-module). `account` and `feed` are `**` globs and need no
  edit.
- Architecture tests that name a component by its path
  (`primitive-restrictions`, `one-h1-per-route`, `targets-and-focus`,
  `failure-path-is-static`, `routes-stamp-hydration`,
  `server-functions-are-glue`): each move PR updates the paths of its own
  module's components. `docs/contracts.md` §Component convention says
  components live in `modules/<lane>/components/`; the first move PR to
  merge rewrites that line.
- `.dependency-cruiser.cjs`: `lib-browser-is-client-only`'s path list, as
  above. A and B each ask the owner for their part.
- Mutation: the push gate lists changed files with `--diff-filter=ACM`, so
  a renamed file is not mutated at push (read in guardrails-core, not
  measured). CI's `Mutation` shards for the moved module, its `.tsx`
  shard included, will miss their incremental cache once; a cold shard
  has taken two to three hours.
- `test/architecture/module-shape.json`: each move lowers its own
  module's pins with `npm run modules:pin`; A adds `dispatch`'s fan-out
  pin by hand, which the owner's answer to question 2 covers.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Forbidden-zone edits, both granted by the owner on 2026-11-18 and
  landing with the ratchet: `.dependency-cruiser.cjs` (the rule above)
  and `CLAUDE.md` (the guidance paragraph).
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
- The dependency-cruiser rule: planted imports, as above, run against the
  real config and removed (checked by hand, as design 143's rule was).

## The guidance: proposed wording for `CLAUDE.md`

Approved by the owner as written, 2026-11-18 (#796 step 4). It sits in
"Architecture rules", after the module bullets, and lands with the
ratchet, since it names the ratchet's test.

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
- Opens: #886 (`settleOutbox` takes its own handler, the knot not cut),
  #887 (`runs`' `strava/` and `garmin/` as sub-modules), #888 (a
  client-safe door for the helpers routes import past a barrel).

## The owner's answers (2026-11-18)

Asked in lane 15b's session and recorded on #796. The decision rows in
`docs/decisions.md` are the coordinator's to write.

1. **May another module import a sub-module's `index.ts`?** Yes.
2. **`dispatch` as a new top-level module?** Yes, and it is the only one.
   The floor (outbox, Sentry, Turnstile) stays in `ops` as sub-modules.
3. **Do components move into the sub-modules?** Yes, in wave 16, with the
   service code. The recommendation had been a later pass; the tree above
   places every component, and the rule exempts a sub-module's
   `components/` folder as an importer.
4. **`account/purge`: a sub-module, or one of the dispatch's jobs?** A
   sub-module of `account`.
5. **The grant for `.dependency-cruiser.cjs`**: given, for the new rule
   with both `components/` exemptions, and for
   `no-cross-module-deep-imports` allowing a sub-module's door.
6. **The ratchet**: budgets with pins, at fan-out 7, door width 45, past
   the door 0, files 50, with the files count kept.
7. **Names**: as in the tree above. A rename later is a move PR of its
   own.
