# Design: 260 module decomposition review

> #850 step 4b, second part. Read-only: this doc is the lane's one output,
> and no file under `src/`, `test/` or `scripts/` changes. Over the
> template's one page on purpose, as designs 240 and 258 were.

## Problem

Design 258 reviewed the fourteen modules under `src/modules` as given and
said so in its Scope. It did not ask whether those fourteen are the right
way to cut the app. The owner asked for that review before any substantial
restructure: is there a better decomposition, by domain or with fewer and
deeper modules, and what does today's structure and its connectedness say
about the architecture?

## The answer, in short

**Today's fourteen modules are roughly the right cut. Keep them: merge
nothing, split nothing, rename nothing.** Three full alternative layouts
were built and scored. Each of their proposers ended by saying most of its
own layout is a relabel, and the measurements agree.

- **The graph of modules looks tangled and is not.** 13 pairs of modules
  import each other. Set aside each module's `functions.ts` (its wiring)
  and the account purge, and 3 pairs are left, held by 4 import statements.
  Three of the four are type imports. Each has a small remedy.
- **Regrouping does not make changes more local.** Of 239 past merges, 85
  changed one module. They would be 84 in a layout cut by domain and 96 in
  a layout of six modules.
- **Merging buys table counts and a worse order.** Six modules by merging
  alone takes the tables with more than one writing module from 24 to 20,
  and the import statements to cut for no cycle from 22 to 48.
- **The real strain is in what cuts across the features**, and no layout
  removes it: the Desk, the runner's profile row, every email's words in
  one file, the purge and the export. Those are named below as questions,
  not as lanes.

What this review adds to design 258 is small: a direction between modules
that is written down and held by a number, a list of which module writes
which table, one more type move, and four statements. Design 258's
proposals 13 and 14 no longer wait.

## How it was measured

Pinned at `96055f7cd48d54e07420c37294d0694eec387b15`. `src/` there is the
same as at design 258's pin. Every `path:line` below is at that commit, and
every command runs at the repo root there.

- Three throwaway scripts (appendix). `graph.mjs` parses every non-test
  file under `src` and writes `files.tsv`, `imports.tsv` (one row per
  import of one file by another) and `tables.tsv` (one row per place a file
  names one of the schema's 60 tables, with whether it inserts, updates,
  deletes, reads or only names a column). `score.mjs` scores a layout:
  today's, or any mapping of paths to modules. `cochange.mjs` counts, for
  each pair of modules, the merged pull requests that changed both. `$F`
  below is the folder they wrote to. The file graph reproduces the module
  ratchet's fan-out for all fourteen modules.
- Eight agents. Three derived, independently: the app's areas from the
  schema and the vocabulary alone; every process and what it writes in one
  batch; and what today's structure measures, edge by edge. Three then
  each proposed a complete layout from one stance and scored it with
  `score.mjs`. One compared the three with today and with design 258. One
  argued against the comparison's recommendation and re-ran its numbers.
  The headline numbers were then re-run by hand.
- One test is applied throughout, as in design 258: after the move, do the
  same files depend on the same names and the same tables? If so it is a
  relabel, whatever number falls.

Limits. The first deriver was told not to open `src/modules`, the routes,
the diagrams or the architecture docs, but the module names are in
CLAUDE.md, so it was not blind to them. `tables.tsv` counts a delete as a
write, cannot see a table passed in an array or an object, and cannot see
a write made through the owning module's exported statement; its counts
are floors. `score.mjs` can move a file between modules; it cannot split a
file or remove an import. Nothing was run on any proposed result: no
dependency-cruiser, knip, lint, test, build or Stryker.

## Findings

### 1. What kind of architecture this is

Modules by feature area, cut the way the work was first dispatched. The
task packets name them: `docs/tasks/101-closet.md`, `102-runs-import.md`,
`103-weather.md`, `104-feed-social.md`, `105-onboarding.md`,
`106-trust-safety-floor.md`, `107-product-intel.md`. `dispatch` was added
later as the one composition module (D-201, `docs/decisions.md:217`).

It is not layered: no rule orders the modules. It is not by screen: a
route folder imports several modules. Three things that are not modules
hold it together: one schema that every module may name, a `functions.ts`
per module that does the wiring, and `src/lib` with `src/db` underneath.

### 2. The module graph is cyclic; the service code is not

```sh
node $F/score.mjs $F     # today
```

| measure                                                          | today                              |
| ---------------------------------------------------------------- | ---------------------------------- |
| module-to-module imports that exist                              | 80 of 182                          |
| pairs of modules that import each other                          | 13                                 |
| largest group of modules that all reach each other               | 13 of 14                           |
| import statements that cross a module boundary                   | 247                                |
| share of imports between module files that stay in one module    | 83.4%                              |
| fewest import statements to cut so that no module reaches itself | 22, on 17 module-to-module imports |

The 247 crossing statements are of four kinds:

```sh
awk -F'\t' 'NR>1 && $1 ~ /^src\/modules\// && $2 ~ /^src\/modules\// {split($1,a,"/");split($2,b,"/"); if(a[3]==b[3]) next; k=($1 ~ /\.tsx$/)?"component":($1 ~ /\/functions\.ts$/)?"functions.ts":($6=="type")?"type-only":"service"; n[k]++} END{for(k in n) print n[k], k}' $F/imports.tsv
```

| kind                                      | statements |
| ----------------------------------------- | ---------- |
| service: a value import from a `.ts` file | 184        |
| a module's `functions.ts`                 | 35         |
| type-only                                 | 17         |
| from a component (`.tsx`)                 | 11         |

`functions.ts` is the module's wiring: the file a route imports, which
hands other modules' functions into the module's own code.
`docs/architecture.md:173-178` already describes those arrows as wiring,
and the diagram generator already draws them apart
(`scripts/diagrams/structure.ts:453`).

**Among service value imports there is one pair of modules, and the purge
makes it.**

```sh
awk -F'\t' 'NR>1 && $1 ~ /^src\/modules\// && $2 ~ /^src\/modules\// && $1 !~ /\/functions\.ts$|\.tsx$/ && $6=="value" {split($1,a,"/");split($2,b,"/"); if(a[3]!=b[3]) e[a[3]">"b[3]]=1} END{for(k in e){split(k,p,">"); if(p[1]<p[2] && ((p[2]">"p[1]) in e)) print k}}' $F/imports.tsv
```

It prints `account>feed`. The statement is
`src/modules/account/purge/purge.ts:86`. With `account/purge` left out it
prints nothing.

**With the wiring and the purge set aside as rows of their own, 3 pairs
are left, on 4 statements** (`aside.json`, appendix):

```sh
node $F/score.mjs $F aside.json
```

