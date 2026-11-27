# Design: 275 `runs` writes its own retries and a run's effort

> Design 261 §B row B7; design 258 proposal 7, widened. Issue #1074.
> Behaviour-neutral: every batch moves whole.

## Problem

Three writes to `runs`' tables are made outside `runs`. The Desk's import
retry and weather retry (`src/modules/ops/desk/gave-up.ts`) update
`imports` and `runs` and cancel an owed file deletion. A kit's verdict
(`src/modules/feed/entries/entries.ts`) writes the run's effort. One
module should move an import from failed to pending and a run's weather
back to pending, as `enrichment` does for its own retry
(`retryFailedEnrichment`).

## Approach

A new sub-module, `src/modules/runs/writes/` (its door `writes/index.ts`,
the code in `writes.ts`):

- `retryFailedImport(db, importId, deps)`: the body of today's
  `retryImport`. It reads the import, checks its file is still in the
  bucket, and in one batch moves it from failed to pending, cancels its
  owed `import_file_expire` and settles the Desk's row, then sends
  `import` (a failed send is reported, not thrown). It returns `retried`
  or `gone`.
- `retryFailedWeather(db, runId, settle)`: the body of today's
  `retryWeather`, in one batch with the row's settle. It returns
  `retried` or `gone`.
- `runEffortStatement(db, runId, userId, effort)`: the update `entries.ts`
  puts in the verdict's batch, returned as a statement so the batch stays
  whole.

**The Desk's row stays `ops`'.** `runs` never names `gave_up`: each retry
takes a `settle` that returns the Desk's clear statement. `runs` puts it
in its batch, or awaits it alone on `gone`, exactly where the clear sits
today. `ops` keeps the queue, the file check and the reporter, and hands
them in as `retryFailedEnrichment`'s deps are. `ops/desk/gave-up.ts` keeps
the switch, the enrichment and reminder retries, and `RetryOutcome`.

**Numbers.** A sub-module, not three more names on `runs`' door:
that door is pinned at 16 (`parentDoor`), and design 240 rule 4 says a
new name goes on a sub-module's door. `ops` and `feed` import
`runs/writes`, so no fan-out changes and no module pair is added. The
new unit's own door is 3 names.

**A2's owner map** (`eslint/table-owners.ts`). `runs` owns `imports`
and `runs`, so `ops`' lines for import status and weather status go, and
so does `feed`'s effort columns. `outbox` is `ops`', so `runs` gains a
line for deleting a retried import's owed `import_file_expire`. The
rule's helper test, which used `ops`' weather-status line as its
example, now uses `weather`'s.

## Contract touches

- Schema changes: **none**. Bindings, queues, crons: **none**.
- Protected paths: `stryker.conf.json` (`runs/writes/**/*.ts` joins `runs`'
  explicit entry), and `eslint/table-owners.ts`. No pin changes.

## Diagrams

`entries.ts` and `gave-up.ts` are cited by the public-photos and
enrichment stories. Each is re-read, and a step that is the Desk's retry
names `runs`' function where it now runs.

## Test plan

- The Desk's retry tests (`test/ops/`, gave-up) keep passing unchanged:
  they drive `retryGaveUp` and read the database.
- `test/runs/writes.test.ts` (worker): each export alone, including the
  `gone` paths and the effort statement's owner scope, since `runs`'
  files are mutation tested on their own.

## Issues

- Closes: #1074

## Open questions

None.
