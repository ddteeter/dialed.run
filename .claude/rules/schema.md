---
paths:
  - "src/db/**"
  - "drizzle-*.config.ts"
  - "test/migration-chain.test.ts"
---

# Schema changes and migrations

Loaded when you touch `src/db/`. `src/db/schema*.ts` and `src/db/migrations/`
are **not owned by any lane** — they are the one shared resource.

## The protocol (serialized)

**It exists for concurrent authorship, not for fear of schema changes.**
Several agents in parallel worktrees against one migrations directory produce
histories that cannot be replayed and journal conflicts no gate catches. So it
applies by what a change _does_:

| change                                                                                                                 | while lanes run in parallel                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Additive** — a new nullable column, a new index, a new table, a data seed                                            | **Proceed.** Name the migration, say so in the PR description, and carry on.                                                                                                |
| **Destructive** — dropping or renaming a column or table, tightening a constraint, anything not expand-only            | **Until the first production deploy: proceed** and say so in the PR (D-139; numbering still applies). **After it: stop and ask** — these are about deploy ordering (law 8). |
| **Contract-shaped** — changing the meaning of an existing field, or anything in `docs/contracts.md` another lane reads | **Stop and ask.** The cost is coordination, not migration.                                                                                                                  |

If a change is additive _and_ another lane is likely to want the same column,
still say so in the PR — one migration beats four.

When a change requires stopping: stop that part, write the proposed change as
a short note in your design doc, and **ask in the turn** — what it is, what it
costs, what you recommend (root CLAUDE.md, "Stop means ask").

**Check the premise first.** Twice in the PR #2–#5 review "this needs a
schema change so it stops here" was wrong — the columns already existed and
the work was wiring. Read the schema before declaring yourself blocked by it.

Never run `drizzle-kit generate` inside a feature branch unless your packet
says the migration is yours, or the owner has said yes.

## Naming

`npm run db:generate:core -- --name=strava_refresh_failure_tracking` (or
`:weather`). The script refuses to run without `--name`, because drizzle-kit's
invented names (`0002_misty_corsair`) make the history unreadable exactly when
it matters. Name it for what it does to the schema (`add_run_idempotency_key`,
not `manual_run_fixes`); if you cannot name it in a few words, it is two
migrations.

Renaming after the fact means editing the `tag` in
`src/db/migrations/*/meta/_journal.json` to match the new filename, and is only
safe before the migration has been applied anywhere real.

## Law 8 — migrations are expand→contract

Additive change deploys first; code stops reading the old shape; destructive
change ships in a later migration. Never rename/drop in the same PR that
changes code — **after first deploy** (before it, D-139 above).

**Read a generated table rebuild before trusting it.** SQLite cannot alter a
column, so drizzle-kit rebuilds the whole table and recreates its indexes —
and it re-emits an _expression_ index by quoting the whole expression as one
identifier (`"display_name" COLLATE NOCASE` became a column name), which
SQLite rejects. A boolean conversion on an unrelated column takes the search
index down with it, and nothing in the diff looks wrong. The unit suite
applies every migration to a fresh D1, which is what catches it.

## Law 11 — number for where it will land, not where you are

Before generating, `git fetch` and look at what is on `main` and in open PRs,
then number past all of it. `test/migration-chain.test.ts` fails CI on a fork,
a gap, a duplicate index, or a tag with no file.

When two branches collide anyway, the merge renumbers the later one: rename
the `.sql` and its `meta/*_snapshot.json`, rebuild `_journal.json`, and relink
`prevId` so the chain stays linear.
