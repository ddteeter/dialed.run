# Design: 131 The audience model (R-129, D-109)

> Over the template's one-page cap on purpose: the owner asked for the full
> inventory, the migration SQL and a step plan in one place. Approved by the
> owner on 2026-10-04. PR A (#146) builds the contract, the migration, the
> seeds and the dual writes; PR B, the read flip, follows it. D-109 and
> R-129 arrive on `main` with #144; this doc cites them from there.

## Problem

An entry's sharing choice is a boolean (`outfit_entries.is_public`), and so
is the runner's default (`user_profiles.share_default`). Day 2 groups need a
third answer, so D-109 makes both an **audience**:
`'private' | 'groups' | 'runners'`. Launch writes only `private` and
`runners`, and the copy does not change (SHARED is `runners`, PRIVATE is
`private`). This build adds the columns, moves every read and write to them,
and leaves the booleans in place for a later contract PR.

## Approach

**Two build PRs, then the contract PRs later.** Law 8's expand step is
itself split in two. That way no deploy ever has code reading a column the
previously deployed code did not write. It also keeps each push gate to
about half the files (see Test cost).

| PR                        | Writes                   | Reads                        | Migration                                   |
| ------------------------- | ------------------------ | ---------------------------- | ------------------------------------------- |
| **A** expand + dual-write | audience **and** boolean | boolean (mapped to audience) | `0044_add_audience_columns`                 |
| **B** flip reads          | audience **and** boolean | **audience only**            | `0045_resync_audience_from_booleans` (data) |
| C1 (later, owner)         | audience only            | audience                     | none                                        |
| C2 (later, owner)         | —                        | —                            | drop the booleans and the two old indexes   |

**Writers keep writing the booleans until C1.** Every version that could
still be serving, or that `wrangler rollback` could restore, reads
`is_public`. CI applies migrations _before_ `wrangler deploy` (`ci.yml`),
so old code always runs against the new schema for a while. If a writer
stopped writing the boolean, a rollback would show the old code a stale
`is_public = 1` on every entry made private since. That is a privacy leak,
and it is silent. The dual write is the same statement with one more
column, so it costs nothing. It stops in C1, once no deployable version
reads the boolean.

**Fail closed on the entry default.** `outfit_entries.audience` defaults to
`'private'`, not `'runners'`. Every app writer sets it explicitly. The
default only applies to a writer that forgot the column: a test seed, pre-A
code in the seconds between `migrations apply` and `deploy`, or a future
insert. A forgotten audience should hide an entry, never publish it. The
product default ("shared by default") is enforced in code by the runner's
default audience, as it is today. `user_profiles.default_audience` defaults
to `'runners'`, because several profile inserts (`account/username.ts`;
`onboarding/profile.ts`'s calibration, place and completion writes) rely on
the column default on purpose. That
matches `share_default`'s `DEFAULT true`.

**PR B's resync closes the pre-A window.** By the time B's migration
applies, A is the serving code, and A always writes both columns. So any
disagreement between the two columns can only come from pre-A code in that
window, and there the boolean is the truth. B's data migration copies
boolean → audience where they disagree, before any reader depends on the
audience.

**`groups` is storable and readable, never writable, until groups ship.**
The stored and read type is the full enum, so every reader handles all
three values now. A `groups` row is hidden from strangers automatically,
because the one rule tests `audience = 'runners'`. Every writer's input
type is the launch subset, so nothing can write `groups`:

- `audienceSchema = z.enum(["private", "groups", "runners"])` is the stored
  and read type. `db/schema-core.ts` reads its `.options` for the drizzle
  enum, as it already does for `garmentVisibilities`.
- `writableAudienceSchema = audienceSchema.extract(["private", "runners"])`
  is what `submitVerdictInput` and `sharingInput` parse. I chose `extract`
  over `exclude(["groups"])` deliberately, so a future fourth value has to
  be opted in and is never writable by default.
- Every server-side writer takes `WritableAudience`, not `Audience`.
- There is no SQL `CHECK`. Adding one rebuilds the table (the law 8b
  expression-index trap), and removing it when groups ship is a second
  rebuild. Type, schema and test do the job instead.

When groups ship, the change is to widen `writableAudienceSchema`, plus the
additive `entry_groups` join table.

The form has to change before that schema does. `VerdictForm.tsx` seeds its
switch with `isSharedAudience(entry.audience)` (line 256) and saves
`audienceOfShareToggle(isShared)` (line 334), so a `groups` entry opens as
unshared and saving it, even to change only the verdict, writes `private`.
That is harmless while nothing can write `groups`. Whoever widens
`writableAudienceSchema` must first give the form a groups state, or the
first edit of a groups entry silently narrows it.

**The wire words live in one place**, `src/lib/contracts/audience.ts`
(re-exported by the `lib/contracts.ts` barrel):

- `SHARED_AUDIENCE = "runners"`: the one value strangers see. It is read
  by `safety/visibility.ts` and by `feed/feed.ts`'s index-seek clause.
- `audienceOfShareToggle(on): WritableAudience` and
  `isSharedAudience(a): boolean`: the A3 checkbox and the Settings toggle
  stay booleans in the UI.
- `audienceWord = { runners: "shared", private: "private", groups: "groups" }
satisfies Record<Audience, AudienceWord>`: what user-facing files write.
  The export uses it now, and design 130's API `visibility` will use it
  too. `runners` never leaves the server. This lands in PR B with its first
  consumer, because knip blocks an unused export.

`test/lib/audience.test.ts` pins all of this against `audienceSchema.options`:
every audience has exactly one word, `runners` maps to `shared`, the
writable schema rejects `groups`, and the toggle round-trips.

**One more forcing function, in PR B.** The drizzle _properties_ become
`legacyIsPublic` and `legacyShareDefault`. The column names stay
`is_public` and `share_default`, so the SQL does not change and
drizzle-kit produces no migration for it. After the rename, any leftover
`isPublic:` seed or read fails `tsc`, so nothing can quietly keep reading
the boolean. `test/architecture/audience-only.test.ts` asserts that the
legacy properties appear only in the three dual-write sites, schema-core
and the test helpers.

## Migration

**PR A: `0044_add_audience_columns`.** Assumes #142's `0043` lands first.
Open PRs checked 2026-10-04: only #142 adds a migration. Design 130 (#143)
is unbuilt and post-launch, and numbers itself "past 0043" when it is
built. If A merges before #142, the later of the two renumbers, per law 11.
The file is `npm run db:generate:core -- --name=add_audience_columns`, with
the two backfill `UPDATE`s inserted by hand (with their
`--> statement-breakpoint`s) after the `ADD`s and before the indexes. One file, so the
columns and their backfill apply together:

```sql
ALTER TABLE `outfit_entries` ADD `audience` text DEFAULT 'private' NOT NULL;
ALTER TABLE `user_profiles` ADD `default_audience` text DEFAULT 'runners' NOT NULL;
UPDATE `outfit_entries` SET `audience` = CASE WHEN `is_public` = 1 THEN 'runners' ELSE 'private' END;
UPDATE `user_profiles` SET `default_audience` = CASE WHEN `share_default` = 1 THEN 'runners' ELSE 'private' END;
CREATE INDEX `entries_audience_created` ON `outfit_entries` (`audience`,`moderation_status`,`created_at`);
CREATE INDEX `entries_user_audience_created` ON `outfit_entries` (`user_id`,`audience`,`moderation_status`,`created_at`);
```

This is additive only: two `ADD COLUMN`s with constant defaults and no
table rebuild. Verify the generated file says exactly that. The old indexes
stay until C2, because pre-A and A code still seek them on rollback.

**The new indexes serve every query the old ones did.** They have the same
column order with `audience` in `is_public`'s place, and each query swaps
`is_public = 1` for `audience = 'runners'`, both equalities:

| Query                                                                 | Old index                     | New index                       |
| --------------------------------------------------------------------- | ----------------------------- | ------------------------------- |
| Following feed, `authorsNewest` (`feed/feed.ts`)                      | `entries_user_public_created` | `entries_user_audience_created` |
| H's entries, `recentPublicEntriesStatement` (`feed/profiles.ts`)      | `entries_user_public_created` | `entries_user_audience_created` |
| Your conditions, `recentPublicEntriesStatement` (`feed/consensus.ts`) | `entries_public_created`      | `entries_audience_created`      |

Entry detail, photo, Useful and reactions reads go by primary key, with
the rule as a filter, so no index changes for them.

**Partial indexes: not used, and why.** A partial index
(`… WHERE audience = 'runners'`) is chosen only when the query's `WHERE`
provably implies the index's predicate. drizzle's `eq()` binds `'runners'`
as `?`, so the planner cannot prove it and falls back to a scan. The
predicate would have to be literal SQL in the query as well as in the DDL.
Groups will also read `audience IN (…)`. The plain composite indexes mirror
the existing ones and carry no such trap.

**PR B: `0045_resync_audience_from_booleans`** (`--custom`, data only,
idempotent):

```sql
UPDATE `outfit_entries` SET `audience` = CASE WHEN `is_public` = 1 THEN 'runners' ELSE 'private' END
  WHERE `audience` <> CASE WHEN `is_public` = 1 THEN 'runners' ELSE 'private' END;
UPDATE `user_profiles` SET `default_audience` = CASE WHEN `share_default` = 1 THEN 'runners' ELSE 'private' END
  WHERE `default_audience` <> CASE WHEN `share_default` = 1 THEN 'runners' ELSE 'private' END;
```

This is a one-time scan of two small tables. It is safe in both directions
only because A, which always writes both columns, is the code serving while
it applies. So **A must be deployed before B merges**.

**Later, not in this build.** C1 removes the dual write. C2 drops
`is_public`, `share_default`, `entries_public_created` and
`entries_user_public_created`. That is destructive, goes back to the owner
as its own PR, and ships one deploy after C1 (law 8). C2 has a trap: read
the generated SQL. If drizzle-kit rebuilds `user_profiles` instead of
using `DROP COLUMN`, it re-emits `user_profiles_username_nocase`, the
expression index law 8b warns about. The indexes must also drop before
their columns.

## Inventory (origin/main, 2026-10-04)

`git grep -E 'isPublic|is_public|shareDefault|share_default'`, excluding
migrations, `design/` and `plan/`, finds **62 code files and 207 lines**:
13 production files (49 lines), 37 test files (140 lines) and 12 e2e files
(18 lines). Four more production files read the flag _indirectly_ through
the one rule or a whole-row select. Docs add 10 files and config adds 1.
R-129's "about 100 files" counted migration snapshots.

_*Production. W = writer, R = reader, R* = reads through `publiclyVisibleEntry`/`entryVisibleTo`._*

| Module     | File · site                                                                          | Today                               | Becomes                                                                                                               | PR   |
| ---------- | ------------------------------------------------------------------------------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---- |
| db         | `schema-core.ts` · `outfitEntries.isPublic`, 2 indexes                               | boolean + indexes                   | adds `audience` and the 2 new indexes; property becomes `legacyIsPublic` in B                                         | A, B |
| db         | `schema-core.ts` · `userProfiles.shareDefault`                                       | boolean                             | adds `defaultAudience`; property becomes `legacyShareDefault` in B                                                    | A, B |
| feed       | `entries.ts` · `attachKit` insert (W)                                                | `isPublic`                          | `audience` + `legacyIsPublic` from it                                                                                 | A    |
| feed       | `entries.ts` · `submitVerdict` update + `SubmitVerdictInput` (W)                     | `isPublic: boolean`                 | `audience: WritableAudience`, dual write                                                                              | A    |
| feed       | `entries.ts` · `getEntryDetail`, `EntryDetail.isPublic` (R)                          | boolean                             | `audience` field: mapped from the boolean in A, read from the column in B                                             | A, B |
| feed       | `share-default.ts` · `isPublicByDefault`, `isSharedAsChosen` (R)                     | boolean                             | `defaultAudienceFor`, `audienceAsChosen`, returning `WritableAudience`; D-50 still forces `private` while unconfirmed | A, B |
| feed       | `inputs.ts` · `submitVerdictInput.isPublic`                                          | `z.boolean()`                       | `audience: writableAudienceSchema`                                                                                    | A    |
| feed       | `components/VerdictForm.tsx` (5 lines)                                               | checkbox state `isPublic`           | the same checkbox, mapped by the helpers; `LABELS.audience`; copy unchanged                                           | A    |
| feed       | `feed.ts` · `authorsNewest` `eq(isPublic, true)` (R)                                 | boolean                             | `eq(audience, SHARED_AUDIENCE)`                                                                                       | B    |
| feed       | `consensus.ts`, `photos.ts`, `profiles.ts`, `reactions.ts`, `entries.ts` detail (R*) | via the rule                        | inherit; no edit (`consensus.ts:101` comment reworded in B)                                                           | B    |
| safety     | `visibility.ts` · `publiclyVisibleEntry` (R)                                         | `eq(isPublic, true)`                | `eq(audience, SHARED_AUDIENCE)`, doc comment                                                                          | B    |
| safety     | `review.ts:505`: comment only                                                        | "never touched `isPublic`"          | "never touched the audience"                                                                                          | B    |
| safety     | Desk and moderation reads (`reports.ts`, `review.ts`, `feed/moderation.ts`)          | **don't read the flag**             | none; they read `moderation_status` only                                                                              | —    |
| onboarding | `profile.ts` · `savePreferences` (W, spreads `sharingInput`)                         | `shareDefault`                      | maps `defaultAudience` to both columns                                                                                | A    |
| onboarding | `profile.ts` · `currentSettings`, `CurrentSettings` (R)                              | `shareDefault`                      | `defaultAudience`: mapped in A, column in B                                                                           | A, B |
| onboarding | `inputs.ts` · `sharingInput.shareDefault`                                            | `z.boolean()`                       | `defaultAudience: writableAudienceSchema`                                                                             | A    |
| onboarding | `components/Settings.tsx` (6 lines)                                                  | toggle `shareDefault`               | the same toggle via the helpers; row copy unchanged                                                                   | A    |
| account    | `export.ts`: whole-row `select()` (R*)                                               | carries `isPublic`                  | carries both; no edit                                                                                                 | —    |
| account    | `export-files.ts` (row building) + `export-sheets.ts` (W to file)                    | `entries.csv` `shared` = true/false | `audience` = `audienceWord[…]`, built on the row step as `export-sheets.ts` requires                                  | B    |
| account    | `export-sheets.ts` · `profile.csv` `share_new_runs`                                  | true/false                          | **owner question 1**                                                                                                  | B    |
| config     | `guardrails.config.json`: Pair A grant keys quote `isPublicByDefault`                | —                                   | **owner question 3**                                                                                                  | A    |

Not built on main, so nothing to move, but each must read the audience
when it is built: "worn by N" social proof (`products` has no entry read),
D-108's anonymous totals (#145) and the read API. Design 130 (#143) states
visibility as `is_public = 1 AND …`. It should cite `publiclyVisibleEntry`
and `audienceWord` before it is built.

**Tests and seeds**, all converted in PR A to write `audience`. The
helpers write both columns until C1, so the suite is green on both sides
of B's flip:

- Shared helpers: `test/feed/helpers.ts` (`makeUser({ shareDefault })`,
  `makeEntry({ isPublic })`, used by about 25 files),
  `test/feed/profiles.test.ts`'s local `makeEntry`, and
  `e2e/conformance/feed-support.ts` `seedEntry`.
- By area: feed 16 files/68 lines, safety 8/22, onboarding 2/20, account
  2/16, `test/modules` DOM 4/7, runs 2/3, closet 2/2, ops 1/2. e2e: 12
  files insert `isPublic` straight through drizzle (`closet-seed.ts`,
  `logging-fixtures.ts`, `feed.demo`, `safety.demo`, `moderation.demo`,
  `verdict.demo`, `verdict-row`, `a3-verdict`, `feed-d`,
  `closet-round26`, `closet.demo`). Left alone, their shared seeds would
  vanish at B's flip, because the entry default is `private`.
- Plan pins renamed in B: `test/feed/feed.test.ts:229` and
  `hidden-runners.test.ts:378` change to the new index name and `audience=?`.
  `consensus.test.ts`'s plan test is strengthened from "no SCAN" to naming
  `entries_audience_created`.

**Docs in PR B:** `docs/contracts.md` (schema block, the visibility rule,
index list), `docs/architecture.md` (3 sites), the code citations in
`docs/legal/*-sources.md` (citations only, not legal text), and R-129's
row in `docs/deferred.md` (built, with C1/C2 pending). CLAUDE.md, under the
owner's one-time OK, rebased over #145's wording of the same bullet:

> **Sharing**: an entry's audience is `private`, `groups` or `runners`
> (D-109); launch writes only `private` and `runners` (PRIVATE / SHARED),
> `runners` by default with a per-entry choice and a per-user default
> audience. Every check reads the audience, never a boolean. Only `runners`
> entries appear in feeds or in in-app consensus and social-proof counts …
> _(#145's anonymous-totals sentences follow unchanged)_

And in the Products bullet, "derive only from public entries" becomes
"derive only from shared (`runners`) entries".

## Steps

Each step is one commit and passes the commit gate. "Mutants" means
`npx stryker run --mutate "<that step's files>"` at 100% before moving on,
which pays the push gate down ahead of time.

**PR A**

1. **Contract.** `lib/contracts/audience.ts` (everything except
   `audienceWord`), the barrel export, and the file added to
   `stryker.conf.json`'s contracts entry. _Test:_
   `test/lib/audience.test.ts`. _Done:_ the test is green and the file's
   mutants are killed.
2. **Migration and schema.** The `0044` SQL above, the two columns and the
   two indexes in `schema-core.ts`, with enum values from step 1. Nothing
   reads them yet. _Test:_ `test/audience-backfill.test.ts` takes 0044's
   `UPDATE`s from `env.TEST_MIGRATIONS_CORE` (the migration's own SQL, not a
   copy) and runs them over rows seeded with each boolean. It asserts
   `audience === audienceOfShareToggle(is_public)` and the same for
   profiles. `migration-chain.test.ts` stays green. _Done:_ those, plus a
   fresh-D1 apply in the suite.
3. **Fixtures.** The helpers and every test and e2e seed take
   `audience`/`defaultAudience` and write both columns. Test-only, so no
   production mutants. _Done:_ the full `worker` and `ui` projects are
   green with no production change.
4. **Entry write path.** `feed/inputs.ts`, `share-default.ts`,
   `entries.ts`, `VerdictForm.tsx`. Writers dual-write and readers map from
   the boolean. _Tests:_ `entries-edges`, `backlog`, `share-default`,
   `unconfirmed-sharing` and `verdict-form.dom` assert both columns on
   every write, including D-50, plus a zod test that `audience: "groups"`
   is refused. _Done:_ those green, mutants at 100% for the four files.
5. **Default write path.** `onboarding/inputs.ts`, `profile.ts`,
   `Settings.tsx`. _Tests:_ `profile.test.ts` (both columns, and the
   disjoint-sets rule) and `settings.dom` (the payload is
   `{ defaultAudience }`). _Done:_ as step 4.

**PR B** (opened only after A is deployed)

6. **Resync.** The `0045` data migration. _Test:_ the same shape as step 2,
   over deliberately disagreeing rows; a second run changes nothing.
7. **Flip reads.** `safety/visibility.ts`, `feed/feed.ts`, and the B
   halves of `getEntryDetail`, `currentSettings` and `defaultAudienceFor`.
   _Tests:_ plan pins on the new indexes, and
   `visibility.test.ts` with a `groups` row seeded through SQL asserting
   that it is hidden from strangers and shown to its owner. _Done:_ green,
   mutants at 100%.
8. **Export.** `audienceWord` in lib, the row step and `export-sheets.ts`.
   _Test:_ `export.test.ts` pins the header and `shared`/`private` cells.
9. **Seal.** The `legacy*` property rename and
   `audience-only.test.ts`. _Done:_ `tsc` is clean, and
   `npm run db:generate:core` reports no schema changes (the property
   rename leaves the column names unchanged).
10. **Docs.** As listed above, rebased over #145.

## Test cost

The push analyzer mutates every changed production `.ts`/`.tsx` file in
the **whole branch diff** on every push, so pushing more often does not make
the gate cheaper. Splitting the PR does. A mutates 8 files: `audience.ts`,
`entries.ts` (721 lines), `share-default.ts`, `feed/inputs.ts`,
`onboarding/profile.ts`, `onboarding/inputs.ts`, `VerdictForm.tsx` and
`Settings.tsx`. B mutates about 6: `visibility.ts`, `feed.ts`,
`export-files.ts`, `export-sheets.ts`, plus `consensus.ts`/`review.ts` if
their comments change (skip those rewordings if the gate runs long). The
shards involved are the contracts shard, `modules/feed`,
`modules/onboarding`, `modules/safety`, `modules/account` and the
components shard. **No `functions.ts` is touched.** Both server functions
spread their parsed input (`submitVerdict({ userId, ...data })`,
`savePreferences(db(), …, data)`), so renaming the fields needs no glue
edit, and the 65-survivor trap does not apply. `schema-core.ts` is negated
in the ratchet. Push in the background and expect about 15 minutes per PR.

## Contract touches

- Schema: two additive columns and two additive indexes (0044), and one
  data migration (0045). The change is **contract-shaped**: `is_public` is in
  `docs/contracts.md`. The owner decided it (D-109), and this plan is the
  approval request.
- Routes, bindings, queues, crons: **none**. Screens: none change.
- Stale-tab note (a guess I'm proceeding on): a tab still holding A's
  predecessor bundle posts `isPublic`. The new validator refuses it with a
  form error, loudly, and nothing leaks. That is acceptable pre-launch, so
  no compatibility shim.

## Demo

Nothing on a screen changes: same toggles, same copy, same feeds. So **no
demo video**. The existing e2e demos must stay green on converted seeds,
without re-recording. The one user-facing change is the export's column,
which is an emailed file, not a screen. It is pinned by `export.test.ts`
and named in the PR body.

## Open questions

**Decided by the owner, 2026-10-04.** Plan approved; PR A is being built
on this branch.

1. **Export words: yes.** `entries.csv`'s `shared` becomes `audience` and
   `profile.csv`'s `share_new_runs` becomes `default_audience`, both
   written with the UI words `shared` / `private`. Both land in PR B with
   `audienceWord` (step 8), as planned.
2. **Two build PRs, as planned.** This branch is PR A (expand plus dual
   write). PR B, the read flip, is a separate later branch, opened only
   after A is deployed.
3. **Pair A grants: yes, re-key.** A one-time OK to re-key exactly the
   two `guardrails.config.json` grants whose keyed comment text changes
   when `isPublicByDefault` is renamed: same reason, new text, no new
   grants and no other edit to that file.

The CLAUDE.md wording (the Sharing bullet and the Products bullet's
social-proof sentence) is also owner-approved as a one-time edit. This
plan puts it in PR B's docs step (step 10), rebased over #145, so PR A
does not touch CLAUDE.md.

The questions as they were asked:

1. **Export words.** `entries.csv`'s column on main is `shared`
   (true/false), not `visibility`, so the plan renames `shared` to
   `audience`, valued `shared`/`private`. `profile.csv` also has
   `share_new_runs` (true/false), the runner's default. Under D-109's
   "files write the UI's words", the recommendation is `default_audience`
   with `shared`/`private`. Yes, or keep it? The README sentences for both
   columns are user-facing copy too. I'll draft them for your edit.
2. **Two build PRs (recommended) or one?** One PR works only if it accepts
   the `migrations apply` → `deploy` window, which the `'private'` default
   makes fail closed rather than leak, and drops the 0045 resync. I'm
   proceeding on two unless you say otherwise.
3. **Pair A grants.** Renaming `isPublicByDefault` changes the
   `fallow-ignore` comment text that two `guardrails.config.json` grants
   are keyed on. If the reshaped functions still clone, may PR A re-key both
   grants (same reason, new text)? If they stop cloning, PR A drops the
   comments and both grants, which your standing OK on dead grants covers.

## Built: where PR A diverged from the plan

Following the code where it contradicts the plan, as instructed:

- **The migration is `0044_add_audience_columns`, as planned**, but only
  because #142 merged mid-build. `test/migration-chain.test.ts` refuses a
  gap in the journal or the snapshot chain, so `0044` cannot exist on a
  branch without `0043`: the plan's "assumes #142 lands first" was a hard
  precondition, not a numbering choice. It was generated as `0043`,
  then regenerated as `0044` on top of #142 after rebasing.
  `test/audience-backfill.test.ts` finds the migration by its name suffix,
  so a later law-11 renumber would not touch it.
- **`schema-core.ts` reads an exported `audiences` tuple, not
  `audienceSchema.options`.** zod 4 types `.options` as a plain array and
  drizzle's `text` enum needs a non-empty tuple. The schema is built from
  the tuple (`z.enum(audiences)`), so there is still one list, and
  `test/lib/audience.test.ts` pins the two equal.
- **`SHARED_AUDIENCE` is not exported in A.** Its only readers outside the
  contract (`safety/visibility.ts`, `feed/feed.ts`) flip in B, so A keeps
  it module-private and B exports it with them.

## Built: where PR B diverged from the plan

- **"A must be deployed before B merges" did not apply.** Nothing is
  deployed yet: "Deploy to workers.dev" is skipped on `main`, and the
  first deploy, in the deployment sweep, carries A and B together. The
  dual write and `0045` are kept anyway, as planned (two PRs, owner's
  answer 2); `0045` is then a no-op on a fresh database, which is what
  idempotent means. No deploy-ordering machinery was added.
- **`tsc` does not catch every leftover after the rename.** The plan said
  "any leftover `isPublic:` seed or read fails `tsc`". A read does. A
  _write_ through a spread does not: `preferenceColumns` returns an object
  that `savePreferences` spreads into `.values({ userId, ...columns })`,
  and a spread escapes TypeScript's excess-property check. After the
  schema rename, `profile.ts` still returned `shareDefault`, compiled
  clean, and would have silently stopped writing `share_default`, exactly
  the rollback leak the dual write exists to prevent. The same held for
  both seed helpers. So `audience-only.test.ts` also checks the old
  property names as text: none in `src/`, and in tests only where a test
  posts the previous bundle's boolean to prove the input schema refuses
  it (`feed/inputs.test.ts`, `onboarding/profile.test.ts`).
- **The test's allowed sites are counted, not only listed.** `src/` may
  name a legacy property in `schema-core.ts` and the three dual writes:
  two in `feed/entries.ts`, and two in `onboarding/profile.ts`, where
  `preferenceColumns`' return type names it as well as its one write. The
  test-side list (seed helpers, dual-write assertions, the migration
  tests, and the tests that seed a disagreement to prove which column a
  read follows) is checked in both directions, so it cannot outlive its
  reasons.
- **A stored `groups` default narrows to `private` on read.** The plan
  left this open. `defaultAudienceFor` and `currentSettings` read the full
  `Audience` but answer `WritableAudience`, so they go through
  `audienceOfShareToggle(isSharedAudience(…))`: a `groups` default starts
  a new entry `private` and shows the Settings switch off. Nothing can
  store `groups` yet; whoever widens `writableAudienceSchema` must revisit
  both, as with `VerdictForm.tsx` above.
- **The README sentences are drafted, for the owner's edit.** `audience`:
  "who can see this run's kit and verdict: shared means any runner on dialed.run, private means only you."
  `default_audience`: "what a new run starts as when you log it, shared or private. You can change any run afterwards." (owner-approved wording, 2026-10-04) No
  other document names either export column, so nothing else changed for
  them; the legal sources' code citations were updated (citations only).
