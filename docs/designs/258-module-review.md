# Design: 258 architecture and module review

> #850 step 4b. Read-only: this doc is the lane's one output, and no file
> under `src/`, `test/` or `scripts/` changes. Over the template's one page
> on purpose, as design 240 was: the ranked list is the deliverable, and the
> restructure lanes are dispatched from it after #850's step 4.

## Problem

Wave 16 split four modules into sub-modules and added a ratchet (design
240). Seven numbers are still pinned over their budgets in
`test/architecture/module-shape.json`, and nothing has asked whether each
is a debt with a remedy or the shape the module should have. This review
measures every door, every cross-module import and the helpers beside the
schema at one commit, and proposes what should move, in ranked order.

## Scope

This review takes the fourteen modules as given. Each reader was assigned
existing modules, and each finding is measured against today's doors. It
did not ask whether those fourteen are the right decomposition, did not
measure which module reads and writes which table, and had no reader
derive the areas from the tables, the vocabulary and the drawn flows
without the layout in front of them. The two larger moves it weighed
(`feed/moderation` into `safety`, a new top-level module) are under
Considered and rejected, each judged as one move, not as part of another
layout.

The owner asked for that second review on 2026-11-23, as its own design
doc, before any substantial restructure. Until it reports:

- proposals 13 and 14 wait. They are the two large relabels, and a
  different decomposition would redo them;
- proposal 15's question, where the counters live, is one of the second
  review's;
- the other proposals each move a file towards the module that owns its
  table or its words, and stand.

## How it was measured

Pinned at `ac2a22eecc3885fbc49eb29877abe66ff6155558`. Every `path:line`
below is at that commit, and every command runs at the repo root there.

- The ratchet's own numbers: `npm run -s modules:pin -- --print`.
- Two tables from a throwaway parser script (appendix): `doors.tsv`, one
  row per exported name per door with each consumer, and `edges.tsv`, one
  row per import that crosses a module boundary. `$F` below is the folder
  the script wrote to. Its door widths, fan-out and past-door counts equal
  the ratchet's for all 60 doors and 14 modules, so the two readings agree
  on what an import is.
- Six readers (safety; feed; account with auth; dispatch with ops; closet,
  products and enrichment; lib, db and the rest) each answered the five
  questions for their area. One synthesis merged their 37 candidates into
  20 proposals and re-ran each number. One challenger argued against every
  proposal and re-measured it independently. The top counts were then
  re-run by hand.

Not run: dependency-cruiser, knip, lint, tests, the build or Stryker on
any proposed result. Every "no new cycle" below is read from import lines,
and each lane's first step is to confirm it.

**One test is applied to every proposal: after the move, do the same
consumers depend on the same names and the same tables?** If so it is a
relabel, whatever number falls. Relabels are ranked under moves that end a
dependency, and are marked.

## Findings

### 1. Doors

Each module's `index.ts`
(`awk -F'\t' '$1 ~ /^src\/modules\/[a-z]+\/index\.ts$/' $F/doors.tsv`,
grouped by door; a unit is a module, a sub-module, a route folder or a
file outside both):

| door            | names | no source consumer | exactly one consuming unit |
| --------------- | ----- | ------------------ | -------------------------- |
| `safety`        | 95    | 1                  | 75                         |
| `closet`        | 45    | 25                 | 18                         |
| `account`       | 35    | 19                 | 14                         |
| `products`      | 34    | 13                 | 21                         |
| `email`         | 28    | 5                  | 11                         |
| `ops`           | 24    | 0                  | 13                         |
| `weather`       | 23    | 6                  | 10                         |
| `enrichment`    | 20    | 6                  | 14                         |
| `auth`          | 19    | 5                  | 7                          |
| `runs`          | 16    | 0                  | 13                         |
| `feed`          | 15    | 5                  | 10                         |
| `notifications` | 15    | 6                  | 4                          |
| `onboarding`    | 9     | 3                  | 6                          |
| `dispatch`      | 2     | 0                  | 2                          |

- **Across all 60 doors, 105 names have no source consumer**, and 63 of
  those have no test consumer through the door either
  (`awk -F'\t' 'NR>1 && $4==0 {z++; if($5==0) n++} END{print z, n}' $F/doors.tsv`).
  Nothing reports them because `knip.json:24` lists every module's
  `index.ts` as an entry, so a door export always counts as used.
- **`safety` is 95 because no file outside `safety` imports any of its
  sub-module doors**
  (`rg -n 'safety/(rules|limits|notices|review|screening|reports|takedowns|runners|blur)"' src --glob '!src/modules/safety/**' | wc -l`
  is 0), while 37 source files import the parent
  (`rg -l 'from "(\.\./)+safety"' src --glob '!src/modules/safety/**' | wc -l`).
  Of the 95, 85 are already on a sub-module door and have a source
  consumer, one (`runnerNotLeaving`) is on one with none, and nine are on
  none: seven from `inputs.ts`, `NoticeBand`, and `openReviewRow`, which is
  `openRow` on `review`'s door.
- **One unit takes a third of it.** 34 of the 95 are consumed only by
  `feed/moderation` and `feed/functions.ts`, the code that carries out a
  Desk decision. `feed` as a whole consumes 59 of the names, `dispatch` 15,
  `ops` 14, `account` 13, `closet` 10. The commands for this and the item
  above are under the list.
- **A parent door under its budget grows unseen.** Design 240 rule 4 says a
  split module's parent door "gains nothing new"
  (`docs/designs/240-module-breakdown.md:69-73`). `ops/index.ts` was to be
  21 names (`:231`) and is 24: `storageHandlers`, `OutboxDebtOf`,
  `oweInCoreWhere` and `captureRequestException` joined it on 2026-11-20
  and 2026-11-21
  (`git log --format='%h %ad' --date=short -S<name> -- src/modules/ops/index.ts`).
  The ratchet pins a door only over 45.
