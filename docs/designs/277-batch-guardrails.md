# Design: 277 three guardrails on D1 batches

> Wave 19, lane F3. Over the template's page on purpose: three options,
> each with its measurement, then the ruling.
>
> **Owner ruled 2026-11-26** (§Ruling): build §2's `guarded()` helper, then
> a rule that holds batched writes to it (§4), then §1b. Drop §3 and §1a.
> `eslint.config.js` is granted for this lane only, to register the two
> rules.

## Problem

`db.batch()` runs its statements in order, as one transaction on the
primary, and each statement sees the writes before it. Two things go
wrong inside that guarantee, and nothing catches either:

- **A guard that misses fails silently.** A status-guarded `UPDATE` that
  matches nothing changes 0 rows without an error, and the statements
  after it still run. If they depend on it (the notice for a
  claim, the delete a check authorized), they commit without it.
- **A decision read before the batch can be stale.** Inside a request,
  `coreDb()` may read a replica (D-123), and even a primary read can be
  raced by a second request between the read and the batch. A batch
  cannot branch on its own results (`.claude/rules/server.md` §D1
  discipline), so whatever the read decided is written either way.

A read-only audit of every batch on main (2026-11-26) classified about 115
batches: 41 with no guard, 29 whose guards are independent of the rest, 12
with a guard that later statements depend on, and 36 that write what a
read before the batch decided. Its findings are being fixed in lanes F1 and
F2. This design is for the class: three checks, any of which can be built,
so that the next batch like these fails a gate instead of waiting for an audit.

The fix shapes stay in the order the wave uses: (1) fold the condition into
the dependent statement's own WHERE, so the batch is right either way; (2)
a constraint that fails the batch; (3) a changes check after the batch with
a conflict response. The three guardrails below support those shapes. None
of them replaces them.

## 1. A lint rule: reads that decide a write batch come from the primary (§1b ruled in, §1a dropped)

**The rule.** A function that writes with `.batch(` must read through the
primary any value it reads before that batch: `primaryCoreDb()`, a pinned
request, or a handle whose type says primary. Batches that only read are
out of scope.

**Measured on main.** A syntactic scan (scratch TS-compiler script, not
committed) finds 100 functions that call `.batch(` (110 calls). Of those:

| shape                                                     | functions |
| --------------------------------------------------------- | --------- |
| `coreDb()` called and a read before the batch, same body  | 1         |
| any `select`/`findFirst`/`findMany` read before the batch | 16        |
| … of which the handle is a parameter                      | 13        |

The 16 hits by hand (a reviewer traced each caller where needed):

| class                                                           | hits |
| --------------------------------------------------------------- | ---- |
| the batch only reads (out of scope once the rule checks writes) | 4    |
| the handle is the primary (cron, queue, or the caller pins)     | 4    |
| a replica read, but the batch re-checks it in SQL               | 4    |
| a replica read that decides the writes, not re-checked          | 4    |

Of the 4 real hits, one is benign (the state it reads only moves one way).
Five hits needed a trace into a caller in another file to decide, and three
were flagged only for a `.select` used unawaited as a subquery _inside_ the
batch, which is the safe shape.

**What it cannot see.** A deciding read in a helper the batching function
calls, or in a caller that passes the decision in as a value. Several of
the audit's findings have that shape. A rule that looks inside one
function body finds the 4 above and misses those.

**Two ways to build it.**

- **(1a) Syntactic** (`no-restricted-syntax` with an esquery `:has()`
  selector, or a small local rule): flags a function that batches writes and
  calls `coreDb()` or reads before the batch. Cheap to build (half a day),
  but on main it is 1 hit (literal `coreDb()`) or 16 hits with 12 false
  (any read), and it is blind to a handle passed in.
- **(1b) Type-aware, with a primary brand.** `primaryCoreDb()` returns a
  branded `PrimaryCoreDb` (a subtype, so it still goes wherever a `Db`
  does). The rule, a local typescript-eslint rule using type information:
  in a function that batches writes, a drizzle read awaited before the
  batch, or a call before it that is passed a handle, must take a
  `PrimaryCoreDb`. Fixing a hit means typing that function's parameter
  `PrimaryCoreDb`. The compiler then pushes it to every caller, which is how
  the rule reaches across files. A false positive costs one primary read on
  a write path, where the write already goes to the primary. Cost: 2–3 days.
  The brand touches `src/env/d1.ts`. The first pass retypes only the
  parameters on a decide-then-batch path, starting from the 12 hits that
  write (the 4 already on the primary just change type) and following
  their callers. About 530 signatures take a generic `Db` today, and most
  never change. Outside a request every handle
  is already the primary, so a consumer or cron just calls
  `primaryCoreDb()`; nothing changes at runtime.