| statement                                                    | kind  | the pair                     | remedy                                                                                              |
| ------------------------------------------------------------ | ----- | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/modules/products/corrections.ts:30`                     | value | `products`/`safety`          | Design 258 proposal 3 ends the other direction (`safety/review/components/DeskCorrections.tsx:25`). |
| `src/modules/feed/consensus/components/ConditionsTab.tsx:29` | type  | `feed`/`onboarding`          | Design 258 proposal 2: `Place` goes to `src/lib/contracts`.                                         |
| `src/modules/runs/components/VerdictBacklog.tsx:22`          | type  | `feed`/`runs`                | New here: the backlog types go to `src/lib/contracts`.                                              |
| `src/modules/weather/store.ts:21`                            | type  | a longer cycle through `ops` | The `OutboxHandler` type could be declared in `src/lib/sql/outbox.ts`. Not checked.                 |

So the fourteen modules already have a direction in their service code.
Nothing states it, and nothing but a side effect holds it: `no-circular`
(`.dependency-cruiser.cjs:18`) works on files, and a module's parent door
re-exports most of the module, so a cycle between two modules is usually a
cycle between files. 18 source files explain where code sits, or why a
function is handed in, by that rule:

```sh
rg -l -i "would be a cycle|is a cycle|closed a cycle|a cycle through|cycle dependency-cruiser|the cycle the|without a cycle|import cycle" src/modules src/lib src/db --glob '!**/*.test.*' | wc -l
```

That side effect weakens as modules import narrower doors. A module that
imports `ops/outbox` and not `ops` makes no file cycle with `ops`, and
`docs/architecture.md:205-210` already plans one such import (#923). So
the direction needs to be stated before it is lost.

**The order the script finds is a chain, not layers.** The 22 statements
it would cut leave eleven modules in one line, most links one or two
statements wide. 17 of the 22 are a line in a `functions.ts`. Nobody could
name the rows between the bottom and the top, so a rule that fixed that
order would freeze today's imports as if they were a design.

**Which modules everything imports.** `email` is imported by 11 modules
and `auth` by 11. All eleven importers of `email` take the counters over
`rate_limits`, and five take nothing else (design 258 proposal 15).
`auth`'s importers take the gates, from wiring. `ops` is imported by 9 and
imports 6: it is a floor that imports no module (`ops/outbox`,
`ops/sentry`) and an operator's area (the Desk's pages, the daily jobs)
under one name. `dispatch` imports 11 and is imported by none, which is
what a composition module should look like.

### 3. Tables are shared through the schema

```sh
node $F/score.mjs $F | sed -n '/^tables a module names/,$p'
```

24 of the 60 tables have insert, update or delete statements in more than
one module, as the parser counts them: 39 (table, other module) pairs.
`notifications` is written from five modules, `user_profiles` and
`wardrobe_items` from four.

One reader opened every such statement and sorted them. With owners
corrected for five tables where the larger count is not the module that
makes the rows (`entry_photos`, `follow_notices`, and Better Auth's three):

| kind                                                                                       | statements seen                                                                                                 |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| the purge's deletes                                                                        | 10, and 13 more in two arrays the parser cannot read (`src/modules/account/purge/purge.ts:598-613`, `:620-627`) |
| a column another area sets on the row (a moderation or screening status, a weather status) | 24                                                                                                              |
| a row another area deletes or edits as a consequence of its own write                      | 21                                                                                                              |
| a table two or more modules both own                                                       | 18                                                                                                              |
| a row another area creates                                                                 | 1                                                                                                               |

The schema declares two foreign keys, both in `src/db/schema-auth.ts`
(`rg -n "references\(" src/db/schema-*.ts`). Every other reference is a
text column named for its target, so a consequence in another area's table
is written by hand, in the batch of the module that causes it.

The repo already has a way for a batch to cross a boundary without naming
the other module's table: the owner exports a function that returns a
statement, and the caller puts it in its batch (`outboxInsert`,
`notificationInsert`, `settleOpenReviews`, `gaveUpClear`). It is used
where the import can point that way. Where it cannot, the statement names
the table.

### 4. What changes together is not what imports each other

```sh
node cochange.mjs $F 96055f7cd48d54e07420c37294d0694eec387b15
```

Of 446 first-parent merges, 265 changed a non-test file under
`src/modules`. 85 changed exactly one module. 26 changed more than six and
are left out of the pairs.

| pair                       | merges that changed both | import statements between them |
| -------------------------- | ------------------------ | ------------------------------ |
| `feed` and `safety`        | 40                       | 18 one way                     |
| `account` and `safety`     | 37                       | 8                              |
| `closet` and `feed`        | 32                       | 6                              |
| `ops` and `safety`         | 32                       | 11                             |
| `closet` and `runs`        | 18                       | 0                              |
| `account` and `onboarding` | 16                       | 0                              |

`email` changed with another module in 28 merges, and in 16 of them the
only `email` file changed was `src/modules/email/content.ts`, which holds
every email's words. That is the one cause of crossing with a count behind
it. The others the reader found by opening merges: a Desk page spans
several modules, a screen's components sit in several areas, and a
runner's setting is `onboarding`'s whatever feature it belongs to.

### 5. The areas, derived without the folders

Grouping the 60 tables by what must change together, then by vocabulary,
gives 35 clusters in 14 areas. Where they differ from the fourteen
modules:

| derived area                                                                       | today                                                                                                                              |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Kits (the entry, its items, tags and photos) and Feed (follows, reactions, blocks) | one module, `feed`, named for the smaller part                                                                                     |
| Conditions (a run's span, class and band)                                          | split: `weather` writes one half of `run_conditions`, `feed` the other; held by `test/architecture/run-conditions-writers.test.ts` |
| Profile (`user_profiles`, `username_history`)                                      | no module: written by `onboarding`, `account`, `safety` and `auth`                                                                 |
| Moderation (13 tables)                                                             | `safety`, with Desk decisions on content carried out in `feed/moderation`                                                          |
| Notices                                                                            | `notifications`, with the email switch in `email`                                                                                  |
| Operations (`outbox`, `gave_up`, `cron_checkpoints`, `rate_limits`, `perf_daily`)  | `ops`, with the counters in `email` and the gave-up writer in `src/db`                                                             |
| Closet, Runs, Products, Weather, Account, Access, Strava reminders                 | match a module or a sub-module                                                                                                     |

Five things have a name and no table of their own: onboarding (one
boolean column, and writes into three areas), the Desk (each page reads
another area's rows), enrichment (columns of `products`), the conditions
consensus (a read) and the operator (eleven columns in nine tables).

The derivation also reads the status columns differently from the import
graph. `outfit_entries.moderation_status`, `entry_photos.screen_status`,
`wardrobe_items.visibility`, `products.status` and
`user_profiles.banned_at` are Moderation's facts kept on another area's
row. By that reading `safety` writing them is the owner writing its own
column, and what is missing is a list that says so, not a move.

Eleven of the thirteen tables the candidates place differently are ones
the derivation itself lists as fitting nowhere cleanly. So the domain gives no firm
second opinion on most of the hard cases. It agrees with today's cut on
the rest.

### 6. The processes

The catalogue, read by hand by one agent: 87 POST server functions in
eleven `functions.ts` files, 14 route files with handlers, six queues,
four crons that run 39 steps. Of 79 batches that write, 56 write tables
that the count gives to more than one module: 20 only because they also
write `outbox`, `notifications`, `rate_limits` or `gave_up`, and 35
because two areas' own tables are in one transaction.

Most processes are one area doing its own job. Four have the whole job of
visiting every area, and each is built differently:

- **The purge** deletes from 21 tables it does not own, by name
  (`src/modules/account/purge/purge.ts`), and reaches seven more through
  the owning module's function.
- **The export** reads ten tables of five modules by name
  (`src/modules/account/export-build/export.ts:61-123`).
- **The scheduled upkeep** keeps 21 of its 39 steps in the area's module,
  12 in `ops` and 6 in `dispatch` (design 258 proposals 5 and 6 move the
  six).
- **A Desk decision** on a kit's photo runs `feed`, `safety`, `feed`,
  `safety`, `feed/entries`. The Desk has no module: its 36 server
  functions are in `safety`, `account`, `feed` and `ops`.

Every candidate layout keeps every batch whole. They differ in how a batch
reaches the other area: an import downward, the owner's exported
statement, or a function passed as a parameter.

### 7. Where it works and where it strains

It works where an area has its own tables and one job: `enrichment`,
`products`, `weather`, `runs/parsers`, `runs/imports`, `safety/review`,
`safety/takedowns`. The floor units are narrow and import no module.
Handing a function in through `functions.ts` does its job.

It strains where something cuts across the features, because each such
thing sits inside one feature:

1. **The Desk** is one route folder wired from four modules, with its
   retries in `ops/desk` writing `runs`' tables and its pages for products
   and runners in `safety`.
2. **The runner's profile row** has four writing modules, and reads of it
   are placed by what would not cycle
   (`src/modules/notifications/viewer-zone.ts`, `src/db/runner-standing.ts`).
3. **Every email's words** are in one file of `email`.
4. **The purge and the export** name other modules' tables.
5. **`ops` and `email` are each a floor and a feature.**
6. **The open web** is in three modules: `feed/public-web`,
   `ops/public-web` and `src/modules/closet/public-rotation.ts`.
7. **A run's delete is in `feed`**
   (`src/modules/feed/entries/retract.ts:20-25` gives a cycle as the
   reason; whether it still holds after design 256 was not settled).

## The three candidate layouts

Each was built by an agent holding one stance, written as a layout file
(appendix) and scored by the same script.

- **Layered.** Keep the fourteen, declare an order, move no file. It
  scores four parts of modules as rows of their own: `ops/outbox` with
  `ops/sentry`, `safety/rules`, `account/purge`, and every `functions.ts`.
- **Contexts.** Thirteen modules cut by the derived areas: `profile`,
  `desk` and `visibility` are new, `auth`, `enrichment` and `email` are
  merged away, `feed/moderation` goes to `safety`, and `safety` sits above
  the content it moderates.
- **Coarse.** Six modules in one order: `platform`, `safety`, `closet`,
  `kits`, `account`, `ops`.

```sh
for l in layered contexts coarse; do node $F/score.mjs $F $l.json; done
```

| measure                                        | today     | layered   | contexts | coarse |
| ---------------------------------------------- | --------- | --------- | -------- | ------ |
| modules scored                                 | 14        | 18        | 13       | 6      |
| files in a module with another name than today | 0         | 0 on disk | 177      | 355    |
| pairs that import each other                   | 13        | 3         | 21       | 6      |
| largest group that all reach each other        | 13        | 9         | 12       | 5      |
| statements that cross a boundary               | 247       | 393       | 323      | 245    |
| fewest statements to cut                       | 22        | 3         | 52       | 23     |
| statements up a declared layer                 | no layers | 3         | 67       | 23     |
| tables with more than one writing module       | 24        | 30        | 25       | 20     |
| (table, other writing module) pairs            | 39        | 48        | 40       | 30     |

How to read it:

- **Layered's 3 pairs are today's.** They are the three pairs of finding
  2, and the layout moves no file. Its higher crossing and table counts
  are the four carved-out rows being counted as modules. Its proposer's
  own objection: the rule is eight rows between the floor and the dispatch
  that no one can name.
- **Contexts scores worse than today on today's files**, partly because
  the score cannot split a door file. Its proposer modelled nine file
  splits and ten new hand-ins by hand and reached 8 pairs. Those were not
  checked row by row. Either way it moves 177 files, takes `safety`'s
  fan-out from 8 to 10 against a pin of 8, and reverses the recorded
  direction between `feed` and `safety` (`docs/architecture.md:53-57`).
- **Coarse changes almost nothing that depends on anything.** 247 crossing
  statements become 245.

**What merging alone buys.** The coarse layout's merges with no file moved
out of its module:

```sh
M=src/modules
node $F/score.mjs $F <(echo '{"name":"coarse, whole modules only","modules":{"platform":{"paths":["'$M'/email","'$M'/notifications"]},"closet":{"paths":["'$M'/closet","'$M'/products","'$M'/enrichment"]},"kits":{"paths":["'$M'/feed","'$M'/runs","'$M'/weather"]},"account":{"paths":["'$M'/account","'$M'/auth","'$M'/onboarding"]},"ops":{"paths":["'$M'/ops","'$M'/dispatch"]}}}')
```

It gives 11 pairs, 211 crossing statements, 48 statements to cut, 20
tables with more than one writing module and 27 pairs. So merging gives
all of the table gain, by putting two writers under one name, and makes
the order worse. What repairs the order in the full coarse layout is the
one split it makes: `ops`' floor from the rest of `ops`.

**What a pull request would touch.** Each past merge, with each changed
file placed in the module the layout gives it (`hist`, appendix):

| layout   | merges | changed one module | mean modules changed |
| -------- | ------ | ------------------ | -------------------- |
| today    | 239    | 85                 | 2.55                 |
| contexts | 239    | 84                 | 2.60                 |
| coarse   | 239    | 96                 | 2.18                 |

Going from fourteen modules to six keeps 11 more merges of 239 inside one
module. The work crosses because of what it is (finding 4), and no
candidate removes one of those causes.

**Where all three agree.** A move that every stance makes is the strongest
finding, whatever the top level is:

1. Service code gets a stated direction, and a module's `functions.ts` is
   outside it.
2. `ops/outbox` and `ops/sentry` are a floor under every area. The Desk's
   pages and the daily jobs are not on it.
3. The purge is composition and sits above what it deletes from.
4. The sweeps leave `dispatch/scheduled.ts` (design 258 proposals 5, 6).
5. The Desk's retries call the owner's door (design 258 proposal 7), and
   the weather retry at `src/modules/ops/desk/gave-up.ts:317` with it.
6. The runner-standing clauses leave `src/db` (design 258 proposal 4).
7. The pair `products`/`safety` ends (design 258 proposal 3).
8. The two component type imports of finding 2 go.

Items 4 to 7 are design 258's proposals, and so is half of item 8.

## What is recommended

The comparison recommended a hybrid: keep the fourteen, name four layers,
move eight files, put about 22 writes behind the owning module's door, and
later have the purge ask each owner for its step. The challenger re-ran
every number, found them right, and showed that several of the gains were
relabels. What survived both is below. It is design 258 and about three
pull requests more.

1. **Keep the fourteen modules.** No merge, split or rename.
2. **Design 258's proposals stand**, in its order. One changes: proposal 7
   is widened to the weather retry. Proposals 13 and 14 no longer wait: no
   decomposition is coming that would redo them.
3. **State the direction and hold it with a number** (S). "No module
   reaches itself through service code." Outside it: each `functions.ts`
   (the wiring), and `account/purge` and `dispatch` (composition).
   Components and type-only imports are held to it. A short list of floor
   units is counted apart from their parent, so that a module `ops`
   imports may import them: `ops/outbox`, `ops/sentry`, `safety/rules`,
   and no more. The number is 4 statements today with nothing counted
   apart (finding 2), and 3 once the floor units are (`layered.json`'s
   score). Each has a remedy. It needs a D-row beside D-201 and a grant
   in the owner's files (owner question 1).
4. **The backlog types go to `src/lib/contracts`** (S), in the lane that
   does design 258 proposal 2. It ends
   `src/modules/runs/components/VerdictBacklog.tsx:22`.
5. **A list of table writers, as a test** (S). One row per (table, writing
   module), about 39 rows, with the owner of each table and of each status
   column another area keeps on it. A new writer fails until it is listed.
   Its header says it is a floor. Two tests of this kind exist for single
   tables (`test/architecture/weather-tables.test.ts`,
   `run-conditions-writers.test.ts`).
6. **Four statements go to where the rule is already written** (S, each
   folded into a lane that already edits the file):
   - `src/modules/feed/entries/entries.ts:354` sets a run's effort; what
     "the runner's pick" means is `runs`'.
   - `src/modules/ops/desk/gave-up.ts:317` is a second copy of a status
     write `runs` has; it needs a new export, since the existing function
     also re-attaches at once.
   - `src/modules/feed/moderation/removal-requests.ts:86` sets a request's
     status in `safety/takedowns`' words.
   - `src/modules/feed/moderation/garment-moderation.ts:198` is a second
     copy of `src/modules/closet/photos.ts:346`. It waits on design 258
     proposal 14, because `closet`'s door is at its budget.

### What the challenger dropped, and why

- **The floor as a layer that grows.** Moving the counters
  (`src/modules/email/rate-limit.ts`) and `src/db/gave-up.ts` into `ops`
  is a relabel: the same 18 and 8 files import the same names. It also
  adds pairs between `ops` and the modules `ops/desk` imports, which is
  the reason design 258 gave for leaving `gave-up.ts` where it is. What is
  left of it: `gave-up.ts` is owed a mutation entry wherever it lives.

  ```sh
  awk -F'\t' '$2=="src/modules/email/index.ts" && $1 !~ /^src\/modules\/email\// && $7 ~ /claim|count|forget|isWithin|limit|sendClaimOf|sweepRate/{print $1}' $F/imports.tsv | sort -u | wc -l
  awk -F'\t' '$2=="src/db/gave-up.ts"{print $1}' $F/imports.tsv | sort -u | wc -l
  ```

- **Bell rows through `notifications`.** The nine statements are nine
  different statements whose predicates belong to their callers. Each
  would become an exported function with one caller. `notifications` would
  be named as often as before, and its door would widen from 15 names
  towards 24.
- **Most of "a run's rows through `runs`".** Two of the rows are not
  statements, and two are a run's delete, which waits on where that delete
  should live (strain 7).
- **Importing what is handed in today.** The parameters for the reporter
  and the outbox are how those modules' tests pass a fake. Only #923,
  already tracked, and design 258 proposal 12 survive.
- **The purge asking each owner, as a lane.** `account` would import
  `closet`, `products` and `onboarding` as well: fan-out 9 to 12 against a
  pin that may only fall. It stays a question (owner question 4).
- **The table numbers as a gain.** Tables with more than one writing
  module fall when a statement changes file. The modules that name each
  table stay the same.
- **Every "0 pairs" that depends on counting a sub-module as a module.**
  On the fourteen folders the honest numbers are the 3 pairs and 4
  statements of finding 2.

## Considered and rejected

- **The contexts layout** (cut by domain). 177 files move, nine files are
  split, ten functions become parameters, and two recorded decisions are
  reversed, for the same number of modules per pull request. What it buys
  that nothing else does is one writing module per table, and the domain
  derivation reads the contested columns as Moderation's own.
- **The coarse layout** (six modules). 355 files change module and almost
  nothing changes that depends on anything. It merges nine `functions.ts`
  into three and makes the fan-out budget unable to bind.
- **The layered layout's eleven fixed rows.** Right about what is true
  today, and its rule 1 is recommended in a smaller form. The rows have no
  reason a person could give, so the first feature that needs an import
  the other way would meet a rule with nothing behind it.
- **A top-level `platform` or `desk` module as a single move.** Scored on
  today's imports, neither changes the count of pairs (13 each), because
  importers use `ops/index.ts` and because `ops/owed-email`, `ops/edge`
  and `ops/public-web` import areas too.

  ```sh
  node $F/score.mjs $F <(echo '{"name":"platform","modules":{"platform":{"paths":["src/modules/ops/outbox","src/modules/ops/sentry","src/modules/email/rate-limit.ts","src/db/gave-up.ts"]}}}')
  node $F/score.mjs $F <(echo '{"name":"desk","modules":{"desk":{"paths":["src/modules/ops/desk","src/modules/ops/daily","src/modules/ops/functions.ts","src/modules/ops/inputs.ts"]}}}')
  ```

- **Moving `feed/moderation` into `safety`.** Design 258 rejected it. Two
  of the three stances leave it, and the score agrees: as a single move it
  takes the pairs from 13 to 14 and the statements to cut from 22 to 31.

  ```sh
  node $F/score.mjs $F <(echo '{"name":"moderation into safety","modules":{"safety":{"paths":["src/modules/feed/moderation"]}}}')
  ```

- **Renaming `feed`.** It holds the kit, and only `feed/following` is a
  feed. The rename is 104 source files and their tests for a name.

## What no candidate addresses

These are the strains of finding 7 that survive every layout. None has a
lane here. Each is a question for the owner or a design of its own.

1. **The Desk has no home.** Design 258 said the first step towards any
   move of `feed/moderation` is to draw a Desk decision as a flow. At the
   pin no flow did. Since then main has drawn one for a removal request
   (`docs/diagrams/flows/removals.c4`, the view `removalDecision`); a
   decision on a photo from the review queue is not drawn.
2. **Every email's words are in `email/content.ts`.** No stance proposed
   moving a word.
3. **The export** reads ten tables by name, and every rule proposed here
   is about writes. The pairs where a module names another's table at all
   are 95 today, and no proposal changes that by more than one.
4. **A run's delete** lives in `feed` for a reason that may be gone.
5. **Two steps sit in a module because of when they run**:
   `sweepCopyrightHolds` in `feed/moderation` and `oweRemovalReminders` in
   `ops/daily`.
6. **The open web** is one surface in three modules.

## Contract touches

None. No code changes.

## Test plan

No code changes, so no tests. If the owner takes recommendations 3 and 5,
each is itself a test: a fifth number in the module ratchet, and a
table-writer list under `test/architecture/`.

## Issues

- Refs #850 (step 4b). Closes nothing.
- Opens: #1005, the eight questions below, in Needs owner.
- Design 258's proposals 13 and 14, which waited on this review, are
  released by it.

## Questions for the owner

The owner answered these on 2026-11-23. The rulings are in design 261,
and two of them go further than the recommendations here (questions 4
and 5).

1. **A direction between modules.** (a) None, as today. (b) One sentence
   in `docs/architecture.md`, held by nothing. (c) A number in the ratchet,
   "modules that reach themselves through service code", with the wiring,
   the purge and `dispatch` outside it and three floor units counted apart.
   Recommended: (c). It needs a D-row and a grant for
   `scripts/modules/shape.ts`. (b) stops being true when #923 lands.
2. **A list of table writers as a test.** Recommended: yes, at the grain
   of (table, module), with status columns listed as their setter's.
3. **Does `safety` stay under the content it moderates?** (a) Yes; its
   status columns are listed as its own, and `docs/architecture.md:53-57`
   stands. (b) No; `safety` sits over `feed`, `closet` and `products` and
   asks each owner's door. Recommended: (a), and draw a Desk decision on a
   photo as a flow before this is asked again.
4. **The purge.** (a) As it is. (b) Each owner exports the statements
   that forget one runner and `account/purge` composes them; `account`'s
   fan-out pin would have to rise from 9 to 12. Recommended: (a) for now.
   Today a new table that names a runner is added to
   `src/modules/account/purge/purge.ts:598-613` by hand.
5. **The counters and `src/db/gave-up.ts`** (design 258's question 2 and
   proposal 15). (a) Where they are, with a mutation entry for
   `gave-up.ts`. (b) `ops/limits` and `ops/gave-up`. Recommended: (a).
   (b) is a relabel that costs pairs.
6. **The runner's profile row.** (a) Leave `user_profiles` with four
   writing modules and list them by column. (b) A `profile` module.
   Recommended: (a). Under (b), 16 of the 20 writes would only change
   folder.
7. **Every email's words in one file.** It is the one measured cause of
   pull requests crossing modules. Worth a design of its own? Not designed
   here.
8. **Design 258's proposals 13 and 14.** Recommended: go ahead, 14 first.

## Not checked

- No tool was run but the scripts in the appendix. Every "no cycle" is
  read from import rows a parser wrote with no type checker.
- That a module cycle in service code is a file cycle today, which is why
  `no-circular` has held the direction so far, is read from code comments
  and import rows. No cruise was run.
- The ratchet number of recommendation 3 was not written. That it would
  read 4 rests on `aside.json`'s score.
- Whether `OutboxHandler` can be declared in `src/lib/sql/outbox.ts`
  without the two names declared beside it.
- The sort of table writes (finding 3), the process catalogue (finding 6)
  and the derived areas (finding 5) are each one agent's reading. The
  counts beside a command were re-run; the hand counts were not.
- The contexts proposer's modelled splits and hand-ins.
- `hist` traces a changed file by its path, then by its name within its
  module. A file renamed and moved is counted where its old path was.
- Door widths, file budgets and mutation entries after any recommended
  step.

## Appendix: the scripts and the layout files

<details>
<summary><code>graph.mjs</code>: the file graph and the table references</summary>

```js
// The file-level import graph of src, and which file touches which table.
// Throwaway measuring script for design 260. Run from the repo root:
//   node <this file> <out-dir>
// Parses every non-test .ts/.tsx under src with the TypeScript parser (no
// type checker), resolves relative and #/ @/ specifiers, and writes
//   files.tsv    file, unit, module, lines
//   imports.tsv  one row per import of one src file by another
//   tables.tsv   one row per place a file names a schema table
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