- About twenty exported types could be derived by their one consumer from
  what it already imports. Not proposed: a named type becomes an
  expression at each use, and the consumer depends on the same shape.

```sh
# the table: names, names with no source consumer, names with one consuming unit
awk -F'\t' '$1 ~ /^src\/modules\/[a-z]+\/index\.ts$/ {
  w[$1]=$2; if ($4==0) z[$1]++; n=split($6,a,","); if ($6!="" && n==1) o[$1]++
} END { for (d in w) print d, w[d], z[d]+0, o[d]+0 }' $F/doors.tsv

# safety's 95: on a sub-module door with a consumer, on one with none, on none
awk -F'\t' '$1 ~ /^src\/modules\/safety\/[a-z]+\/index\.ts$/ { s[$3]=1 }
  $1=="src/modules/safety/index.ts" { p[$3]=$4 }
  END { for (n in p) { if (n in s) { if (p[n]>0) a++; else b++ } else c++ }
        print a, b, c }' $F/doors.tsv

# names whose every source consumer is feed/moderation or feed/functions.ts
awk -F'\t' '$1=="src/modules/safety/index.ts" && $4>0 {
  n=split($9,f,","); ok=1
  for (i=1;i<=n;i++) if (f[i] !~ /^src\/modules\/feed\/(moderation\/|functions\.ts)/) ok=0
  if (ok) c++ } END { print c }' $F/doors.tsv

# names a module consumes, here feed
awk -F'\t' '$1=="src/modules/safety/index.ts" && $6 ~ /(^|,)feed/' $F/doors.tsv | wc -l
```

### 2. Fan-out