**What neither catches:** a race on the primary. Two requests can both read
`pending` from the primary and both batch. Only a guard in SQL stops that
(shape 1, or §2).

**Where it lives.** The rule goes in a new `eslint-rules/` folder (1b),
and `eslint.config.js` holds the selector or registers the rule. The brand
is in `src/env/d1.ts` and `src/lib/sql/d1-session.ts`, which are not
protected paths. **Grant needed:** an `eslint.config.js` edit (a protected
path, so the PR needs `owner-approved`). An architecture test under
`test/architecture/` could run the same check, but it is protected too,
and it would run only in `npm test`. The stop gate runs ESLint on every
diff, so a lint is the right tool and the test would be the weaker
substitute (CLAUDE.md, forbidden zones).

## 2. A guarded statement that aborts the whole batch

**Spike** (throwaway worker test on miniflare's D1, not committed; results
below are what it observed):

| question                                                | answer                                                                                                                                                                                                                  |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| does `changes()` in a batch see the previous statement? | yes: 0 after a missed UPDATE, 2 after one that hit two rows; a SELECT in between does not reset it; `ON CONFLICT DO NOTHING` that did nothing is 0, matching `meta.changes`; the same through a `first-primary` session |
| inside an UPDATE's WHERE?                               | it reads the previous statement's count, not its own running one                                                                                                                                                        |
| can a statement fail the batch with no schema?          | yes: `SELECT CASE WHEN changes() = 0 THEN json_extract('{}', ?) END`, with the label bound as the path, throws `bad JSON path: '<label>'` and rolls back every statement before it                                      |
| `RAISE()` outside a trigger?                            | refused: "RAISE() may only be used within a trigger-program"                                                                                                                                                            |
| a CHECK-constraint insert, or a trigger `RAISE`?        | both fail the batch and roll it back (the trigger with its own message), but each needs a table, so a migration                                                                                                         |
| as a drizzle batch item?                                | yes, written as a drizzle `select` of that `CASE` expression from a one-row subquery; `db.run(sql)` is not a batch item (it runs at once)                                                                               |
| trap                                                    | `changes()` is the last completed write **on the connection**, so a guard placed after a read, or first in a batch, sees an earlier batch's count. It must sit directly after the statement it guards                   |

**The helper** (`src/lib/sql/batch-guard.ts`, server-only, beside `claim.ts`):

```ts
// The statement, then the guard that aborts the batch if it changed nothing.
guarded(db, statement: UpdateOrDeleteOrInsert, label: GuardLabel): BatchItem[]
// The batch, with a guard miss turned into a value, not an error.
runGuarded(db, items): Promise<{ ok: true; results } | { ok: false; missed: GuardLabel }>
```

`guarded` accepts only insert, update and delete builders, and puts the
guard immediately after its statement, so the placement trap cannot happen
by hand. `runGuarded` recognizes its own error by the label and rethrows
everything else. A worker test pins the error text, because it is SQLite's
wording and not an API. The caller decides what a miss means: a conflict
response in a request, "someone else got there first" in a consumer.
Rethrowing there would retry until the DLQ (law 1). No schema, no binding.
The cost is one zero-row statement per guard.

**What it catches.** A batch with a dependent guard that uses it can no
longer commit half (12 batches on main have that shape). A decision read before the batch can be re-asserted as a
guarded statement (an `UPDATE … SET x = x WHERE <condition>`), which
closes the replica gap and the primary race together.

**False positives.** None by construction, because it acts only where code
opts in. Its risk is misuse: a guard on a statement that may legitimately
miss (the 29 independent guards) turns a correct no-op into a failure. The
helper's doc and `server.md` say so: shape 1 first, and `guarded` only
where a miss must stop everything.