const ts = createRequire(
  process.env.TS_FROM ?? path.join(process.cwd(), "package.json"),
)("typescript");
const out = process.argv[2];
if (!out) throw new Error("usage: node graph.mjs <out-dir>");
mkdirSync(out, { recursive: true });

const TEST = /\.(?:test|spec)\.tsx?$|\/__tests__\/|\/test-/u;

function walk(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, found);
    else if (
      /\.tsx?$/u.test(name) &&
      !name.endsWith(".d.ts") &&
      !TEST.test(full)
    )
      found.push(full);
  }
  return found;
}

const files = walk("src").sort();
const fileSet = new Set(files);

function resolve(from, spec) {
  let base;
  if (spec.startsWith(".")) base = path.join(path.dirname(from), spec);
  else if (spec.startsWith("#/") || spec.startsWith("@/"))
    base = path.join("src", spec.slice(2));
  else return undefined;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]) {
    if (fileSet.has(candidate)) return candidate;
  }
  return undefined;
}

/** The unit a file is in: its module or sub-module, or its area of src. */
function unitOf(file) {
  const parts = file.split("/");
  if (parts[1] === "modules") {
    let dir = path.dirname(file);
    while (dir.split("/").length > 3 && !fileSet.has(`${dir}/index.ts`))
      dir = path.dirname(dir);
    return dir.slice("src/modules/".length);
  }
  if (parts[1] === "routes")
    return parts.length > 3 ? `routes/${parts[2]}` : "routes";
  if (parts[1] === "lib") return parts.length > 3 ? `lib/${parts[2]}` : "lib";
  return parts.length > 2 ? parts[1] : "src";
}
const moduleOf = (file) =>
  file.startsWith("src/modules/") ? file.split("/")[2] : "";