| module     | imports | what the count is                                                                                                                                                      |
| ---------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dispatch` | 11      | Composition. All 31 of its cross-module imports land on a door, and it imports each module whose job it runs.                                                          |
| `feed`     | 10      | Composition, with one misplaced import: `onboarding`, for a server function that saves a place (`src/modules/feed/functions.ts:298`).                                  |
| `account`  | 9       | The purge's. Without `account/purge` the module imports 7. One of the purge's imports, `enrichment`, is a one-line wrapper (`src/modules/account/purge/purge.ts:655`). |
| `safety`   | 8       | One edge is two Desk pages about the product catalogue: `products`, from `safety/functions.ts:50` and `safety/review/components/DeskCorrections.tsx:25`.               |

Commands: `awk -F'\t' '$1=="<module>" && $6=="src"{print $2}' $F/edges.tsv | sort -u`
for each list, and
`awk -F'\t' '$1=="account" && $6=="src" && $3 !~ /account\/purge\//{print $2}' $F/edges.tsv | sort -u`
for `account` without the purge.

What sits in the wrong module in `dispatch` is something the ratchet cannot
see. `src/modules/dispatch/scheduled.ts` (1,253 lines) imports five tables
(`:3-9`) and holds the stalled-enrichment sweep and its two digest checks
(`:853`, `:924`, `:1186`, `:1210`), the stalled-import and stranded-revocation
sweeps (`:743`, `:779`) and the weather backlog check (`:1237`). Each is a
query over a table another module owns, and two of them build that module's
queue message by hand.

### 3. Past the door

Two imports, both in one file
(`awk -F'\t' '$5=="PAST-DOOR" && $6=="src"' $F/edges.tsv`):
`src/named-not-found.tsx:4` imports `closet/piece-not-found.ts` and `:7`
imports `runs/run-not-found.ts`. Each is a constant of copy and a link
target, in a file that imports nothing. They go around the door because
`index.ts` reaches `env` and a route-side file may not; design 255's
`client.ts` is the door made for that.

Seven more imports go past a door from `scripts/`
(`awk -F'\t' '$5=="PAST-DOOR" && $6=="scripts"' $F/edges.tsv`). The ratchet
reads `src` only, so they count nowhere.

### 4. Boundaries

- **The Call ladder is split across `onboarding` and `feed/consensus`.**
  The read and the counting are `feed/consensus`'s; the ladder's states and
  screen are `onboarding`'s (`src/modules/onboarding/ladder.ts`,
  `components/CallLadder.tsx`); `onboarding/functions.ts:63` joins them.
  With the place-saving function above, the two modules import each other.
- **Desk decisions are carried out in `feed/moderation`** with 32 of
  `safety`'s names and 8 of `feed/entries`'. Its header records why it is
  in `feed` (`src/modules/feed/moderation/moderation.ts:36-38`). No flow in
  `docs/diagrams/flows` draws this path
  (`rg -n 'dynamic view' docs/diagrams/flows` lists the import, export,
  public-photos, enrichment, following and consensus stories).
- **`email` holds two concepts**: sending mail, and the counters over
  `rate_limits` (`src/modules/email/rate-limit.ts`, 16 of the door's 28
  names). Five modules import `email` for the counters and nothing else:
  `closet`, `dispatch`, `enrichment`, `products`, `weather`.
- **An import's retry is written outside `runs`.**
  `src/modules/ops/desk/gave-up.ts:331` moves an import back to pending and
  cancels a debt that `runs/consumer.ts` wrote, where the same file calls
  `enrichment`'s own operation for a product (`:291`).
- **One fact is written twice.** `LIVE_HOLD` at
  `src/modules/feed/entries/retract.ts:345` and `LIVE` at
  `src/modules/safety/takedowns/copyright-holds.ts:155` are the same array.
- Within budget and not proposed: `onboarding` holds the first-run flow and
  the runner's settings; `runs/consumer.ts` holds the import job and the
  Strava jobs (design 254 ruled); the verdict backlog is read in
  `feed/attach` and drawn in `runs`, for a mechanical reason.

### 5. lib/ and db/

- **`src/lib/sql/` is plumbing.** No file in `src/lib` imports a schema, a
  module, `env` or a route
  (`rg -n 'from "[./]+/(modules|db|env|routes)/' src/lib` is empty).
  `lib/sql/outbox.ts` is a contract rather than SQL, held below the modules
  on purpose so a producer can type a debt without importing `ops`
  (`docs/architecture.md:192`).
- **`src/db/gave-up.ts` is a shared floor.** It writes one table that three
  modules write and `ops/desk` reads (8 importing files:
  `rg -l 'db/gave-up"' src`). A door on it would make `runs` and
  `enrichment` import `ops` while `ops/desk` imports them. Sound as it is.
- **`src/db/runner-standing.ts` and `runner-confirmed.ts` are one module's
  rule placed where every module can import it without a door.** Their
  clauses are `safety/rules`' vocabulary. The header's reason for the place
  (`src/db/runner-standing.ts:4-6`) is that `safety` may not import `feed`;
  `safety/rules` meets that reason as well as `src/db` does, since it
  imports no module and `feed` already imports `safety`. Both re-export
  chains meant to give it a door have no consumer.
- **None of the three is in the mutation ratchet**
  (`rg -n 'src/db/(gave-up|runner)' stryker.conf.json` is empty), while
  CLAUDE.md says every shipped file outside `src/routes/` is.
- **The wider way around a door is the schema.** A module's rows are read
  and written from other modules through `src/db/schema-core.ts` with no
  number moving. Proposals 5, 6 and 7 are the places this review closes by
  hand; it proposes no rule for the rest.

## Ranked proposals

Ranked by dependency actually ended and pins moved, against blast radius.
Sizes: S is under about ten files, M under about thirty, L more. "Not
beside" names proposals that edit the same files.

| #   | proposal                                                 | kind            | pins it moves                        | size |
| --- | -------------------------------------------------------- | --------------- | ------------------------------------ | ---- |
| 1   | The purge forgets the enrichment count through `email`   | lowers coupling | fan-out `account` 9 → 8              | S    |
| 2   | The `onboarding`/`feed` pair is cut                      | lowers coupling | fan-out `feed` 10 → 9                | M    |
| 3   | The Desk's Corrections page moves to `products`          | lowers coupling | fan-out `safety` 8 → 7, pin clears   | M    |
| 4   | The runner-standing clauses live in `safety/rules`       | lowers coupling | door `safety` 95 → 92                | M    |
| 5   | The enrichment sweep moves from `dispatch`               | lowers coupling | none                                 | M    |
| 6   | The other sweeps leave `dispatch`                        | lowers coupling | none                                 | M    |
| 7   | The Desk's import retry moves into `runs`                | lowers coupling | none                                 | S    |
| 8   | Two files leave `safety/limits` for the units using them | lowers coupling | none                                 | S    |
| 9   | One copy of the live-hold status set                     | lowers coupling | none                                 | S    |
| 10  | `runDayOf` leaves `feed/public-web` for `lib/dates`      | lowers coupling | none                                 | S    |
| 11  | The two not-found constants go through `client.ts`       | relabel         | past-door `closet` and `runs` clear  | S    |
| 12  | Four names come off `ops/index.ts`                       | relabel         | none; restores 240 rule 4            | S    |
| 13  | Other modules import `safety`'s sub-module doors         | relabel         | door `safety` 95 → 9, pin clears     | L    |
| 14  | Doors drop the names no source file imports              | relabel         | none; `closet` leaves its budget     | M    |
| 15  | The `rate_limits` counters leave `email`                 | mixed           | fan-out `dispatch` 11 → 10, on paper | M    |
| 16  | `turnstileAttempt` moves beside its type                 | relabel         | none                                 | S    |

Proposals 13 and 14 wait on the second review (see Scope).

### 1. The purge forgets the enrichment count through `email`

- **Moves.** `purge.ts:655` becomes `forgetRateLimit(db, "enrich-runner", userId)`,
  the form of the eight lines above it (`:647-654`). The import at `:85`
  goes, and so does `forgetRunnerEnrichmentLimit`
  (`src/modules/enrichment/spend-limit.ts:120`, `enrichment/index.ts:23`)
  with its test block.
- **Numbers.** Fan-out `account` 9 → 8. Door `enrichment` 20 → 19.
  `rg -n forgetRunnerEnrichmentLimit src` shows the one user.
- **Blast radius.** Three source files and one test block.
  Behaviour-neutral: the batch holds the same statement.
- **Cost.** Nothing ties a new runner-keyed kind to the purge but the
  hand-written union at `test/account/purge.test.ts:515-524`. That gap
  exists today for the other eight kinds.
- **Not beside** 9 or 15 (`purge.ts`), 5 or 14 (`enrichment/index.ts`).

### 2. The `onboarding`/`feed` pair is cut

- **Moves.** (a) `saveConditionsCityAction` from `feed/functions.ts:298` to
  `onboarding/functions.ts`; `placeInput` and `Place`
  (`onboarding/inputs.ts:96-102`) to `src/lib/contracts/city-lookup.ts`.
  (b) `onboarding/ladder.ts` and `components/CallLadder.tsx` to
  `feed/consensus`; `callLadderQuery` (`onboarding/functions.ts:63`) to
  `feed/functions.ts`. (c) `settingsSubPageData`
  (`onboarding/functions.ts:114`) stops naming `BellState`.
- **Numbers.** Fan-out `feed` 10 → 9 and `onboarding` 7 → 5. Doors: `feed`
  15 → 13, `onboarding` 9 → 5, `feed/consensus` 8 → 9.
  `rg -n 'from "(\.\./)+onboarding"' src/modules/feed` and
  `rg -n 'from "(\.\./)+(feed|notifications)"' src/modules/onboarding`
  list the five import lines that go.
- **What is real.** (b) is: one unit then holds the read, the shape and the
  screen. (a) partly: the route still hands the action to feed's tab, and a
  route's imports are in no number. (c) is a relabel of a type-only import,
  so `onboarding`'s fall is one dependency and one type.
- **Blast radius.** Two files moved, about ten edited, four tests, and the
  files keyed by a server function's home
  (`test/architecture/verification-class.test.ts`, `e2e/query-baseline.json`).
  Behaviour-neutral for the runner.
- **Design choice in the lane.** `placeInput` shares three private schema
  parts with `calibrationInput` (`onboarding/inputs.ts:27-34`); they move
  to `lib/contracts` with it.
- **Not beside** 4, 9 or 14 (`feed/index.ts`, `onboarding/index.ts`).

### 3. The Desk's Corrections page moves to `products`

- **Moves.** Two routes to the same pin, for the owner to choose:
  - _Full._ `DeskCorrections.tsx` to `products/components/`, and
    `deskCorrectionsQuery`, `applyCorrectionFn` and `declineCorrectionFn`
    from `safety/functions.ts` to `products/functions.ts`. The Desk form
    pieces both modules then need (`DeskForm`, `QuietAction`, `counted`,
    `short-id`) go to `src/ui`, because a component may not import another
    module's component.
  - _Small._ Only the three server functions move, and the four result
    types `DeskCorrections.tsx:25` imports go to `src/lib/contracts`. No
    component moves and `src/ui` is untouched. Weaker: four types change
    address.
- **Numbers.** Fan-out `safety` 8 → 7; the pin leaves the file.
  `awk -F'\t' '$1=="safety" && $2=="products" && $6=="src"' $F/edges.tsv`
  prints the two rows that go. Full route: door `products` 34 → 25.
- **Blast radius, full route.** `stryker.conf.json` needs a new entry: no
  entry covers `src/modules/products/**/*.tsx`
  (`rg -o 'modules/[a-z]+/\*\*/\*\.tsx' stryker.conf.json | sort -u`), and
  `test/architecture/mutation-config.test.ts:194` requires one. About 18
  importer edits inside `safety`. Behaviour-neutral.
- **Against an earlier design.** Design 240's tree lists these files under
  `safety/review` (`:131`). Its rule 5 says components move with the code
  whose data they show (`:74`), and the tree did not weigh the `products`
  edge.
- **Left out.** The Duplicates page. It imports nothing of `products`, so
  it is not needed for the pin, and moving it re-keys a grant in
  `guardrails.config.json`.
- **Not beside** 8 (`safety/review`), 14 (`products/index.ts`), 16
  (`safety/functions.ts`).

### 4. The runner-standing clauses live in `safety/rules`

- **Moves.** `src/db/runner-standing.ts` to `safety/rules/`, with
  `runner-confirmed.ts`' one function as a private helper.
  `runnerVisibleToViewer` from `feed/conditions/runner-visibility.ts` to
  `safety/rules/visibility.ts`, which declares two of its three operands.
  Importers take the names from `safety/rules`. The dead re-exports go.
- **Numbers.** Door `safety` 95 → 92; `safety/rules` stays 43 (two names
  join, two become unit-internal); `feed` 15 → 14; `account` 35 → 34.
  `rg -n 'db/(runner-standing|runner-confirmed)"' src` prints the three
  imports and three re-exports to edit.
- **What is real.** Other modules can no longer compose their own variant
  of the clause from its parts, and a rule stops being importable with no
  door.
- **Costs.** `notifications/functions.ts` stops importing `feed` and starts
  importing `safety/rules`, and `safety` already imports `notifications`:
  the pair `notifications`/`feed` goes and a pair `notifications`/`safety`
  arrives. Not a file cycle, since `safety/rules` imports no module. About
  50 lines join the mutation ratchet for the first time.
- **Blast radius.** About 14 source files across four modules;
  `test/architecture/system-account.test.ts` names the file by path.
- **Depends on** owner question 2. **Not beside** 13 or 14.

### 5. The enrichment sweep moves from `dispatch` to `enrichment`

- **Moves.** `failedAndOwed`, `redispatchStalledEnrichments`,
  `checkExtractionYield` and `checkAbandonedEnrichments`
  (`scheduled.ts:853`, `:924`, `:1186`, `:1210`) to a new
  `enrichment/sweep.ts`, each taking the queue, the reporter and the
  anomaly list as parameters, as nine other jobs already do. `redispatchEach`
  (`:668`) goes to `src/lib/sql/queue-batch.ts`.
- **Numbers.** Door `enrichment` 20 → 18 (five status helpers that only
  `dispatch` imports leave, three jobs join). Fan-out unchanged.
- **What is real.** `dispatch` stops importing the `products` table and
  stops building the `enrich` message. The modules writing
  `products.extraction_status` go from three to two.
- **In line with** design 240, which keeps `dispatch` "to deciding what
  runs when" (`:178-179`).
- **Costs.** `stalledPending` (`:723`) serves imports and products: the
  lane chooses between handing the table in and one copy per module. Two
  grants in `guardrails.config.json` (`:322`, `:327`) key on comments in
  this code and need the owner's re-key. Five `// source:` comments in
  `docs/diagrams/flows/enrichment.c4` cite `scheduled.ts`.
