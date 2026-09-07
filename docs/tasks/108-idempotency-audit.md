# Task 108 — Idempotency audit (post-merge, serialized)

## Goal

Every server function that **creates** a row from a user action survives being
called twice with the same intent. Today exactly one does.

## Why this is its own task, and why it waits

CLAUDE.md law 8b landed with lane 102's manual-run fix, so the rule exists and
the worked example exists. What does not exist is the audit — and it cannot be
done inside the lane PRs, for two reasons:

1. **It is one migration or four.** Each create path needs a nullable
   `idempotency_key` column and a UNIQUE index scoped to the user. Done in
   four open branches that is four migrations against the same shared
   `schema-core.ts`, each conflicting with the others, plus four rebuilds of
   the drizzle journal. Done once on `main` it is a single additive
   migration.
2. **The lanes cannot see each other.** Lane 101 cannot tell whether 104 has
   already added a key to a table they both touch.

So: **after 101, 102, 103 and 104 are merged**, and before any of the
remaining lanes (105 onboarding, 106 trust/safety, 107 product intel) add
their own create paths.

## You own

- `src/db/schema-core.ts` and one migration (this task is the exception to the
  serialized-schema rule — it *is* the serialization)
- The create paths listed below, across every merged module
- `docs/deferred.md` (retire D-2b when done)

## The paths

Confirm each against the merged tree before starting; this list was written
from the lane branches and a path may have moved.

| # | Path | Table | Notes |
| --- | --- | --- | --- |
| 1 | `createManualRun` | `runs` | **Done** — the worked example. Copy its shape. |
| 2 | Garment create (101) | `wardrobe_items` | Add-a-piece is the highest-traffic form in the product |
| 3 | Product create-if-missing (101) | `products`, `brands` | Already keyed on normalized brand+name, so it may be idempotent *by construction* — verify rather than assume, and write the test either way |
| 4 | Outfit entry create (104) | `outfit_entries` | Attaching a kit to a run |
| 5 | Photo upload (101 + 104) | `entry_photos`, R2 | Two paths. R2 `put` is idempotent by key; the **row insert** is not |
| 6 | Follow (104) | `follows` | Likely already safe via a UNIQUE pair — verify |
| 7 | Reaction / "useful" (104) | `reactions` | As above |
| 8 | Profile + onboarding writes (105) | `user_profiles` | Upserts by user id, so probably safe — confirm |
| 9 | File import start (102) | `imports` | Uploads bytes to R2 *and* inserts a row; a double-submit costs storage as well as a duplicate |

## Requirements

1. **Read the path before changing it.** Several of these are already
   idempotent by construction — a natural key, an upsert, a UNIQUE pair. For
   those the deliverable is a *test* that pins the property and a comment
   saying why no key is needed. Adding a redundant key to an upsert is worse
   than leaving it alone.
2. **For the rest**, follow `createManualRun`: a nullable client-generated
   `idempotency_key`, a UNIQUE index on `(user_id, idempotency_key)` —
   **scoped to the user**, because the key comes from the client and one
   account's key must never return another's row — and a repeat that
   **returns the first row rather than erroring**, so a retry looks like the
   success it is.
3. **One migration.** All columns and indexes in a single additive migration.
   Nothing is dropped or renamed; expand-only (law 8).
4. **One test per path**, minimum: same key twice returns the same row;
   different keys create two; two users sharing a key do not collide.
5. **The client half is not optional.** A key column with no form minting a
   key is decoration. Each form mints on mount, resends on retry, and resets
   after a success.
6. **Where a form has no natural client**, say so and skip it rather than
   inventing one — a queue consumer, for instance, is covered by law 1 and
   needs no key.

## Done when

- Every row in the table above is either fixed or has a test proving it was
  already safe, with a comment saying which.
- One migration, applied cleanly to a fresh database.
- `docs/deferred.md` D-2b retired.
- `npm run verify && npm test` green.

## Out of scope

- Read paths, and anything a queue or cron drives (resilience law 1 already
  covers those, and they are tested separately).
- Rate limiting. A key stops a *retry* becoming a duplicate; it does not stop
  someone deliberately submitting fifty different runs, which is a different
  problem with a different fix.