// --- the schema's tables: exported consts built by sqliteTable() ---
const tables = new Map(); // `${schemaFile}#${symbol}` -> { symbol, schemaFile, sqlName }
const sources = new Map();
for (const file of files) {
  sources.set(
    file,
    ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    ),
  );
}
for (const [file, source] of sources) {
  if (!/^src\/db\/schema[^/]*\.ts$/u.test(file)) continue;
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const init = declaration.initializer;
      if (
        init &&
        ts.isCallExpression(init) &&
        init.expression.getText(source) === "sqliteTable"
      ) {
        const symbol = declaration.name.getText(source);
        const sqlName = ts.isStringLiteralLike(init.arguments[0])
          ? init.arguments[0].text
          : "?";
        tables.set(`${file}#${symbol}`, { symbol, schemaFile: file, sqlName });
      }
    }
  }
}

const WRITES = new Map([
  ["insert", "insert"],
  ["update", "update"],
  ["delete", "delete"],
]);
const READS = new Set([
  "from",
  "innerJoin",
  "leftJoin",
  "rightJoin",
  "fullJoin",
  "crossJoin",
]);
// Helpers that take a table and write it (read at the pinned commit):
// safety/screening/screening.ts, safety/review/review.ts,
// feed/entries/retract.ts and lib/sql/claim.ts.
const WRITE_HELPERS = new Set([
  "updateWhilePending",
  "setOnSubject",
  "retractScoped",
  "retractOneOf",
  "didClaim",
]);