- **Not beside** 6 or 15 (`scheduled.ts`), 1 or 14.

### 6. The other sweeps leave `dispatch`

- **Moves.** `redispatchStalledImports` (`:743`) to `runs/imports`;
  `redispatchStrandedRevocations` (`:779`) to `runs/strava`;
  `checkWeatherBacklog` (`:1237`) to `weather`.
- **Numbers.** Nothing falls: `runs/imports` 5 → 6, `runs/strava` 24 → 25,
  `weather` 23 → 24. With 5 as well, `dispatch` keeps one table, its own
  heartbeat.
- **The heartbeat stays** (`scheduled.ts:116-124`). Moving it into
  `ops/desk`'s `markStatement` would widen that function's name parameter
  from two literals to any string (`src/modules/ops/desk/digest-marks.ts:59`).
- **Checked.** `runs/imports` can hold its sweep without importing
  `runs/garmin`; design 254's cycle was about `consumer.ts`, which does not
  move.
- **Costs.** Six `// source:` comments in `docs/diagrams/flows/import.c4`.
- **After** 5. **Not beside** 7.

### 7. The Desk's import retry moves into `runs`

- **Moves.** The body of `retryImport` (`ops/desk/gave-up.ts:331`) becomes
  a `runs` export, called the way `retryFailedEnrichment` is at `:291`.
