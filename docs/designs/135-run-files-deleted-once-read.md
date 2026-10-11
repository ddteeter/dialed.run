# Design: 135 Run files deleted once read

## Problem

An imported FIT, GPX or TCX file is a full GPS track, and it usually starts
and ends at a front door. D-110 kept it as long as its run. The launch legal
research (2026-10-09) found that storing precise geolocation brings
Connecticut's privacy act into reach from the first Connecticut user, and
that Washington's health-data law and the FTC press on the same data. The run
row already keeps only a start point rounded to about a kilometre (R-110), so
the files are the one precise location the app still holds. The owner's call:
delete a file once it has been read (D-116).

## Approach

- **`runs/consumer.ts`**: the batch that marks an import `done` also owes
  the file's deletion, due at once. So does the batch that marks it
  `duplicate`. The new batch item is `fileGoes`, built with the consumer's
  existing `owe` dependency.
- **The debt is `import_file_expire`**, the scheduled kind that failed
  imports already use 30 days out. It is not `import_file_delete`: a due
  `import_file_delete` means a fast path failed, so the digest reports it,
  and every successful import would become a digest line. The daily drain
  pays it, so a file lives for up to a day.
- **Unchanged**: a failed import's 30 days; a run's delete still owing its
  file (now usually already gone; deleting a missing R2 key is a no-op);
  the account purge's listing; Gave up's retry, which cancels a pending
  expiry before re-reading.
- **Coordinates need no change.** Both run inserts round through
  `storedStart`, and the profile inputs round as they parse.

## Contract touches

- Schema changes needed: **none**. New routes or bindings: **none**.
- `wrangler.jsonc`'s IMPORTS comment still says "no expiry since D-110".
  That file is human-managed, so this PR does not edit it; the PR says so.
- Docs: D-116; R-132's trigger; R-146 (upload a file again for an existing
  run); the privacy policy's run-file lines and their source map.

## Test plan

- `test/runs/consumer.test.ts` (worker): a `done` import owes its file's
  deletion now, in the same batch, and the next drain takes it without a
  digest line; a `duplicate` owes its file too. The test that pinned
  D-110's "leaves a succeeded import's file alone" is replaced.

## Open questions

- None. The re-upload flow is R-146, not this PR.