const importRows = [];
const tableRows = [];
const lineOf = (source, node) =>
  source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

for (const [file, source] of sources) {
  const local = new Map(); // local identifier -> table key
  const namespaces = new Map(); // local namespace identifier -> schema file

  function addImport(node, spec, names, typeOnly) {
    const to = resolve(file, spec);
    if (!to) return undefined;
    importRows.push([
      file,
      to,
      lineOf(source, node),
      unitOf(file),
      unitOf(to),
      typeOnly ? "type" : "value",
      names.join(","),
    ]);
    return to;
  }

  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const clause = statement.importClause;
      const names = [];
      let typeOnly = Boolean(clause?.isTypeOnly);
      const bindings = clause?.namedBindings;
      if (clause?.name) names.push("default");
      if (bindings && ts.isNamespaceImport(bindings)) names.push("*");
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements)
          names.push((element.propertyName ?? element.name).text);
        if (
          !clause.name &&
          bindings.elements.length > 0 &&
          bindings.elements.every((e) => e.isTypeOnly)
        )
          typeOnly = true;
      }
      const to = addImport(
        statement,
        statement.moduleSpecifier.text,
        names,
        typeOnly,
      );
      if (to && bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const key = `${to}#${(element.propertyName ?? element.name).text}`;
          if (tables.has(key)) local.set(element.name.text, key);
        }
      }
      if (
        to &&
        bindings &&
        ts.isNamespaceImport(bindings) &&
        /^src\/db\/schema/u.test(to)
      ) {
        namespaces.set(bindings.name.text, to);
      }
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const clause = statement.exportClause;
      const names =
        clause && ts.isNamedExports(clause)
          ? clause.elements.map((e) => (e.propertyName ?? e.name).text)
          : ["*"];
      addImport(
        statement,
        statement.moduleSpecifier.text,
        names,
        statement.isTypeOnly,
      );
    }
  }

  function access(node) {
    // node is the expression naming the table
    const parent = node.parent;
    if (
      ts.isCallExpression(parent) &&
      parent.arguments[0] === node &&
      ts.isPropertyAccessExpression(parent.expression)
    ) {
      const method = parent.expression.name.text;
      if (WRITES.has(method)) return WRITES.get(method);
      if (READS.has(method)) return "read";
      return WRITE_HELPERS.has(method)
        ? `write-helper:${method}`
        : `arg:${method}`;
    }
    if (ts.isCallExpression(parent) && parent.arguments.includes(node)) {
      const helper = parent.expression.getText(source).split(".").pop();
      return WRITE_HELPERS.has(helper)
        ? `write-helper:${helper}`
        : `arg:${helper}`;
    }
    if (ts.isPropertyAccessExpression(parent) && parent.expression === node)
      return "column";
    if (ts.isTypeQueryNode(parent)) return "type";
    return "other";
  }

  function visit(node) {
    if (ts.isImportDeclaration(node)) return;
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteralLike(argument))
        addImport(node, argument.text, ["*"], false);
    }
    if (ts.isIdentifier(node) && local.has(node.text)) {
      const parent = node.parent;
      const isName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        ((ts.isVariableDeclaration(parent) ||
          ts.isParameter(parent) ||
          ts.isBindingElement(parent)) &&
          parent.name === node);
      if (!isName) {
        const table = tables.get(local.get(node.text));
        tableRows.push([
          table.symbol,
          table.sqlName,
          table.schemaFile,
          file,
          lineOf(source, node),
          access(node),
          unitOf(file),
          moduleOf(file),
        ]);
      }
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      namespaces.has(node.expression.text)
    ) {
      const key = `${namespaces.get(node.expression.text)}#${node.name.text}`;
      if (tables.has(key)) {
        const table = tables.get(key);
        tableRows.push([
          table.symbol,
          table.sqlName,
          table.schemaFile,
          file,
          lineOf(source, node),
          access(node),
          unitOf(file),
          moduleOf(file),
        ]);
      }
    }
    ts.forEachChild(node, visit);
  }
  if (!/^src\/db\/schema[^/]*\.ts$/u.test(file)) visit(source);
}

const tsv = (header, rows) =>
  `${[header, ...rows].map((row) => row.join("\t")).join("\n")}\n`;