- **Numbers.** Door `runs` 16 → 17 (16 with proposal 6, when `importJob`
  loses its last outside consumer).
- **What is real.** One module writes and cancels the import-file debt, and
  one module moves an import from failed to pending.
- **Blast radius.** Three files. Behaviour-neutral if the batch moves whole.

### 8. Two files leave `safety/limits` for the units that use them

- **Moves.** `limits/takedown-limits.ts` to `safety/takedowns/`;
  `limits/at-once.ts` to `safety/review/`; `counted` to `limits/breakers.ts`.
- **Numbers.** Door `safety/limits` 22 → 11
  (`awk -F'\t' '$1=="src/modules/safety/limits/index.ts"{print $3,$4,$6}' $F/doors.tsv`:
  eight names are `takedowns`' alone, two `review`'s, one has no consumer).
  The unit arrow `takedowns → limits` ends.
- **Against an earlier design.** 240's tree lists both files under
  `safety/limits` (`:129`). The reason `at-once.ts` gives for its place
  (`src/modules/safety/limits/at-once.ts:1-5`) no longer holds:
  `breakers.ts` does not import it.
- **Blast radius.** Two files moved, seven importers, two tests, three
  mutation entries touched.

### 9. One copy of the live-hold status set

- **Moves.** `safety/takedowns` exports the set; `LIVE_HOLD` and its two
  re-exports go; `retract.ts:351` and `purge.ts:262` import the one copy.
- **Numbers.** Doors: `feed` 15 → 14, `feed/entries` 33 → 32,
  `safety/takedowns` 13 → 14. `rg -n 'LIVE_HOLD|const LIVE\b' src`.
- **What is real.** Derive, don't mirror. No module edge changes.
- **Blast radius.** Six files, none moved.

### 10. `runDayOf` leaves `feed/public-web` for `lib/dates`

- **Moves.** The pure function to `src/lib/dates.ts`, taking the zone as a
  string, so that file goes on importing nothing.
- **Numbers.** Door `feed/public-web` 4 → 3.
  `rg -n 'from "\.\./public-web"' src/modules/feed` lists the two service
  imports that go, and with them the unit arrows from `entries` and
  `following`.
- **Blast radius.** Six files. A second, different `runDayOf` stays at
  `feed/moderation/run-day.ts`.

### 11. The two not-found constants go through `client.ts`

- **Moves.** `closet/client.ts` and `runs/client.ts` re-export the two
  constants; `src/named-not-found.tsx:4` and `:7` import them from there.
- **Numbers.** Past-door `closet` 1 → 0 and `runs` 1 → 0: both pins leave.
- **Relabel.** The same file depends on the same two names. What it buys:
  the budget of 0 then has no exception on file.
- **Condition.** The file would import two `client.ts` doors that also
  re-export form code. `npm run build` and `check:bundle` are the lane's
  first step.

### 12. Four names come off `ops/index.ts`

- **Moves.** The seven files importing `storageHandlers`, `OutboxDebtOf`,
  `oweInCoreWhere` or `captureRequestException` from `ops` import
  `ops/outbox` or `ops/sentry`.
- **Numbers.** Door `ops` 24 → 20.
- **Relabel**, done because it restores a recorded rule (finding 1).

### 13. Other modules import `safety`'s sub-module doors

- **Moves.** No file moves. The 37 source files importing
  `safety/index.ts` import the door each name lives on. The parent keeps
  the seven `inputs.ts` names and `NoticeBand`.
- **Numbers.** Door `safety` 95 → 9, or 8 with the unused `runnerNotLeaving`
  dropped; the pin leaves the file. No sub-module door changes.
- **Relabel.** Each consumer depends on the same names. Two things do get
  smaller: what an import loads (the parent re-exports eight units), and
  the tests a static mutant re-runs, which `stryker.conf.json`'s
  `//modules` note puts at about 142 files through this barrel. Neither
  was measured here.
- **Blast radius.** 37 source files and 43 test files
  (`rg -l 'modules/safety"' test e2e | wc -l`) change import lines, in every
  area. Do it whole and alone: stopped part-way it leaves two ways to
  import a name.
