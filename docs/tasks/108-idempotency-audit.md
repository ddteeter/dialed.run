# Task 108 — Idempotency audit (post-merge, serialized) — **DONE 2026-09-08**

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

---

## Outcome (2026-09-08)

Nine paths audited against the merged tree. The split was roughly even
between "needs a key" and "already correct, needs a test", which is why
requirement 1 mattered — three of these would have got a redundant column
if the list had been worked through without reading the code first.

| # | Path | Result |
| --- | --- | --- |
| 1 | `createManualRun` | Already done — the worked example |
| 2 | Garment create | **Key added.** No natural key existed |
| 3 | Brand / product create-if-missing | Already idempotent: UNIQUE on the normalised name + `onConflictDoNothing`. Test only |
| 4 | `attachKit` | Already idempotent by a natural key — `entries_run` is UNIQUE, so the run id *is* the key. **But not atomic**: entry and items were two awaited inserts, and a failure between left a kit with no garments, which renders as an empty entry and cannot be told from a deliberate one. Now one `db.batch()` |
| 5 | Entry photo upload | **Key added**, scoped to the entry rather than the user — narrower, and needs no denormalised owner column |
| 6 | Follow | Already idempotent: UNIQUE pair + `onConflictDoNothing`. Test only |
| 7 | "Useful" reaction | **Deliberately not idempotent** — it is a toggle, and two clicks mean on-then-off. Pinned by a test, because applying the rule blindly here would break the feature |
| 8 | Profile / onboarding writes | Lane 105 has not built them. Its packet carries the requirement |
| 9 | File import start | **Key added**, checked before the R2 put so a retry does not re-upload |

One additive migration (`0013_idempotency_keys`), three nullable columns and
three UNIQUE indexes. Nothing dropped or renamed.

**The client half shipped with it**, per requirement 5 — a key column with no
form minting a key is decoration. `ui/use-idempotency-key.ts` owns the
lifetime (mint on mount, carry through retries, rotate after success), and
the four forms use it rather than each writing their own three lines.

Two things found while doing it, both fixed here:

- `entry_photos` cannot take a `NOT NULL` owner column by `ALTER TABLE`
  without a default, which is what pushed the photo key to entry scope.
- The photo idempotency lookup was first written as a `.find()` over rows
  already fetched. That is the filter-in-SQL law: it is now a seek on the
  new UNIQUE index.

Task 109 (write-atomicity) still owns the remaining sweep; `attachKit` was
one of its findings and is closed by the batch above.
