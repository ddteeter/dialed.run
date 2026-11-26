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

A new file, `src/modules/runs/retries.ts`, exported on `runs`' door:

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

**Numbers.** `runs`' door 16 → 19. Every pair of modules already exists:
`ops` and `feed` import `runs` today, so no fan-out changes and no
cross-module arrow is added.

**A2's owner map** (#1044, unmerged). After the rebase onto A2, these
rows change to `runs`: `imports` (status) from `ops`; `runs` (weather
status) from `ops`; `runs` (effort) from `feed`; and `outbox`'s delete of
an owed `import_file_expire` from `ops`.

## Contract touches

- Schema changes: **none**. Bindings, queues, crons: **none**.
- Protected path: none expected (no pin changes). The owner map, when
  A2 lands.

## Diagrams

`entries.ts` and `gave-up.ts` are cited by the public-photos and
enrichment stories. Each is re-read, and a step that is the Desk's retry
names `runs`' function where it now runs.

## Test plan

- The Desk's retry tests (`test/ops/`, gave-up) keep passing unchanged:
  they drive `retryGaveUp` and read the database.
- `test/runs/retries.test.ts` (worker): each export alone, including the
  `gone` paths and the effort statement's owner scope, since `runs`'
  files are mutation tested on their own.

## Issues

- Closes: #1074

## Open questions

None.
