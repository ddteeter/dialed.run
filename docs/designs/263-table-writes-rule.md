# Design: 263 the table-write lint rule

> Wave 19, lane A2 (#1044). Design 261 §A row A2, rulings 5 and 6.

## Problem

Nothing says which module writes which table. Design 260 counted 56 of 79
writing batches touching tables that more than one module writes, and the
owner ruled (261, ruling 5) that a lint rule at the call site, driven by one
owner map, should decide it. Ruling 6 keeps `safety` under the content it
moderates, with its status columns listed as its own.

## Approach

Two new files and one config block:

- **`eslint/table-owners.ts`, the map.** One entry per SQL table: an `owner`
  module, which may write it any way, and `others`, every other module that
  writes it today, each with `insert`, `delete` and/or `update: [columns]`
  and a `why`. A column list is a column group: `safety`'s
  `moderationStatus`, `screenStatus`, `visibility`, `products.status` and
  `bannedAt`/`banReason` (ruling 6). The keys and columns are typed from
  `src/db`, so tsc rejects a missing table, an unknown one or a misspelt
  column. It lands listing today's writers, right or wrong; each odd one
  names the lane (B5, B7, B9, B12, C1, D1, D5) or issue that moves it.
- **`eslint/table-writes.ts`, the rule** `dialed/table-writes`, on
  `src/**`. A write is `.insert(t)`, `.update(t)` or `.delete(t)` where `t`'s
  _type_ is a drizzle table (`_.brand: "Table"`), and its name is read from
  `_.name`. A file's module is `src/modules/<name>/`, or `src/<folder>`
  outside them.

The three cases the brief named:

- **Tables in an array.** `[a, b].map((t) => db.delete(t))` gives `t` a
  union type, and every member is checked. An array annotated as
  `SQLiteTable[]` erases the names, and the rule reports it. The purge had
  one (`namedByOwnColumn`), now `as const` (a type-only edit, the
  coordinator's grant).
- **Writes through a helper.** When the table's type names no table and
  the value comes from a parameter of a named function, the rule records
  which parameter it is (and which property of it, as in
  `unlessRequestHolds({ table })`). It then checks each call of that
  function, in the caller's module, through any number of helpers.
  `didClaim`, `setOnSubject`, `updateWhilePending` and `deleteMatching` all
  resolve this way. An update's `.set()` object is followed the same way,
  so a column group is checked through a helper too.
- **Syntax restrictions or a local rule?** A local rule. `no-restricted-syntax`
  matches names, not types: it can't tell an R2 bucket's or a `Set`'s
  `.delete` from a table write (25 such calls in `src`). It can't see
  aliases (`entryTagsTable`, `authSchema.user`), helpers or `.set()`
  columns. And since that rule is replaced rather than merged, its
  selectors would have to be repeated in all 15 blocks that set it.

The rule fails closed. It reports a write whose table no type names, an
update by a column-limited writer whose columns it cannot read, and a
writing helper passed as a value (its calls can't be found). Better Auth's
own adapter writes are not drizzle calls in our code and are not seen.

## Contract touches

- Schema changes needed: **none**
- New route files: none
- New bindings/queues/crons: **none**
- Screens: none
- Grants (261 §The grants): `eslint.config.js`, one block. Type-only, from
  the coordinator: `src/modules/account/purge/purge.ts` (`as const`).

## Test plan

- `test/eslint/table-writes.node.test.ts` (node): lints probes at real
  paths with the real config. Owner passes; a non-owner fails; a listed kind
  passes and an unlisted one fails; listed columns pass and an extra one
  fails; an array of tables checks each one; a write through a generic
  helper, through a property of a parameter, and through a helper in
  another file (`didClaim`) is checked at the call; `SQLiteTable` erasure,
  unknown columns and a helper passed as a value each report; an R2 or
  `Set` delete is ignored.
- `test/eslint/table-owners.node.test.ts` (node): every `Area` is a real
  folder, every table is a real table (tsc holds the rest), and every
  non-owner writer has a `why`.
- `npm run lint` stays green over `src`.

## Issues

- Closes #1044.
- Opens: #1063, the writers no 261 lane moves (`closet` deleting
  `outfit_entry_items`; `notifications` written by four other modules).

## Open questions

None for the owner. Proceeding on these, which the reviewer can veto:

- The grain is the top-level module, as ruling 5 says. A sub-module grain
  (`account/purge`) would be a second map.
- `user_profiles` has no module yet (D2), so `onboarding` is listed as owner.
- `run_conditions` is listed as `feed`'s, with `weather`'s half as a column
  group. `test/architecture/run-conditions-writers.test.ts` stays.
