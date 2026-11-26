# Design: 268 a home for the Desk

> Design 261 §D, row D4 (#1051), from the owner's ruling 14. No code
> changes here. Over the template's page on purpose: the file table and
> the measurements are the deliverable.

## Problem

The Desk is the operator's surface (`/desk`, D-35). Design 260 found it
has no module: one route folder wired from four modules. Ruling 14 asks
for a design that gives it a home, and 261 names the first step: draw a
Desk decision on a photo. This doc draws it, says where the Desk's pieces
live, measures where they could live, and asks the owner to choose.

## The flow

`docs/diagrams/flows/desk-review.c4`, three views:

- `deskReviewStory` (6 steps): the operator opens Review, looks at the
  held photo through its own route, and decides with the row as the page
  showed it.
- `deskReviewDecision` (11 steps, three frames): Approve, Remove,
  Quarantine.
- `deskReviewRecovery` (7 steps): a stale page, a quarantine its owner's
  delete beat, a failed fast path, an unlisted quarantine copy, a failed
  page purge.

`model.c4` gains three entry points: `cf.app.safety.reviewQuery`,
`cf.app.feed.decideReview` and `cf.app.feed.entries.reviewPhoto`.

What it shows: one decision runs through four modules. The page's read is
`safety`'s (`reviewQueueQuery`). The button is `feed`'s
(`decideReviewAction`). An Approve is written by `safety`
(`resolveReview`). A Remove or a Quarantine is written by `feed/moderation`
(`moderateContent`), with `safety`'s statements and `feed/entries`'
deletes in one batch, then `ops`' outbox and purge. The batch writes
`entry_photos`, `photo_screenings`, `review_queue`, `moderation_actions`,
`notifications`, `outbox` and, by reason, `removed_fingerprints` or
`quarantined_content`. **So the decisions cannot move to a Desk module.**
Each one is carried out where its tables' owner is, which ruling 5's owner
map will enforce and ruling 6 keeps. A home for the Desk can only hold its
pages, its wiring and its own services.

## Where the Desk's pieces live today

Measured at `740f4f85`.

| piece                         | where                                                                                                                                                   | count                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Routes                        | `src/routes/desk/`                                                                                                                                      | 10 files                    |
| Server functions              | `safety/functions.ts` 20, `account/functions.ts` 6, `feed/functions.ts` 5, `ops/functions.ts` 5                                                         | 36                          |
| Pages only the Desk renders   | `safety/review/components` 11, `safety/components` 6, `safety/takedowns/components` 5, `safety/runners/components` 2, `account/access/components` 3     | 27 files                    |
| The frame                     | `ops/desk/components`: `DeskPage`, `DeskShell`, `DeskSignOut`, `ReviewHeading`, `Today`                                                                 | 5 files                     |
| The Desk's services           | `ops/desk`: `desk.ts` (Today, `isOperator`), `gave-up.ts`, `desk-gate.ts`, `owner-handles.ts`, `digest-marks.ts`; `ops/daily`: the digest and reminders | 7 files                     |
| **Not the Desk, in its unit** | `ops/desk`: `crons.ts`, `queues.ts`, `health.ts`, `deployment-config.ts`                                                                                | 4 files, 6 of the door's 18 |
| Decisions                     | `feed/moderation`, `safety/review`, `safety/takedowns`, `safety/runners`, `account/access`, `products`' corrections                                     | stay with their tables      |

The pages were found by following component imports from
`src/routes/desk/`; two shared ones (`SignOutButton`, `use-settled.ts`) are
left out. The four registry files are what `dispatch` and `/api/health`
import from `ops/desk`; nothing outside `ops` imports the Desk part.

## The candidate homes

Numbers from the ratchet's own reader (`scripts/modules/shape.ts` over
`readShapeFacts()`), with the files remapped. "Names onto doors" counts
the distinct names a moved file would import from another module's
non-door file, which ruling 2 sends through a door; it is an upper bound,
since some are on a sub-module door already.

| option                            | moves                                                              | fan-out                                        | doors                                                                                              | files                                       |
| --------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| (a) Name it in place              | nothing                                                            | no change                                      | no change                                                                                          | no change                                   |
| (b) (a), and the registries leave | 4 files to a new unit `ops/platform`                               | no change                                      | `ops/desk` 18 → 12, `ops/platform` 6                                                               | `ops/desk` 15 → 11, `ops/platform` 5        |
| (c) The pages into `ops/desk`     | 27 page files                                                      | `ops` 6 → 7                                    | 36 imports past doors (safety 33, account 3); up to 70 names onto `safety`'s and `account`'s doors | `ops/desk` 15 → 42, `safety/review` 23 → 12 |
| (d) A top-level `desk` module     | 27 pages, the Desk part of `ops/desk`, the Desk's server functions | `desk` 9, over the budget of 7; `safety` 8 → 7 | up to 118 names onto doors, 23 of them from `safety`'s root files                                  | `desk` 38, `ops/desk` 15 → 6                |