- **Why it is here and not higher.** It is the only proposal that brings
  the door under 45, and it does so without ending a dependency. Design
  240's reason for keeping the parent door was that the moves of wave 16
  should not edit each other's importers (`:70-73`); those moves are done.
- **Depends on** owner question 1.

### 14. Doors drop the names no source file imports

- **Moves.** No file moves. Each door stops exporting its unused names
  (finding 1); a test that imports one through a door imports the
  declaring file.
- **Numbers.** 18 doors have such names
  (`awk -F'\t' 'NR>1 && $4==0{d[$1]=1} END{print length(d)}' $F/doors.tsv`):
  `closet` 45 → 20, off its budget; `account` 35 → 16; `products` 34 → 21;
  `safety` 95 → 94, the one name proposal 4 also removes. Six sub-module
  doors then lose 22 names kept only for a parent re-export that is gone.
- **Relabel.** No consumer depends on less. What it buys: knip starts
  seeing the names, and each door states what crosses it. Design 240 asked
  for it (`:190-191`).
- **Blast radius.** Not door files only. Once a name leaves a door its
  declaring file's `export` is unused, and the commit gate's knip will ask
  for it: at least 18 declaring files, by a name search over the 63 names
  with no consumer at all. The tests behind the other 42 re-point to the
  declaring file.
- **Run it per area**, in the lane already editing that door. As one lane
  it blocks every other proposal.
- **Depends on** owner question 6.

### 15. The `rate_limits` counters leave `email`

- **Moves.** `src/modules/email/rate-limit.ts` (396 lines) to a home every
  module may import without importing `email`.
- **Numbers.** Door `email` 28 → 12. With a home outside `src/modules`:
  fan-out `dispatch` 11 → 10, `closet` 7 → 6, `products` 4 → 3,
  `enrichment` 2 → 1, `weather` 2 → 1.
- **Mixed, and mostly a relabel.** Fan-out counts modules, so a folder
  outside `src/modules` is not counted: the same 18 files import the same
  16 names. What narrows is reach: five modules stop loading the door that
  also exports the sender.
- **The home is the owner's** (question 2). The file holds table mechanics
  and also the allowance of each kind (`LIMIT_OF`, `:328`), which belong to
  four modules. Either it splits (mechanics to `src/db`, allowances to
  `src/lib/contracts/rate-limits.ts`, which already lists every kind), or it
  becomes a sub-module `ops/limits`, where a module may hold a rule.
- **Not beside** 1, 5, 6 or 9.

### 16. `turnstileAttempt` moves beside its type

- **Moves.** From `account/access/access.ts:45` to `ops/edge/turnstile.ts`.
- **Numbers.** Doors: `account` 35 → 34, `account/access` 12 → 11,
  `ops/edge` 12 → 13.
- **Relabel.** No edge ends: `safety/functions.ts` still imports `account`.
  Fold it into whichever lane next edits `access.ts`.

### The pins after these

| pin                   | ends at            | by    | what is left                                                       |
| --------------------- | ------------------ | ----- | ------------------------------------------------------------------ |
| fan-out `account` 9   | 8                  | 1     | The purge composes eight modules, and D-201 keeps it in `account`. |
| fan-out `dispatch` 11 | 11, or 10 on paper | 15    | Composition. Nothing proposed removes anything it composes.        |
| fan-out `feed` 10     | 9                  | 2     | Composition. No other misplaced import was found.                  |
| fan-out `safety` 8    | 7, cleared         | 3     | Nothing.                                                           |
| door `safety` 95      | 92, or 8           | 4; 13 | Only 13 brings it under 45, and 13 is a relabel.                   |
| past-door `closet` 1  | 0, cleared         | 11    | Nothing.                                                           |
| past-door `runs` 1    | 0, cleared         | 11    | Nothing.                                                           |

At a budget and not pinned: fan-out `closet` 7 and `onboarding` 7 (5 after
proposal 2); doors `closet` 45 (20 after 14) and `safety/rules` 43; files
`auth` 43 of 50.

## Considered and rejected

Dropped by the challenger:

- **Moving `feed/moderation` into `safety`.** It would take `safety`'s door
  from 95 to 61 and `dispatch`'s fan-out to 10. Rejected: the same six
  files would import the same 32 names and the same eight from
  `feed/entries`, so the door falls only because the line is redrawn around
  the importer. It raises `safety`'s fan-out to 9, and a pin is never
  raised to pass the test. It reverses a recorded reason that still holds
  (`moderation.ts:36-38`, `docs/architecture.md:53-57`): the unit names
  four of feed's tables 22 times, so `safety` would write another module's
  rows, which is what proposals 5 to 7 remove elsewhere. If the owner wants
  Desk decisions in `safety` on grounds of vocabulary, the first step is to
  draw the flow, which no diagram does.
- **`feed/entries/retract.ts` as its own sub-module.** Sixteen names move
  from one door to another, and it was worth its cold mutation shard only
  as a step before the move above.
- **The export queue's consumers beside the build.** A door goes 8 to 7
  with no pin, no consumer depends on less, and it strands a rule line the
  owner granted on 2026-11-19 (`.dependency-cruiser.cjs:214`).
- **The system-state pages from `auth` to `src/ui`.** One file off a count
  seven under its budget.

Considered and not proposed:

- **Deriving types to shave doors.** See finding 1.
- **The rest of `account`'s and `ops`' importers moving to sub-module
  doors.** 48 source files, no number waiting. It is the same decision as
  proposal 13 (owner question 1).
- **A door on `src/db/gave-up.ts`**, as an `ops/gave-up` sub-module. It
  adds module pairs between `ops` and the modules `ops/desk` imports.