writeFileSync(
  path.join(out, "files.tsv"),
  tsv(
    ["file", "unit", "module", "lines"],
    files.map((file) => [
      file,
      unitOf(file),
      moduleOf(file),
      readFileSync(file, "utf8").split("\n").length,
    ]),
  ),
);
writeFileSync(
  path.join(out, "imports.tsv"),
  tsv(
    ["from", "to", "line", "fromUnit", "toUnit", "kind", "names"],
    importRows,
  ),
);
writeFileSync(
  path.join(out, "tables.tsv"),
  tsv(
    [
      "table",
      "sqlName",
      "schemaFile",
      "file",
      "line",
      "access",
      "unit",
      "module",
    ],
    tableRows,
  ),
);
console.log(
  `${files.length} files, ${importRows.length} imports, ${tables.size} tables, ${tableRows.length} table references`,
);
```

</details>

<details>
<summary><code>score.mjs</code>: scores a layout</summary>

```js
// Scores a layout of src/modules: today's, or a candidate given as a mapping.
// Throwaway measuring script for design 260. Reads the tables graph.mjs wrote.
//   node score.mjs <facts-dir>                 today's fourteen modules
//   node score.mjs <facts-dir> <layout.json>   a candidate
// layout.json: { "name": "...", "modules": { "<module>": { "layer": 1,
//   "paths": ["src/modules/email", "src/modules/ops/sentry", "src/db/gave-up.ts"] } } }
// A file goes to the module with the longest path that is the file or a folder
// above it. A file under src/modules that no path names stays in the module it
// is in today. "layer" is optional: a higher layer may import a lower one.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [facts, layoutPath] = process.argv.slice(2);
if (!facts) throw new Error("usage: node score.mjs <facts-dir> [layout.json]");
const read = (name) =>
  readFileSync(path.join(facts, name), "utf8")
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.split("\t"));
const layout = layoutPath
  ? JSON.parse(readFileSync(layoutPath, "utf8"))
  : { name: "today", modules: {} };

const claims = Object.entries(layout.modules).flatMap(([module, spec]) =>
  spec.paths.map((p) => [p.replace(/\/$/u, ""), module]),
);
const layerOf = Object.fromEntries(
  Object.entries(layout.modules).map(([module, spec]) => [module, spec.layer]),
);
function moduleOf(file) {
  let best;
  for (const [claimed, module] of claims) {
    if (
      (file === claimed || file.startsWith(`${claimed}/`)) &&
      (!best || claimed.length > best[0].length)
    )
      best = [claimed, module];
  }
  if (best) return best[1];
  return file.startsWith("src/modules/") ? file.split("/")[2] : undefined;
}

const files = read("files.tsv").map(([file, , , lines]) => ({
  file,
  module: moduleOf(file),
  lines: Number(lines),
}));
const inModule = new Map(
  files.filter((f) => f.module).map((f) => [f.file, f.module]),
);
const modules = [...new Set(inModule.values())].sort();
const unclaimed = claims.filter(
  ([claimed]) =>
    !files.some((f) => f.file === claimed || f.file.startsWith(`${claimed}/`)),
);
if (unclaimed.length > 0)
  console.log(
    `PATHS THAT MATCH NO FILE: ${unclaimed.map(([p]) => p).join(", ")}`,
  );

// --- the module graph ---
const weight = new Map(); // "a>b" -> import statements
const crossing = new Set(); // "toFile#name"
const crossingFiles = new Set();
let inside = 0;
let across = 0;
for (const [from, to, , , , , names] of read("imports.tsv")) {
  const a = inModule.get(from);
  const b = inModule.get(to);
  if (!a || !b) continue;
  if (a === b) {
    inside += 1;
    continue;
  }
  across += 1;
  weight.set(`${a}>${b}`, (weight.get(`${a}>${b}`) ?? 0) + 1);
  crossingFiles.add(from);
  for (const name of names.split(",")) crossing.add(`${to}#${name}`);
}
const has = (a, b) => weight.has(`${a}>${b}`);
const outOf = (m) => modules.filter((x) => has(m, x));
const mutual = [];
for (const a of modules)
  for (const b of modules)
    if (a < b && has(a, b) && has(b, a)) mutual.push(`${a}<->${b}`);
function reach(start) {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0)
    for (const next of outOf(queue.pop()))
      if (!seen.has(next)) seen.add(next) && queue.push(next);
  return seen;
}
const reaches = Object.fromEntries(modules.map((m) => [m, reach(m)]));
const groups = modules.map((m) =>
  modules.filter((x) => reaches[m].has(x) && reaches[x].has(m)),
);
const largest = groups.reduce((a, b) => (b.length > a.length ? b : a), []);

console.log(`layout: ${layout.name}`);
const sizes = modules
  .map((m) => [m, files.filter((f) => f.module === m).length])
  .sort((a, b) => b[1] - a[1]);
console.log(
  `modules: ${modules.length}; files in them: ${inModule.size}; sizes: ${sizes.map(([m, n]) => `${m} ${n}`).join(", ")}`,
);
console.log(
  `module-to-module imports that exist: ${weight.size} of ${modules.length * (modules.length - 1)} possible`,
);
console.log(
  `pairs that import each other: ${mutual.length}${mutual.length ? `: ${mutual.join(", ")}` : ""}`,
);
console.log(
  `largest group of modules that all reach each other: ${largest.length}${largest.length > 1 ? ` (${largest.join(", ")})` : ""}`,
);
console.log(
  `fan-out: ${modules.map((m) => `${m} ${outOf(m).length}`).join(", ")}`,
);
console.log(
  `fan-in: ${modules.map((m) => `${m} ${modules.filter((x) => has(x, m)).length}`).join(", ")}`,
);
console.log(
  `import statements that cross a module boundary: ${across}, from ${crossingFiles.size} files, of ${crossing.size} distinct names`,
);
console.log(
  `share of module-to-module-or-own imports that stay inside the module: ${((100 * inside) / (inside + across)).toFixed(1)}%`,
);

// --- the fewest import statements to cut so that no modules cycle ---
if (modules.length <= 18) {
  const n = modules.length;
  const w = modules.map((a) =>
    modules.map((b) => weight.get(`${a}>${b}`) ?? 0),
  );
  const best = new Float64Array(1 << n).fill(Infinity);
  const pick = new Int8Array(1 << n).fill(-1);
  best[0] = 0;
  for (let mask = 0; mask < 1 << n; mask += 1) {
    if (best[mask] === Infinity) continue;
    for (let v = 0; v < n; v += 1) {
      if (mask & (1 << v)) continue;
      let cost = 0; // v sits above everything in mask; an import of v from below is cut
      for (let u = 0; u < n; u += 1) if (mask & (1 << u)) cost += w[u][v];
      const next = mask | (1 << v);
      if (best[mask] + cost < best[next]) {
        best[next] = best[mask] + cost;
        pick[next] = v;
      }
    }
  }
  const order = [];
  for (let mask = (1 << n) - 1; mask; mask &= ~(1 << pick[mask]))
    order.unshift(modules[pick[mask]]);
  const cut = [];
  for (let i = 0; i < n; i += 1)
    for (let j = i + 1; j < n; j += 1)
      if (has(order[i], order[j]))
        cut.push(
          `${order[i]}>${order[j]} (${weight.get(`${order[i]}>${order[j]}`)})`,
        );
  console.log(
    `fewest import statements to cut for no module to reach itself: ${best[(1 << n) - 1]}, on ${cut.length} module-to-module imports: ${cut.join(", ")}`,
  );
  console.log(
    `  the order that leaves those, lowest first: ${order.join(" < ")}`,
  );
}

// --- declared layers ---
if (Object.values(layerOf).some((layer) => layer !== undefined)) {
  const up = [...weight.entries()].filter(([edge]) => {
    const [a, b] = edge.split(">");
    return (
      layerOf[a] !== undefined &&
      layerOf[b] !== undefined &&
      layerOf[a] < layerOf[b]
    );
  });
  const level = [...weight.entries()].filter(([edge]) => {
    const [a, b] = edge.split(">");
    return layerOf[a] !== undefined && layerOf[a] === layerOf[b];
  });
  console.log(
    `imports from a lower layer to a higher one: ${up.length} module-to-module, ${up.reduce((sum, [, n]) => sum + n, 0)} statements: ${up.map(([e, n]) => `${e} (${n})`).join(", ")}`,
  );
  console.log(
    `imports inside one layer: ${level.length} module-to-module, ${level.reduce((sum, [, n]) => sum + n, 0)} statements`,
  );
  const unlayered = modules.filter((m) => layerOf[m] === undefined);
  if (unlayered.length > 0)
    console.log(`modules with no layer: ${unlayered.join(", ")}`);
}

