# Design: 167 Stuck photos go to the Desk (D-153)

> Hard cap: one page (~60 lines). If you exceed it, cut. The reviewer reads
> this on a phone. Diagrams count as clarity, not length.

## Problem

A photo whose R2 object is missing, or that the classifier never answers
for, stays `pending` for good (law 6). Its owner sees "being checked"
forever, and the only signal is an hourly Sentry line with no ids. The owner
decided (2026-10-31, D-153): a garment or entry photo still pending 24 hours
after upload goes to the Desk's review queue for a person.

## Approach

- **Upload time needs no column.** An entry photo's id is a ULID minted at
  upload (`feed/photos.ts`), and a garment's `photo_key` ends in the ULID of
  the version minted at upload (`closet/photos.ts`). `PendingPhoto` carries
  `uploadedAt`, decoded from that ULID. No schema change for the clock.
- **The sweep escalates what it could not screen.** `retryPendingScreenings`
  already tries every pending photo, oldest first. Each attempt now says
  _why_ it deferred: `missing` (R2 has no object — fetched even when there
  is no classifier) or `deferred` (no answer). A deferred photo
  uploaded 24h or more ago is escalated, in one `db.batch()` per sweep.
- **Two new `review_queue.source` values**: `unscreened` (the classifier
  never answered) and `missing_file` (nothing in storage to screen). A text
  enum widening — no CHECK, so no migration (as `fingerprint` was).
- **Idempotent in SQL (laws 1, 2).** The escalation is an upsert on
  `UNIQUE(subject_type, subject_id)`: a new row, or re-opening a row that
  was settled more than 24h ago. An open row is left alone (a reviewer is
  already on it, whatever brought it), and a row a person settled within the
  day is not re-opened, so hourly re-runs neither duplicate nor nag. A
  photo still stuck a day after a decision comes back once a day.
- **A later verdict clears it.** When screening finally lands a `pass`, the
  same batch settles an open `unscreened`/`missing_file` row (`approved`, by
  `screening`); `review`/`flag` already re-point the row to `classifier`.
- **The Desk row** reuses the review row, with a why-here line in place
  of "Nobody reported this" (as the flagged-handle row does) and the
  source tag. A `missing_file` row shows no photo (there is none to load).
  Placeholder protocol: bracket tags and a body line, design-deltas
  item 94.
- **Approve on an `unscreened` row publishes** (owner, 2026-10-31): the
  entry photo goes to `pass`, not back to `pending`, since nothing else
  will screen it and a person now has. Every other source keeps the
  2026-09-15 rule. A garment's Approve was already `pass`.
- **A `missing_file` row offers Clear photo, not Approve** (owner,
  2026-10-31; `feed/missing-photo.ts`). One batch takes the photo off its
  kit (`photoDeletion`, shared with the runner's delete and a Remove) or
  garment (`clearedPhoto`), settles the row as the reviewer, deletes its
  screenings and raises a `photo_missing` bell row asking the owner to add
  it again; the storage reconcile is owed through the outbox in the same
  batch (law 8c) and the fast path's failure is reported, not thrown
  (law 5). No rule, no `moderation_actions` row: it is no verdict on the
  runner. It clears only a photo still pending, and a garment photo only
  if its version is a day old, so a re-upload is never taken off. Remove
  and Remove as suspected CSAM stay on the row.
- **Today** counts both sources in "photos the screener couldn't finish",
  which is what they literally are.
- **Sentry**: the "still pending" line lists each photo as
  `scope:id` with `(missing)` where the object is gone — ids only, never
  keys or bytes (law 7) — and says how many went to the Desk.

## Contract touches

- Schema: `review_queue.source` gains `unscreened`, `missing_file` (TS-only
  enum widening, additive; `docs/contracts.md` row updated).
- New routes / bindings / queues / crons: **none** (rides `screening-retry`).
- Screens: Desk · Review row (placeholder), design-deltas item 94.

## Test plan

- worker `test/safety/stuck-photos.test.ts`: escalates at 24h, not at 23h59
  (boundary); entry and garment; `missing_file` vs `unscreened`; no
  classifier still escalates; re-run makes one row; a settled row is not
  re-opened within 24h and is after; an open `reports` row is left alone; a
  late pass settles the stuck row; the Sentry line names ids and `(missing)`.
- worker: `uploadedAt` from a ULID / version key; `todayCounts` counts both.
- dom: the review row's tags, why-here lines and no photo on `missing_file`;
  Clear photo in place of Approve there, sending `clear`.
- worker: Approve on `unscreened` publishes, on `missing_file` stays
  pending; Clear takes a kit's and a garment's photo off with one notice,
  no audit row, no debt left; refuses an `unscreened` row, a photo no
  longer pending, a garment re-uploaded within the day, and a repeat.

## Open questions

- None open. Approve and the missing file were answered 2026-10-31 (see
  Approach). The button label and the notice text are drafts awaiting the
  owner (`RemovalDecision.tsx` `REASONLESS_LABELS`,
  `feed/missing-photo.ts` `MISSING_PHOTO_NOTICE`). The notice is a bell row
  only, not an email.
