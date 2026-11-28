# Design: 291 second squash

## Problem

Core has grown from its baseline (D-174, #506) to 17 migrations, and
the first deploy should start from one baseline plus its seed (#670, the
owner's call of 2026-11-13). Two small schema items ride along: an index
on `follows` led by `followee_id`, so a runner's follower count seeks
rather than scans the table (#884), and stale file paths in
`schema-core.ts`'s comments.

## Approach

Done the way #506 was (PR #555, design 189):

1. Add `follows_followee` to `schema-core.ts` and generate it as an
   ordinary migration, `0017_add_follows_followee_index`, so the old
   chain is a faithful "before" that already holds it.
2. Delete `src/db/migrations/core/`, regenerate it with
   `npm run db:generate:core -- --name=baseline`, then
   `drizzle-kit generate --custom --name=seed`, and copy the old
   `0001_seed.sql` into it byte for byte. It is the only file in the old
   chain that inserts, updates or deletes rows. The generated baseline's
   `COLLATE NOCASE` expression index is checked by hand (law 8).
3. Weather and ops are still at their baselines, so they are unchanged.
4. Proof: a one-off script applies the old chain and the new one to two
   fresh SQLite files and compares every table (columns, types, defaults,
   generated expressions, CHECKs, foreign keys), index (keys, collation,
   uniqueness, partial `WHERE`), trigger and view, and every row. Column
   order is ignored, because `ALTER TABLE ADD` appended columns that the
   baseline lists in schema order. The output goes in the PR body; the
   script is not committed.
5. Comments: the five `schema-core.ts` paths that no longer exist
   (`account/terms-acceptance`, `lib/access.ts`, `feed/consensus.ts`,
   `feed/feed.ts`, `lib/outbox.ts`). #912's two and #796's account paths
   were already fixed on main. The denylist seed's "migration 0078" in
   `docs/contracts.md` and its test now name `0001_seed.sql`.
6. `.claude/rules/schema.md` §The baseline records the second squash and
   where numbering continues; `docs/deployment.md` cites #670 beside #506.

## Contract touches

- Schema: core's history replaced (destructive, pre-approved before the
  first deploy, D-139), under the owner's one-time grant for this PR
  (2026-11-25). One new index, `follows_followee` (additive).
- New route files, bindings, queues, crons: **none**. Screens: none.

## Test plan

- vitest `worker`: `test/feed/social.test.ts` "counts a runner's
  followers by a seek on follows_followee, never a scan" pins the plan.
- vitest `worker`: `test/migration-chain.test.ts` holds on the two-entry
  chain; every worker test applies the new baseline to real local D1.
- The full `npm test`, `npm run build`, `npm run e2e:ci` and
  `sanctions-check` on the final head.

## Issues

- Closes: #670, #884, #398 (its last two paths were these comments).
- Opens: none.

## Open questions

- Every worktree's local D1 still records the old migration names, so
  each runs `rm -rf .wrangler/state` once after this merges. Said in the
  PR body.
- An unmerged branch with a core migration renumbers it to `0002`.