// --- tables ---
const isWrite = (access) =>
  /^(?:insert|update|delete|write-helper:)/u.test(access);
const byTable = new Map();
for (const [table, , schemaFile, file, , access] of read("tables.tsv")) {
  const module = inModule.get(file);
  if (!module || access === "type") continue;
  const entry = byTable.get(table) ?? {
    schemaFile,
    writes: new Map(),
    touches: new Map(),
  };
  if (isWrite(access))
    entry.writes.set(module, (entry.writes.get(module) ?? 0) + 1);
  entry.touches.set(module, (entry.touches.get(module) ?? 0) + 1);
  byTable.set(table, entry);
}
const rows = [];
let foreignWrites = 0;
let foreignTouches = 0;
const multi = [];
for (const [table, entry] of [...byTable.entries()].sort()) {
  const writers = [...entry.writes.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const home = writers[0]?.[0] ?? "";
  const others = [...entry.touches.keys()].filter((m) => m !== home).sort();
  if (writers.length > 1)
    multi.push(`${table} (${writers.map(([m, n]) => `${m} ${n}`).join(", ")})`);
  foreignWrites += Math.max(0, writers.length - 1);
  foreignTouches += others.length;
  rows.push([
    table,
    entry.schemaFile,
    home,
    writers.map(([m, n]) => `${m}:${n}`).join(" "),
    others.join(" "),
  ]);
}
console.log(
  `tables a module names: ${byTable.size}; written by more than one module: ${multi.length}`,
);
for (const line of multi) console.log(`  ${line}`);
console.log(
  `(table, module) pairs where a module other than the main writer writes the table: ${foreignWrites}`,
);
console.log(
  `(table, module) pairs where a module other than the main writer names the table at all: ${foreignTouches}`,
);
if (!layoutPath) {
  writeFileSync(
    path.join(facts, "table-owners.tsv"),
    `${[["table", "schemaFile", "mainWriter", "writers", "otherModulesNamingIt"], ...rows].map((r) => r.join("\t")).join("\n")}\n`,
  );
}
```

</details>

<details>
<summary><code>cochange.mjs</code>: modules changed in the same merge</summary>

```js
// Which modules change in the same pull request.
// Throwaway measuring script for design 260. Run from the repo root:
//   node cochange.mjs <out-dir> [<commit>]
// Reads each merge on the first-parent line of <commit> (default HEAD), takes
// the non-test files under src/modules it changed against its first parent,
// and counts, for each pair of modules, the merges that changed both. A merge
// that changed more than six modules is counted apart: it is a sweep, not a
// feature.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

const [out, commit = "HEAD"] = process.argv.slice(2);
const log = execFileSync(
  "git",
  [
    "log",
    "--first-parent",
    "--merges",
    "-m",
    "--name-only",
    "--format=@%H",
    commit,
  ],
  {
    encoding: "utf8",
    maxBuffer: 1 << 28,
  },
);
const merges = [];
for (const line of log.split("\n")) {
  if (line.startsWith("@")) merges.push(new Set());
  else {
    const match = /^src\/modules\/([^/]+)\//u.exec(line);
    if (match && !/\.(?:test|spec)\.tsx?$/u.test(line))
      merges.at(-1).add(match[1]);
  }
}
const touching = merges.filter((set) => set.size > 0);
const sweeps = touching.filter((set) => set.size > 6);
const alone = new Map();
const together = new Map();
for (const set of touching) {
  if (set.size > 6) continue;
  const list = [...set].sort();
  for (const a of list) alone.set(a, (alone.get(a) ?? 0) + 1);
  for (const a of list)
    for (const b of list)
      if (a < b)
        together.set(`${a}\t${b}`, (together.get(`${a}\t${b}`) ?? 0) + 1);
}
const rows = [...together.entries()]
  .map(([pair, n]) => {
    const [a, b] = pair.split("\t");
    return [
      a,
      b,
      n,
      alone.get(a),
      alone.get(b),
      (n / (alone.get(a) + alone.get(b) - n)).toFixed(2),
    ];
  })
  .sort((x, y) => y[2] - x[2]);
writeFileSync(
  path.join(out, "cochange.tsv"),
  `${[["a", "b", "mergesChangingBoth", "mergesChangingA", "mergesChangingB", "overlap"], ...rows].map((r) => r.join("\t")).join("\n")}\n`,
);
const single = touching.filter((set) => set.size === 1).length;
console.log(
  `${merges.length} merges; ${touching.length} changed a module; ${single} changed exactly one; ${sweeps.length} changed more than six and are left out of the pairs`,
);
console.log(
  `merges per module: ${[...alone.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([m, n]) => `${m} ${n}`)
    .join(", ")}`,
);
```

</details>

<details>
<summary><code>hist</code>: the modules each past merge would change under a layout</summary>

```sh
git log --first-parent --merges -m --name-only --format='@%h' 96055f7cd48d54e07420c37294d0694eec387b15 | node hist.mjs $F .
```

```js
// The modules each past merge would change under a layout.
// Throwaway measuring script for design 260. Run from the repo root:
//   git log --first-parent --merges -m --name-only --format='@%h' <commit> | node hist.mjs <facts-dir> <layouts-dir>
// A changed file is traced to today's path, or to the only file of that name
// in its module. Merges that changed more than six of today's modules are
// left out. Prints: layout, merges, merges that change one module, mean
// modules changed, merges that change fewer modules than today, and more.
import { readFileSync } from "node:fs";

const [facts, layouts] = process.argv.slice(2);
const known = new Set(
  readFileSync(`${facts}/files.tsv`, "utf8")
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.split("\t")[0]),
);
const byName = new Map();
for (const file of known) {
  const key = `${file.split("/")[2]}#${file.split("/").pop()}`;
  byName.set(key, byName.has(key) ? null : file);
}
const merges = [];
for (const line of readFileSync(0, "utf8").split("\n")) {
  if (line.startsWith("@")) merges.push(new Set());
  else if (
    /^src\/modules\/[^/]+\//u.test(line) &&
    !/\.(?:test|spec)\.tsx?$/u.test(line)
  )
    merges.at(-1).add(line);
}
const today = (file) => file.split("/")[2];
const trace = (file) =>
  known.has(file)
    ? file
    : (byName.get(`${today(file)}#${file.split("/").pop()}`) ?? file);
