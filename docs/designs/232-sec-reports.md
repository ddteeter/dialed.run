# Design: 232 sec-reports

## Problem

Wave 13 lane 13c: the reports, fingerprint, block and shared-name items
from the 2026-11-14 security audit, tracked by id only in #756 (SA-M10,
SA-M20, SA-M21, SA-M22, SA-M30, SA-M33, SA-L16). This lane hardens how a
report is filed and counted, the re-upload hold, a runner's own delete
of something under review, the operators' alert mail, blocks, brand and
model suggestions, and four sweeps.

## Approach

- **SA-M10, what a report may name.** `fileReport` first reads the
  subject from the primary: a kit or kit photo exists and is the
  reporter's own or shared with runners; a profile or a product exists.
  Otherwise it writes nothing and answers `not_found`. No moderation or
  reported-by clause, so a kit hidden for another reason can still be
  reported. Each reporter is counted in `rate_limits` (kind
  `report-runner`): past _N_ reports a day the call answers `limited`.
  A reason that hides at once hides for the first _M_ a day (kind
  `report-at-once`); past that the report is filed and queued, hides
  nothing until a person looks, and still owes the alert.
- **SA-M21, a repeat report.** The insert returns what it wrote; a call
  that added no reporter answers the subject's standing and changes
  nothing (no hide, no re-open, no notice, no alert).
- **SA-M20, the fingerprint breaker.** The hour's count is of distinct
  uploaders, not rows (the uploader read through the subject's row, or
  `resolved_by` once the owner deleted it), and an uploader who already
  has a fingerprint hold this hour is held past the ceiling.
- **SA-M22, an owner's delete under review.** Deleting a kit, a photo or
  a garment photo whose open Review row was opened by an at-once report,
  a removal request or a fingerprint match keeps the photo's fingerprint
  and writes an audit row (`withdrawn`, the owner as actor), in the
  delete's batch, guarded in SQL by `EXISTS` on the open row.
- **SA-M33, operator mail.** The operators' alerts and reminders are
  their own outbox kind, `operator_email`, drained before `email` with
  its own cap and no grace. After each hourly drain a backlog still due
  is a Sentry line that hour.
- **SA-M30, suggestions.** Brand suggestions list seeded brands first;
  model suggestions list a brand's products by how many runners wear
  them, then name. A brand or model that is a listed word makes no
  shared row; the garment saves unlinked.
- **SA-L16.** A block names an existing account, and a runner holds at
  most _B_ blocks (one conditional insert); the Blocked page is paged and
  Settings reads a count. Typed-garment linking works a bounded number
  of garments per drain and owes the rest again. The handle list reads
  back `2 6 8 9`. The reconcile sweep and `fileReport` share one bar
  rule. The screening sweep reads pending photos in random order, as the
  time-zone fill does, so the same stuck rows do not hold every firing.

## Contract touches

- Schema changes needed: `moderation_actions.action` gains `withdrawn`
  (a text enum with no CHECK, so no migration; a schema-file edit).
  Possibly core migration 0008 (see open questions). Asked, not claimed.
- New route files: none. New bindings/queues/crons: **none** (a new
  outbox kind is a wire-format variant, law 9).
- Screens: a report sheet's `not_found` and `limited` answers; the
  Blocked page's paging. Copy is a guess until the owner answers.

## Test plan

All vitest (worker; dom for the two report answers). No Playwright spec:
no new route or server boundary.

- Reports: an invented id, a private kit and a blocked-by kit's
  visibility; the two daily bounds, in parallel too; a repeat after an
  Approve; the order-free bar in both filing orders.
- Fingerprints: five holds by one runner leave the sixth held; holds by
  five runners send the next to the classifier; a deleted hold counts.
- Owner delete: kit, photo and garment paths keep the fingerprint and
  the audit row; an ordinary delete keeps nothing.
- Outbox: an operator alert drains ahead of 60 receipts; the hourly line.
- Blocks, suggestions, the linking budget, digits, the sweep's order.

## Issues

- Refs #756 (ids ticked by the coordinator on merge).

## Owner answers

- Screening sweep rotation: random order, no migration (coordinator,
  2026-11-16).

## Open questions

Built on marked guesses; not shipped until answered (via coordinator-13):
_N_ = 20 reports a day, _M_ = 3 at-once hides a day, _B_ = 500 blocks;
the `not_found` / `limited` copy; whether a block refuses a report
(guess: no); the order-free bar (guess: the lowest bar among the reasons
filed); whether `withdrawn` flags the account (guess: yes) and needs a
privacy-policy line; the fingerprint breaker change to design 164; a
flagged handle's visibility while it waits (guess: unchanged, deferred).

Proposed privacy-policy sentence for SA-M22, not yet in the legal texts:
"If you delete a photo while we are reviewing it, we keep a short
fingerprint of it, never the image, so that a copy uploaded again is
held for a person to check."