- **A new top-level module** for the counters or for Desk decisions. D-201
  names `dispatch` as the only one, and a counters module would raise
  fan-out for three pinned modules.
- **Moving the Desk's Runners wiring to `account`**, to take `safety`'s
  `account` edge away. It trades four names one way for about nine the
  other.
- **The Desk's weather retry through `weather`'s door.** It takes `ops`'
  fan-out from 6 to its budget for one statement.
- **Splitting `onboarding`, `ops/desk`, `ops/edge`, `account/terms`,
  `closet/service.ts` or `runs/consumer.ts`.** All within budget; design
  254 ruled on the last.
- **`products` asking for its own enrichment.** A file cycle through the
  parent doors.
- **`safety`'s jobs wording their own digest sentences**, which would cut
  what `dispatch` knows of `safety` from 15 names to about 11. Not sized;
  the one item here worth a design of its own.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Screens implemented: **none**

## Test plan

No code changes, so no tests. Each restructure lane is behaviour-neutral
and its tests are the existing suite plus what moves with the code. Three
checks belong at the front of a lane, not the end: `npm run build` for
proposal 11, knip for 14, and the cruiser's `no-circular` for 3, 4 and 5.

## Issues

- Refs #850 (step 4b). Closes nothing.
- Opens: #982, the seven questions below, in Needs owner. Each proposal
  the owner takes becomes a build issue when its lane is dispatched, after
  #850's step 4.

## Questions for the owner

The owner answered these on 2026-11-23. The rulings are in design 261.

1. **Do other modules import the narrowest door?** Proposal 13 is the only
   way `safety`'s door reaches 45, and it is a relabel. Yes means 13, then
   the same for `account` and `ops`, and a line in CLAUDE.md's
   architecture rules. No means the pin stays at 92 as the door's
   honest width.
2. **What may `src/db` hold?** Proposal 4 takes a module's rule out of it;
   proposal 15 could put the counters' mechanics into it. Recommended: the
   schema, and the writer of a table no one module owns, with no
   per-module rule. Then `gave-up.ts`, and anything 15 adds, needs an entry
   in the mutation ratchet.
3. **Proposal 3: the full move or the small one?** The full one puts the
   page with the tables it reads and puts Desk form pieces in `src/ui`.
4. **How does the pins file tell a ceiling from a debt?** `account` 8,
   `dispatch` 11 and `feed` 9 are composition points with no remedy
   proposed. `module-shape.json` holds a number and no reason, so each
   reads as a debt. Options: a reason beside the pin, or a budget per
   module in `scripts/modules/shape.ts`.
5. **A check for design 240 rule 4.** Nothing fails when a split module's
   parent door gains a name. It could live in the ratchet (a parent door
   may only shrink) or in `.dependency-cruiser.cjs`; both are the owner's
   files.
6. **Four names with no caller in `src`**: `searchProducts`,
   `getProductAttributeDefaults`, `getProductComposition`
   (`src/modules/products/service.ts`) and `isVerified`
   (`account/verification/email-links.ts:267`). Kept for work not built,
   or deleted with proposal 14? (Corrected by design 261: this list first
   included `forecast`, which `src/modules/weather/zone.ts` calls. Only
   its export on `weather/index.ts:20` is unused.)
7. **Scripts that import past a door** (finding 3): leave uncounted, or
   count them?

## Appendix: the measuring script

Not committed as a file: the lane changes nothing under `scripts/`. Saved
as `consumers.mjs` and run as `node consumers.mjs "$F"` at the repo root,
it writes the two tables every `awk` command above reads. A parser-only
reading with no type checker: it sees named imports, re-exports, and
namespace and dynamic imports. If the consumer table is wanted again, it
belongs behind a flag of `npm run modules:pin`.

<details>
<summary>consumers.mjs</summary>

