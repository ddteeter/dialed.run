# Design: 271 each module forgets its own rows

> Design 261 §D, row D1; ruling 7 ("next"). Issue #1067. Builds on design
> 264's coverage check (#1065). Docs only: nothing is built until the owner
> rules. Over the template's page on purpose: the mapping table is the
> deliverable.

## Problem

The purge (`src/modules/account/purge/purge.ts`) deletes from 21 tables it
does not own by name, and reaches seven more through their owners'
functions (design 260). The export
(`src/modules/account/export-build/export.ts`) reads ten tables of five
modules by name. So a module that adds a table naming a runner has to edit
`account` for it to be forgotten or exported. the purge alone imports
eight modules. The owner's ruling is that a module
holds the responsibility for its own tables: it says how its rows are
forgotten and what of them goes in the export, and `dispatch` hands those
steps to `account`, which only runs them in order.

## Approach

### The contract

A type in `src/lib/sql/runner-steps.ts` (server-only, beside the other D1
helpers), with no table in it:

```ts
interface ForgetStep {
  readonly owner: ModuleName;
  // Work done before the last batch, in list order: a revoke, a page of
  // deletes, an R2 listing. Re-runnable from any point (law 1): it reads
  // what is left.
  readonly before?: (ctx: ForgetContext) => Promise<void>;
  // Statements for the purge's one last batch, which also deletes the
  // `user` row and the claim (so a purge that reaches it finishes whole).
  readonly rows?: (ctx: ForgetContext) => readonly BatchItem<"sqlite">[];
}
interface ForgetContext {
  readonly db: Db;
  readonly userId: string;
  readonly handle: string | undefined; // read by the profile's owner first
  readonly addresses: readonly string[]; // the proved addresses, lower-cased
  readonly now: number;
  readonly report: Report;
}
interface ExportPart {
  readonly owner: ModuleName;
  // The part's sheets, each with its own columns (D-79's layout).
  readonly read: (db: Db, userId: string) => Promise<readonly Sheet[]>;
}
```

Each module's door exports its step and its part (`forgetRunner`,
`exportRunner`). `dispatch` builds the ordered lists
(`src/modules/dispatch/runner-steps.ts`) and hands them to
`purgeDueAccounts` and the export build in their deps, as it already hands
in `PurgeDeps` and `ExportConsumers`. `account/purge` keeps the claim, the
lease, the budget, the digest and the last batch's frame, and imports no
feature module.

### Who forgets what

Each row of design 264's check, by the owner that writes the table
(`insert` sites today; A2's owner map once it lands):

| owner              | `before`                                                                                                                      | `rows` in the last batch                                                                                                                                        | kept (design 264's exemptions)                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `runs`             | revoke Strava, first (`disconnectStrava`); list `imports/` in R2, after the runs                                              | `imports`, `strava_connections`, `reminder_email_days`                                                                                                          | —                                              |
| `safety`           | screenings of their photos, open reviews settled (before the photos go)                                                       | `blocks` both ways, `held_take_downs`, report counts, `reports.reporter_id` rewritten                                                                           | reports, reviews and actions about them; #1055 |
| `feed` + `weather` | the runs, a page at a time under the firing's budget: weather's bands, then feed's `deleteRunsThrough`; then the entries left | `follows` both ways, `follow_notices`, `reactions`                                                                                                              | —                                              |
| `closet`           | —                                                                                                                             | `wardrobe_items`, and each garment's `photo_delete` owed to the outbox                                                                                          | —                                              |
| `notifications`    | —                                                                                                                             | `notifications` (theirs, and the rings naming them, before `follow_notices` goes)                                                                               | —                                              |
| `email`            | —                                                                                                                             | `notification_preferences`; send counts by address                                                                                                              | —                                              |
| `weather`          | —                                                                                                                             | `run_conditions`                                                                                                                                                | —                                              |
| `products`         | —                                                                                                                             | `product_corrections`                                                                                                                                           | `products.created_by`                          |
| `enrichment`       | —                                                                                                                             | its runner limit                                                                                                                                                | —                                              |
| `account`          | list `exports/` in R2                                                                                                         | `terms_acceptances`, `data_exports`, `email_verifications`, invites, access asks and requests, closed-address fingerprints, the retired handle, `user_profiles` | `username_history`, `invite_redemptions`       |
| `auth`             | —                                                                                                                             | `verification`, `session`, `account`, `password_attempts`, then `user`                                                                                          | —                                              |

The rate-limit kinds move with their owners once B12 makes `ops/limits`:
each module forgets its own kinds (`upload-runner` is `runs`', `photo-runner`
`closet`'s) rather than `account` naming all ten.

### The order, pinned

The list is dispatch's, and a test pins what must hold: Strava is revoked
before anything else; screenings go before the photos; the runs go before
the closet and the R2 listings; in the last batch the rings go before
`follow_notices`, and `auth`'s rows, then the claim, are last. Design
264's check keeps running, now on dispatch's live lists, and gains a
second test: each table's statement comes from the owner A2's map lists.
The export gets the same pair: every runner column is in a part, or exempt
with a reason ("not something they put in": counts, the Desk's records).

### What it changes

- `account`'s fan-out falls from 9 to 6: `enrichment`, `feed` and
  `weather` are imported only by the purge and the export build.
- `dispatch`'s rises by the modules it does not import yet, outside the
  budget once A1 lands (ruling 10).
- `account/purge` no longer composes other modules, so A1's direction
  number need not set it aside.

### Order of work

After A1 (budget), A2 (owner map), B12 (`ops/limits`), D2 (who owns
`user_profiles`) and D5 (where a run's delete lives: the `feed` row above
may become `runs`'). Then three lanes: the contract with `account`'s own
step and the purge's frame; every other module's step, one door at a time
behind the coverage check; the export parts.

## Contract touches

- Schema changes: **none**. Bindings, queues, crons: **none**.
- Behaviour: none intended. What is deleted, kept and exported stays as
  today; the existing `purge.test.ts` and `export.test.ts` prove it.

## Diagrams

When this is built, these views change and their lane redraws them:
`deletionPurge` and `deletionRecovery` (`docs/diagrams/flows/deletion.c4`),
`exportStory` (`docs/diagrams/flows/export.c4`). Not redrawn here.

## Issues

- Closes: #1067
- Opens: #1068, the owner question below, in Needs owner. Folds in #1055.

## Questions for the owner

1. **The shape.** (a) As it is. (b) Each module exports its forget step,
   and `dispatch` hands the ordered list to the purge. Recommended: (b).
2. **The export too?** (a) Only the purge. (b) The same, with each module
   owning its sheets' columns. Recommended: (b), as its own lane after the
   purge.
3. **#1055, a Desk operator's id on the Desk's records** after that
   operator's account is purged (11 columns). Recommended: keep, as the
   record of who acted.
4. **#1055, a settled copyright hold's `owner_id`.** Recommended: keep, as
   D-70 keeps `moderation_actions.subject_owner_id`. The alternative is
   rewriting it as `reports.reporter_id` is.