**Where it lives.** `src/lib/sql/` (no grant). A paragraph in
`.claude/rules/server.md` §D1 discipline. In the mutation ratchet at 100%.

## 3. A changes check in the worker tests (dropped)

**The check.** In the worker tests, record each batch statement's
`meta.changes`, and fail a batch in which a write changed 0 rows while a
later one changed some.

**Probe** (throwaway; `RoutedDatabase.batch` in `src/lib/sql/d1-session.ts`
patched to record, full worker suite run, then reverted): across 9,212
tests, **284 flagged batches from 52 distinct missed statements in 38 test
files**. Read by their SQL, most are correct no-ops: purge steps deleting
rows the runner never had, retention sweeps with nothing past their cutoff,
a `gave_up` clear on a first success (105 of the 284 on its own), and
session deletes for a runner with no sessions. About ten distinct statements are
status-guarded UPDATEs followed by other writes. Each of those would need a
read to tell an independent guard from a dependent one. No test failed.

**What it catches.** Only what a test drives. A guard miss happens in a
race or after a state change, and few tests set one up. So the check
catches a dependent batch only where a test already reaches the miss path,
and then the test's own assertions usually catch it too.

**False positives.** Every correct batch whose guard is meant to miss
alone: the 29 independent guards, an `ON CONFLICT DO NOTHING` beside an
unconditional audit row, a cleanup DELETE that found nothing before an
INSERT. The heuristic cannot tell those apart without a marker, and the
only marker is §2's `guarded`. With §2 built, the check is redundant for
guarded statements, because the batch has already aborted.

**Where it lives.** `src/lib/sql/d1-session.ts` (no grant; it already wraps
every batch, for the query tally). Turning it on only in tests needs a test
binding or a setup hook: `vitest.config.ts` is human-managed (**grant**),
or a hook exported from `d1-session.ts` and set from
`test/apply-migrations.ts` (no grant, but production code carrying a test
hook, which the mutation ratchet must still cover). `src/env/d1.ts` does
not need to change.

## 4. A rule that holds batched writes to `guarded()` (ruled in)

Added by the ruling. §2 acts only where code opts in, so this rule makes
opting out the visible choice.

**The rule.** An `update` or `delete` builder whose WHERE goes beyond the
row's key, built to go into a multi-statement `db.batch()`, must be wrapped
in `guarded()`, or carry an opt-out on the line before it:

```ts
// batch-unguarded -- <why a miss here is meant to be a no-op>
```

The rule itself rejects an opt-out without a reason of 20 characters or
more, which is the bar `fallow-ignore` sets (`fallow-ignore-has-reason`).
Putting the check in the rule means it needs no protected test.

**Scope heuristic.**