for (const name of ["today", "contexts", "coarse"]) {
  const layout =
    name === "today"
      ? { modules: {} }
      : JSON.parse(readFileSync(`${layouts}/${name}.json`, "utf8"));
  const claims = Object.entries(layout.modules).flatMap(([module, spec]) =>
    spec.paths.map((p) => [p, module]),
  );
  const moduleOf = (file) => {
    let best;
    for (const [claimed, module] of claims) {
      if (
        (file === claimed || file.startsWith(`${claimed}/`)) &&
        (!best || claimed.length > best[0].length)
      )
        best = [claimed, module];
    }
    return best ? best[1] : today(file);
  };
  let count = 0;
  let one = 0;
  let sum = 0;
  let fewer = 0;
  let more = 0;
  for (const files of merges) {
    const before = new Set([...files].map(today));
    if (before.size === 0 || before.size > 6) continue;
    const after = new Set([...files].map((file) => moduleOf(trace(file))));
    count += 1;
    sum += after.size;
    if (after.size === 1) one += 1;
    if (after.size < before.size) fewer += 1;
    if (after.size > before.size) more += 1;
  }
  console.log(name, count, one, (sum / count).toFixed(2), fewer, more);
}
```

</details>

<details>
<summary>The layout files: <code>aside.json</code>, <code>layered.json</code>, <code>contexts.json</code>, <code>coarse.json</code></summary>

`aside.json`:

```
{
  "name": "today, with the wiring and the purge set aside",
  "modules": {
    "wiring": {"paths": ["src/modules/account/functions.ts", "src/modules/auth/functions.ts", "src/modules/closet/functions.ts", "src/modules/email/functions.ts", "src/modules/feed/functions.ts", "src/modules/notifications/functions.ts", "src/modules/onboarding/functions.ts", "src/modules/ops/functions.ts", "src/modules/products/functions.ts", "src/modules/runs/functions.ts", "src/modules/safety/functions.ts"]},
    "purge": {"paths": ["src/modules/account/purge"]}
  }
}
```

`layered.json`:

```
{
  "name": "layered: today's fourteen modules in a fixed order. Three sub-modules sit on the floor, account/purge sits under the dispatch, and each module's functions.ts is wiring, above every row. No file moves.",
  "modules": {
    "email": {"layer": 1, "paths": ["src/modules/email"]},
    "notifications": {"layer": 1, "paths": ["src/modules/notifications"]},
    "ops/outbox+sentry": {"layer": 1, "paths": ["src/modules/ops/outbox", "src/modules/ops/sentry"]},
    "safety/rules": {"layer": 1, "paths": ["src/modules/safety/rules"]},
    "weather": {"layer": 2, "paths": ["src/modules/weather"]},
    "products": {"layer": 2, "paths": ["src/modules/products"]},
    "runs": {"layer": 3, "paths": ["src/modules/runs"]},
    "enrichment": {"layer": 3, "paths": ["src/modules/enrichment"]},
    "safety": {"layer": 4, "paths": ["src/modules/safety"]},
    "ops": {"layer": 5, "paths": ["src/modules/ops"]},
    "account": {"layer": 6, "paths": ["src/modules/account"]},
    "auth": {"layer": 7, "paths": ["src/modules/auth"]},
    "closet": {"layer": 7, "paths": ["src/modules/closet"]},
    "feed": {"layer": 8, "paths": ["src/modules/feed"]},
    "onboarding": {"layer": 9, "paths": ["src/modules/onboarding"]},
    "account/purge": {"layer": 10, "paths": ["src/modules/account/purge"]},
    "dispatch": {"layer": 11, "paths": ["src/modules/dispatch"]},
    "wiring": {"layer": 12, "paths": ["src/modules/account/functions.ts", "src/modules/auth/functions.ts", "src/modules/closet/functions.ts", "src/modules/email/functions.ts", "src/modules/feed/functions.ts", "src/modules/notifications/functions.ts", "src/modules/onboarding/functions.ts", "src/modules/ops/functions.ts", "src/modules/products/functions.ts", "src/modules/runs/functions.ts", "src/modules/safety/functions.ts"]}
  }
}
```

`contexts.json`:

```
{
  "name": "contexts: one module per area of the domain, one writer per table, two modules that only compose",
  "modules": {
    "visibility": {"layer": 1, "paths": ["src/modules/safety/rules/visibility.ts", "src/modules/feed/conditions/runner-visibility.ts", "src/db/runner-standing.ts", "src/db/runner-confirmed.ts"]},
    "ops": {"layer": 2, "paths": ["src/modules/ops", "src/modules/email/rate-limit.ts", "src/db/gave-up.ts"]},
    "notifications": {"layer": 3, "paths": ["src/modules/notifications", "src/modules/email", "src/modules/ops/owed-email"]},
    "weather": {"layer": 3, "paths": ["src/modules/weather"]},
    "profile": {"layer": 4, "paths": ["src/modules/account/handles", "src/modules/account/theme.ts", "src/modules/account/theme-answer.ts", "src/modules/onboarding/profile.ts", "src/modules/onboarding/place.ts", "src/modules/onboarding/place-stamp.ts", "src/modules/onboarding/place-stamp-env.ts", "src/modules/onboarding/time-zone.ts", "src/modules/onboarding/geolocate.ts", "src/modules/onboarding/units-from-locale.ts", "src/modules/onboarding/aggregate-prefs.ts", "src/modules/onboarding/privacy-review.ts", "src/modules/onboarding/public-profile.ts", "src/modules/onboarding/inputs.ts", "src/modules/onboarding/functions.ts", "src/modules/onboarding/components/Settings.tsx", "src/modules/onboarding/components/SettingsSubPage.tsx", "src/modules/onboarding/components/PublicProfileSwitches.tsx", "src/modules/onboarding/components/TotalsSwitch.tsx", "src/modules/onboarding/components/PrivateRunLine.tsx", "src/modules/onboarding/components/UnitFields.tsx", "src/modules/onboarding/components/CalibrateForm.tsx", "src/modules/onboarding/components/PickUsername.tsx", "src/modules/onboarding/components/saved-switch.tsx", "src/modules/notifications/viewer-zone.ts", "src/modules/feed/conditions/units.ts"]},
    "account": {"layer": 5, "paths": ["src/modules/account", "src/modules/auth", "src/modules/safety/rules/admin.ts", "src/modules/safety/runners/ban-gate.ts"]},
    "products": {"layer": 6, "paths": ["src/modules/products", "src/modules/enrichment", "src/modules/safety/rules/denylist.ts", "src/modules/safety/review/duplicates.ts", "src/modules/safety/review/duplicates-report.ts", "src/modules/safety/review/components/DeskDuplicates.tsx", "src/modules/safety/review/components/DeskCorrections.tsx"]},
    "closet": {"layer": 7, "paths": ["src/modules/closet", "src/modules/onboarding", "src/modules/feed/conditions/garment-names.ts"]},
    "runs": {"layer": 7, "paths": ["src/modules/runs", "src/modules/weather/attach.ts", "src/modules/weather/run-conditions-copy.ts", "src/modules/feed/conditions/run-conditions-entry.ts"]},
    "feed": {"layer": 8, "paths": ["src/modules/feed", "src/modules/safety/reports/blocks.ts", "src/modules/safety/reports/components/BlockedRunners.tsx", "src/modules/safety/rules/kit-pieces.ts", "src/modules/onboarding/ladder.ts", "src/modules/onboarding/components/CallLadder.tsx", "src/modules/runs/components/VerdictBacklog.tsx"]},
    "safety": {"layer": 9, "paths": ["src/modules/safety", "src/modules/feed/moderation", "src/modules/account/handles/handle-review.ts", "src/modules/account/access/accounts.ts"]},
    "desk": {"layer": 10, "paths": ["src/modules/ops/desk/desk.ts", "src/modules/ops/desk/gave-up.ts", "src/modules/ops/desk/desk-gate.ts", "src/modules/ops/desk/owner-handles.ts", "src/modules/ops/desk/health.ts", "src/modules/ops/desk/components", "src/modules/ops/daily/digest-email.ts", "src/modules/ops/daily/removal-reminders.ts", "src/modules/ops/functions.ts", "src/modules/ops/inputs.ts"]},
    "dispatch": {"layer": 11, "paths": ["src/modules/dispatch", "src/modules/account/purge"]}
  }
}
```

`coarse.json`:

```
{
  "name": "coarse: six modules, one per layer (platform < safety < closet < kits < account < ops)",
  "modules": {
    "platform": {"layer": 1, "paths": ["src/modules/ops/sentry", "src/modules/ops/outbox", "src/modules/ops/edge", "src/modules/ops/speed", "src/modules/ops/public-web/public-cache.ts", "src/modules/ops/index.ts", "src/modules/email", "src/modules/notifications", "src/db/gave-up.ts"]},
    "safety": {"layer": 2, "paths": ["src/modules/safety"]},
    "closet": {"layer": 3, "paths": ["src/modules/closet", "src/modules/products", "src/modules/enrichment"]},
    "kits": {"layer": 4, "paths": ["src/modules/feed", "src/modules/runs", "src/modules/weather", "src/modules/ops/public-web", "src/modules/ops/owed-email"]},
    "account": {"layer": 5, "paths": ["src/modules/account", "src/modules/auth", "src/modules/onboarding", "src/modules/email/functions.ts", "src/modules/notifications/functions.ts"]},
    "ops": {"layer": 6, "paths": ["src/modules/ops", "src/modules/dispatch"]}
  }
}
```

</details>
