# Design: 189 squash

## Problem

Nothing is deployed, but core has 82 migrations, weather 5 and ops 1. The owner
wants the first deploy to apply one baseline per database (D-174), with the
columns already cut left out of it. Separately, the conditions consensus reads
every public entry in its window and then walks to the weather database per
run, so its rows read grow with every shared run anywhere (D-175).

## Approach

**PR 1: #408, then #506.**

1. #408: drop the export's `kit.csv` `note` column, then `outfit_entry_items.note`
   from `schema-core.ts`. Also drop `products.image_key` (D-176; nothing has
   read or written it since #536). Each is a normal generated migration, so
   the old chain stays a faithful "before" for step 3.
2. #506: per database, delete `src/db/migrations/<db>/` and regenerate with
   `drizzle-kit generate --name=baseline` → `0000_baseline.sql`, a fresh
   journal and one snapshot. Hand-check the generated SQL for what drizzle
   mis-emits (the `COLLATE NOCASE` expression indexes, schema.md law 8).
3. Seed rows go in `0001_seed.sql` after core's baseline: the final rows of
   every migration that INSERTs or UPDATEs data (curated brands, the link
   shortener denylist, and any others the diff finds). Weather and ops get
   seeds only if their chains insert rows that survive.
4. Proof: apply the old chain and the new baseline to two fresh local D1s
   per database, and diff `sqlite_schema` (normalized) and every table's
   rows. The empty diff and the script go in the PR body, not in a test.
5. Update what names a migration: `test/` comments, `docs/contracts.md`,
   `docs/deployment.md`, `docs/legal/*-sources.md`, `seed-brands.ts`, and
   `.claude/rules/schema.md` (baseline numbering, and "never squash again
   after the first deploy"). Historical design docs, `docs/deferred.md` and
   `docs/decisions.md` are records and stay as written.

**PR 2: #409, then #507.**

A run's judged feels-like depends on its entry's verdict (`judgedFeelsLikeC`:
coldest hour if it felt cold, warmest if warm, else the start), and the
consensus window is the entry's `created_at`. So the copy carries both
halves, one row per run (`entries_run` is unique), each half written in the
batch that changes the fact it copies (coordinator-4 approved this shape):

- **`run_conditions`** (core): `run_id` PK, `user_id`; weather's half
  `feels_like_c`, `min_feels_like_c`, `max_feels_like_c`, `precip_class`,
  `source`; feed's half `verdict`, `entry_created_at`. A generated column
  `judged_bucket` applies the `judgedFeelsLikeC` rule in SQL and floors it
  to a whole degree. Partial index `(precip_class, judged_bucket,
entry_created_at) WHERE source != 'manual'`.
- **Weather's half** is written by `setStatus` (`weather/attach.ts`) in the
  batch that marks a run `attached` or `manual`, and cleared in the batches
  that set it back to `pending` (`runs/service.ts`, `ops/gave-up.ts`). The
  hourly weather-retry cron repairs a resolved run with no half and clears
  a stale one (law 8c, reconciliation).
- **Feed's half** is written in the batch that creates the entry or
  records its verdict, and cleared when the entry is retracted. Deleting a
  run and purging an account delete the row.
- **Module boundary:** `feed` imports `weather`, never the reverse, so the
  run-to-conditions derivation (`observationsForRuns` over run rows, now in
  `feed/conditions.ts`) moves into `weather`, with the `Conditions` shape
  and `judgedFeelsLikeC` moved to `lib/contracts/` (pure). Feed re-exports
  what it used. A pure `runConditionsRow()` builds the weather half, so
  test and e2e seeds call it rather than copying the rule.
- **The consensus** asks for the seven buckets that can hold ±3° with
  `judged_bucket IN (…)` and the window, then the exact band check in SQL.
  Audience, moderation (`publiclyVisibleEntry()`) and `count_in_totals`
  stay live in the join to `outfit_entries`. The garments worn are read
  as today.
- **Pins:** the generated column against `judgedFeelsLikeC` over every
  verdict; the stored half against a live derivation from the cache.
- D-108's published totals do not read this table; it holds no notes,
  photos or places, and its one time is the entry's.
- #507: scaling tests on the model of `test/safety/desk-queues.scaling.test.ts`
  with `test/d1-spy.ts`: seed 25 rows the read must not return and assert
  rows read stay flat, for the consensus, the feeds and search. Measure the
  consensus first, so the before/after is in the PR.

## Contract touches

- Schema changes: drop `outfit_entry_items.note`, `products.image_key`
  (destructive, pre-approved by D-139); squash all three chains (D-174);
  PR 2 adds `run_conditions` (additive, D-175). None touches a safety table.
- Module boundaries: the run-to-conditions derivation moves from `feed` to
  `weather`; `docs/architecture.md` changes if its diagram names it.
- New route files, bindings, queues, crons: **none**.
- Screens: none change. The export's `kit.csv` loses its `note` column.

## Test plan

- vitest `worker`: export tests expect `entry_id,garment_id,flag`;
  `migration-chain.test.ts` holds against the new single-entry chains.
- vitest `worker`: the generated bucket pinned against `judgedFeelsLikeC`;
  the stored half pinned against a live derivation; each write path
  (attach, manual band, start-time correction, Desk retry, entry create,
  verdict, retract, run delete, purge); the cron repair.
- vitest `worker`: `*.scaling.test.ts` rows-read cases (#507).
- No Playwright spec: no screen changes. The CI-style e2e still runs.

## Issues

- Closes: #408, #506 (PR 1); #409, #507 (PR 2).
- Opens: one for the two migration-number comments in `src/modules/safety/`
  (desk-safety owns them), if they are not fixed by then.

## Open questions

- Local `.wrangler` D1 state keyed to the old migration names must be wiped
  once after PR 1 (`rm -rf .wrangler/state`). Said in the PR body; no code.