- _Beyond the key_: the WHERE names a column that is in no single primary
  key, `.unique()` column or `uniqueIndex(...).on(...)` of the target
  table, or it holds anything the rule cannot read as `eq`/`inArray`/`and`
  on that table's own columns: a subquery, `sql`, another table, or a
  predicate built elsewhere. The keys are read from the `sqliteTable(...)`
  call in `src/db/schema-*.ts` through the type checker, so there is no
  second copy of them (derive, don't mirror).
- _Built for a batch_: the builder is an element of a `.batch([...])` with
  more than one element or a spread, or it is held in a variable, returned,
  or put in an array instead of awaited. A directly awaited write is one
  statement, so it is out of scope.
- `insert … select … where` and `onConflictDoUpdate({ where })` are not
  in the first version, and a later PR can add them.

**Measured on main** (scratch TS-compiler script, not committed): 191
update/delete builders on tables with a key.

| where the builder goes                       | beyond the key | key only |
| -------------------------------------------- | -------------- | -------- |
| written in a multi-statement `.batch([...])` | 48             | 14       |
| held, returned, or in an array batched later | 52             | 26       |
| awaited on its own (out of scope)            | 31             | 20       |

So the rule fires **100 times on main**. By the shape of the WHERE, about 8
are time-cutoff sweeps and about 18 carry a visible status, null, EXISTS or
version guard. The rest name the owner or a parent row (cleanups such as
"delete this runner's sessions"), or use a predicate built elsewhere, which
needs a read to judge. Most cleanups are correct no-ops on a miss, so they
take the opt-out. A WHERE that also holds an ownership check is a guard, and
the rule is right to ask about it. The rule cannot tell those two apart, so
a person chooses at each site.

**Cost.** About 2 days for the rule and its tests. Then each of the 100
sites needs `guarded()` or an opt-out. Some of them are in files other lanes
are changing this wave (§Open question).

## Recommendation (before the ruling)

**Build §2, then §1b. Do not build §3 or §1a.**

- **§2 first.** It is the only one of the three that stops the primary
  race as well as the stale replica. It needs no grant, no schema and no
  binding, and it is about a day with its tests. It is also the tool F1
  and F2's fixes and §1's hits reach for when a condition cannot be folded
  into a WHERE.
- **§1b second.** It is the only one that keeps the next stale-read bug
  from being written. It reaches across files through the type, which
  §1a cannot. It costs an `eslint.config.js` grant and 2–3 days, and its
  first PR retypes the hits' paths.
- **§3: no.** About 40 of the 52 statements it flags on main are correct
  no-ops by their SQL, and each of the rest needs a read to judge. It only sees paths a test already drives, and
  once §2 exists it is redundant for every statement that opts in.
- **§1a: no.** On main it finds 1 hit, or 16 with 12 false, and none of
  the cross-file cases.

The brief planned the lint first if the owner rules during the wave. This
recommends the reverse, because §2 is smaller, needs no grant, and gives
§1b's hits a fix to use.

## Ruling

Owner ruled 2026-11-26 (relayed by the wave coordinator, recorded on
#1097):

1. **§2, the `guarded()` helper**, first. No grant.
2. **§4**, the rule that holds batched writes beyond the key to `guarded()`
   or an opt-out with its reason.
3. **§1b**, the type-aware rule with a primary-handle brand for reads
   that decide a write.

§3 and §1a are dropped. The `eslint.config.js` change that registers rules
2 and 3 is granted for this lane only. That PR records the grant and needs
the owner's `owner-approved` label.

PRs: this design; then the helper (PR 2); then §4 and §1b together (PR 3).
The helper's first users are the batch fixes in lanes F1 and F2. This lane
does not edit their files, and the helper PR lists them under Deferred.

## Contract touches

- Schema changes needed: **none** for any recommendation. The CHECK-table
  and trigger variants of §2 would need one, and are not recommended.
- New route files: none. New bindings/queues/crons: **none**.
- Grants: `eslint.config.js`, to register the §4 and §1b rules (owner,
  2026-11-26, this lane only).
- Screens: none.

## Test plan

Per option, if built (worker unless named):

- §1: a rule test (ESLint `RuleTester`, `node`) per case: a replica read
  before a write batch fails; a `PrimaryCoreDb` read passes; a read-only
  batch passes; a subquery inside the batch passes; a handle passed into a
  call before the batch fails. Then the rule runs on main with every hit
  fixed or retyped in the same PR.
- §2: `guarded` aborts and rolls back when its statement misses; passes
  when it hits; sits directly after its statement whatever comes before;
  `runGuarded` returns the missed label and rethrows other errors; the
  pinned SQLite error text.
- §4: a rule test (`RuleTester`, `node`) per case: a beyond-key update in a
  two-statement batch fails; the same inside `guarded()` passes; a key-only
  write passes; an awaited write passes; a returned or held builder fails;
  an opt-out with a reason passes; an opt-out with a short reason or none
  fails; a composite key and a `uniqueIndex` key count as keys.

## Issues

- Owner questions: #1097 (which to build; answered, Ready) and #1098
  (inline opt-outs or a baseline for §4; Needs owner, before PR 3).
- The helper's PR opens one issue for its first users, the batch fixes in
  lanes F1 and F2.

## Owner question (answered)

Which of the three to build, and in what order? Answered 2026-11-26: §2,
then §4, then §1b (§Ruling).

## Open question (before PR 3)

The §4 rule fires 100 times on main. Inline opt-outs at all of them mean
PR 3 edits dozens of files, some of which lanes F1 and F2 are changing
this wave. The alternative is a baseline: the existing sites go in a list
the rule reads, the list may only shrink (like the module ratchet's pins),
and new code gets no baseline entry. The recommendation is the baseline,
with each entry cleared as its file is next touched. PR 3 waits for the
answer (#1098).