- **(a)** A section "The Desk" in `docs/architecture.md`: the table above,
  the rule for where a Desk piece goes (a decision with its tables, a page
  beside the vocabulary it shows, its wiring in that module's
  `functions.ts`, the frame in `ops/desk`), and links to the drawn
  decisions. `src/routes/desk/` stays the one place an operator's pages
  are listed.
- **(b)** (a), and `ops/desk` holds only the Desk. The four registries go
  to `ops/platform`, which imports `isOperator` through `ops/desk`'s door
  for `/api/health`'s detail. The cost is paths: 40 mentions in 28 files,
  10 of them `// source:` lines in 7 flows. Four of the files need the
  owner: `wrangler.jsonc` (two comments), `guardrails.config.json` (a
  grant's key names `health.ts`), `scripts/diagram-structure.ts` and
  `test/architecture/d1-access.test.ts` (protected paths). Law 10's text in
  `.claude/rules/server.md` changes with them.
- **(c)** One folder for the pages, and nothing else. The wiring stays in
  four `functions.ts`. The names the pages read today through their own
  module would cross a door.
- **(d)** A composition root, as `dispatch` is. Ruling 10 took `dispatch`
  out of the fan-out budget; `desk` would need the same, and D-201, which
  names `dispatch` as the only module that composes, would change. The 23
  names from `safety`'s root are mostly its input schemas; ruling 11 pins
  `safety`'s parent door, so they would move with the wiring. Ruling 9
  sends the Corrections page and its three functions to `products`, so the
  home would hold 33 of the 36.

## How each meets design 261

No option changes a ruling. All four keep B3's moves (ruling 9): the form
pieces go to `src/ui` either way, and (c) and (d) lose the Corrections page
to `products`. B7 shrinks `ops/desk/gave-up.ts`; no option moves it
otherwise.

- (a) edits `docs/architecture.md`, which A1 edits too: not beside A1.
- (b) edits every importer of the registries, so it runs after C7 (C5 to
  C7 each run alone), and not beside B5 and B6
  (`src/modules/dispatch/scheduled.ts` imports `cronNameFor`) or B12 (both
  add an `ops` sub-module and a `structure.words.json` line).
- (c) and (d) edit the importers of 27 page files and up to 118 door
  names: after C7, and each alone.

## Diagrams

- **This doc:** the new flow above, and its three elements and ten arrows
  in `model.c4`. `docs/architecture.md` gains links to the three views in
  the lane that writes the section.
- **(b):** `npm run diagrams:generate` adds `cf.app.ops.platform`, with a
  line in `structure.words.json`. The 10 `source:` lines citing
  `ops/desk/crons.ts` or `ops/desk/queues.ts` are updated; the skill
  `architecture-diagrams` names both paths too.
- **(c), (d):** every flow citing a moved file is updated, and (d) adds a
  module to the `modules` view.

## Build plan, for (b)

1. **D4-a (S, docs).** The `docs/architecture.md` section, with links to
   `deskReviewStory`, `deskReviewDecision` and `removalDecision`. Not
   beside A1.
2. **D4-b (M).** After C7. `git mv` the four files to
   `src/modules/ops/platform/` with an `index.ts` of their six names; drop
   them from `ops/desk/index.ts`; fix the importers (two in `dispatch`,
   `/api/health`, `scripts/diagram-structure.ts`, six test files); the path text
   in the rest; `stryker.conf.json`'s entries; the grant's key, on the
   owner's word. `npm run diagrams:generate`, the flows' source lines,
   `npm run build`. Done when `npm test`, `diagrams:check` and the build
   pass and `npm run modules:pin -- --print` reads `ops/desk` 12 and
   `ops/platform` 6 on the doors.

Behaviour-neutral: no runtime path, binding or table changes.

## Contract touches

- Schema changes: **none**.
- New route files: **none**.
- New bindings, queues or crons: **none**. (b) moves the registries that
  name them; `test/bindings-conformance.test.ts` follows the path.
- Screens: none.

## Test plan

No code changes here. `test/architecture/diagram-sources.node.test.ts`
passes on the new flow. The lanes move tests with their files and add
none; `test/architecture/module-shape.node.test.ts` checks the numbers.

## Issues

- Refs #1051 (261 §D, D4). The lane of the chosen option closes it.
- Opens nothing.

## Open questions

1. **Where does the Desk live?** (b) is recommended: the flow shows a
   decision can only be carried out where its tables' owner is, so a Desk
   module would hold pages and wiring alone, and (c) and (d) buy that one
   folder with 70 to 118 names on doors that rulings 2 and 11 are
   narrowing. (b) makes `ops/desk` mean the Desk for the cost of path
   edits and four grants.
   - **(b) Name it, and clear `ops/desk`.** The architecture section, and
     the four registries to `ops/platform`. Recommended.
   - **(a) Name it in place.** The architecture section only.
   - **(c) The pages into `ops/desk`.** 27 page files move; the wiring
     stays in four modules.
   - **(d) A top-level `desk` module.** Pages, wiring and the Desk's
     services in one module outside the fan-out budget, with D-201
     amended.