```js
// node consumers.mjs <out-dir>, from the repo root. Writes doors.tsv and edges.tsv.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const ts = createRequire(path.join(process.cwd(), "package.json"))(
  "typescript",
);
const out = process.argv[2];
mkdirSync(out, { recursive: true });

const DOOR = /^src\/modules\/(?:.*\/index|[^/]+\/client)\.ts$/u;
const WIRING = /(?:\/functions\.ts|\.tsx)$/u;
const TEST = /^(?:test|e2e)\/|\.(?:test|spec)\.tsx?$/u;

function walk(dir, found = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, found);
    else if (/\.tsx?$/u.test(name) && !name.endsWith(".d.ts")) found.push(full);
  }
  return found;
}
const files = ["src", "test", "e2e", "scripts"]
  .filter((root) => existsSync(root))
  .flatMap((root) => walk(root));
const fileSet = new Set(files);

function resolve(from, spec) {
  let base;
  if (spec.startsWith(".")) base = path.join(path.dirname(from), spec);
  else if (spec.startsWith("#/") || spec.startsWith("@/"))
    base = path.join("src", spec.slice(2));
  else return undefined;
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ].find((candidate) => fileSet.has(candidate));
}
const moduleOf = (file) =>
  file.startsWith("src/modules/") ? file.split("/")[2] : undefined;
/** The unit a file is in: the deepest folder at or above it that has an index.ts. */
function unitOf(file) {
  if (!file.startsWith("src/modules/")) return undefined;
  let dir = path.dirname(file);
  while (dir.split("/").length > 3 && !fileSet.has(`${dir}/index.ts`))
    dir = path.dirname(dir);
  return dir.slice("src/modules/".length);
}
function kindOf(consumer, door) {
  if (TEST.test(consumer)) return "test";
  if (consumer.startsWith("scripts/")) return "scripts";
  if (consumer.startsWith("src/routes/")) return "route";
  const module = moduleOf(consumer);
  if (module === undefined) return "src-other";
  if (module !== moduleOf(door)) return "other-module";
  if (DOOR.test(consumer)) return "own-module-door";
  if (
    door.endsWith("/index.ts") &&
    consumer.startsWith(`${path.dirname(door)}/`)
  )
    return "inside-unit";
  return WIRING.test(consumer) ? "own-module-wiring" : "own-module";
}
/** The names a door exports, as scripts/modules/doors.ts counts them. */
function doorNames(file, source) {
  const names = [];
  for (const statement of source.statements) {
    const modifiers = ts.canHaveModifiers(statement)
      ? (ts.getModifiers(statement) ?? [])
      : [];
    if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      if (clause === undefined) throw new Error(`${file}: bare export *`);
      if (ts.isNamedExports(clause))
        for (const element of clause.elements) names.push(element.name.text);
      else names.push(clause.name.text);
    } else if (ts.isExportAssignment(statement)) names.push("default");
    else if (modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      if (ts.isVariableStatement(statement))
        for (const d of statement.declarationList.declarations)
          names.push(d.name.getText(source));
      else if (modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword))
        names.push("default");
      else if (statement.name) names.push(statement.name.text);
    }
  }
  return names;
}

const doors = {};
const edges = [];
function record(from, source, node, spec, names, via) {
  const to = resolve(from, spec);
  if (to === undefined) return;
  const line =
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const [fromModule, toModule] = [moduleOf(from), moduleOf(to)];
  if (toModule !== undefined && fromModule !== toModule) {
    const toKind = DOOR.test(to)
      ? "door"
      : WIRING.test(to)
        ? "wiring"
        : to.includes("/components/")
          ? "components-helper"
          : "PAST-DOOR";
    const fromKind = TEST.test(from)
      ? "test"
      : from.startsWith("scripts/")
        ? "scripts"
        : "src";
    edges.push([
      fromModule ?? kindOf(from, to),
      toModule,
      `${from}:${line}`,
      to,
      toKind,
      fromKind,
      names.map((n) => n.name).join(","),
    ]);
  }
  if (!DOOR.test(to)) return;
  for (const { name, typeOnly } of names) {
    ((doors[to] ??= { names: [], consumers: {} }).consumers[name] ??= []).push({
      file: from,
      line,
      kind: kindOf(from, to),
      unit: unitOf(from),
      typeOnly,
      via,
    });
  }
}

for (const file of files) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  if (DOOR.test(file))
    (doors[file] ??= { names: [], consumers: {} }).names = doorNames(
      file,
      source,
    );
  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.importClause;
      const names = [];
      if (clause?.name)
        names.push({ name: "default", typeOnly: clause.isTypeOnly });
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings))
        names.push({ name: "*", typeOnly: clause.isTypeOnly });
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements)
          names.push({
            name: (element.propertyName ?? element.name).text,
            typeOnly: clause.isTypeOnly || element.isTypeOnly,
          });
      }
      if (clause === undefined)
        names.push({ name: "(side effect)", typeOnly: false });
      record(file, source, node, node.moduleSpecifier.text, names, "import");
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.exportClause;
      const names =
        clause && ts.isNamedExports(clause)
          ? clause.elements.map((element) => ({
              name: (element.propertyName ?? element.name).text,
              typeOnly: node.isTypeOnly || element.isTypeOnly,
            }))
          : [{ name: "*", typeOnly: node.isTypeOnly }];
      record(file, source, node, node.moduleSpecifier.text, names, "re-export");
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      record(
        file,
        source,
        node,
        node.arguments[0].text,
        [{ name: "*", typeOnly: false }],
        "dynamic-import",
      );
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      record(
        file,
        source,
        node,
        node.argument.literal.text,
        [
          {
            name: node.qualifier ? node.qualifier.getText(source) : "*",
            typeOnly: true,
          },
        ],
        "import-type",
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const rows = [
  [
    "door",
    "width",
    "name",
    "nonTestConsumers",
    "testConsumers",
    "consumingUnits",
    "kinds",
    "typeOnlyEverywhere",
    "nonTestFiles",
  ].join("\t"),
];
for (const door of Object.keys(doors).toSorted()) {
  const { names, consumers } = doors[door];
  for (const name of names) {
    const all = [...(consumers[name] ?? []), ...(consumers["*"] ?? [])];
    const live = all.filter((c) => c.kind !== "test" && c.kind !== "scripts");
    const units = [
      ...new Set(
        live.map((c) =>
          c.kind === "route"
            ? `route:${c.file.split("/")[2]}`
            : (c.unit ?? c.file),
        ),
      ),
    ].toSorted();
    const kinds = [...new Set(live.map((c) => c.kind))].toSorted();
    const typeOnly = all.length > 0 && all.every((c) => c.typeOnly);
    rows.push(
      [
        door,
        names.length,
        name,
        live.length,
        all.length - live.length,
        units.join(","),
        kinds.join(","),
        typeOnly,
        live.map((c) => `${c.file}:${c.line}`).join(","),
      ].join("\t"),
    );
  }
}
const header = [
  "fromModule",
  "toModule",
  "from",
  "to",
  "toKind",
  "fromKind",
  "names",
].join("\t");
writeFileSync(path.join(out, "doors.tsv"), `${rows.join("\n")}\n`);
writeFileSync(
  path.join(out, "edges.tsv"),
  `${[header, ...edges.map((e) => e.join("\t")).toSorted()].join("\n")}\n`,
);
```

</details>
