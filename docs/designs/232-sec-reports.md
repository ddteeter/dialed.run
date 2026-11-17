# Design: 232 sec-reports

## Problem

Wave 13 lane 13c: the reports, fingerprint, block and shared-name items
from the 2026-11-14 security audit, tracked by id only in #756 (SA-M10,
SA-M20, SA-M21, SA-M22, SA-M30, SA-M33, SA-L16). This lane hardens how a
report is filed and counted, the re-upload hold, a runner's own delete
of something under review, the operators' alert mail, blocks, brand and
model suggestions, and four sweeps.

## Approach

- **SA-M10, what a report may name** (`safety/reportable.ts`).
  `fileReport` first reads the subject: a kit or kit photo that exists
  and is the reporter's own or shared with runners, a profile or a
  product that exists. Otherwise it writes nothing and answers
  `not_found`. No moderation or reported-by clause, so a kit hidden for
  another reason can still be reported. Each reporter is counted in
  `rate_limits` (`report-runner`): past 20 a day the call answers
  `limited`. A reason that hides at once hides for the first 3 a day
  (`report-at-once`); past that the report is filed and queued with its
  alert and hides nothing until a person looks.
- **SA-M21, a repeat report.** The insert returns what it wrote; a call
  that added no reporter changes nothing (no hide, re-open, notice or
  alert). A crash between insert and hide is the hourly sweep's to finish.
- **SA-M20, the fingerprint breaker.** The hour's count is of distinct
  uploaders, not rows (a kit photo's author, a garment's owner, or
  `resolved_by` once the subject is gone), and an uploader who already
  has a hold this hour is held past the ceiling. **This amends design
  164's fallback** (owner, 2026-11-16).
- **SA-M22, an owner's delete under review** (`safety/withdrawn.ts`).
  Before an owner deletes a kit, a kit photo or a run, the photos under
  a review that a report hiding at once, a fingerprint match or a
  pending removal request opened are read. The delete's batch keeps each
  one's fingerprint and writes a `withdrawn` audit row, owner as actor,
  which flags the account as a removal does. A garment photo the owner
  removes, replaces or deletes while held as a fingerprint copy does the
  same.
- **SA-M33, operator mail.** The operators' alerts and reminders are
  their own outbox kind, `operator_email`: scheduled, no grace, drained
  ahead of `email` on its own cap. The hourly drain says what it left
  due of the kinds it drained, the hour it happens.
- **SA-M30, suggestions.** Brand suggestions list seeded brands first; a
  brand's model chips list products worn by someone besides their maker
  first. A brand or model holding a listed word (`isListedName`) makes no
  shared row on save, on the confirmation's link run or at naming.
- **SA-L16.** A block names a runner with a profile; no cap (owner).
  Settings reads a count, not the roster. Typed-garment linking works
  25 garments a run, owing the rest without counting a failure, and the
  drain takes 5 such rows a run. The handle list reads back `2 6 8 9`.
  The report request and the reconcile sweep share one order-free bar.
  The screening sweep reads pending photos in random order.

## Contract touches

- Schema: `moderation_actions.action` gains `withdrawn`, a text enum with
  no CHECK, so no migration (owner, 2026-11-16). No migration claimed.
- New route files: none. New bindings/queues/crons: **none**; one new
  outbox kind, a wire-format variant (law 9).
- Screens: the report sheet's two refusals (no board change). The privacy
  policy draft gains one sentence.

## Test plan

All vitest (worker; dom for the sheet). No Playwright spec: no new route
or server boundary.

- Reports (`report-limits.test.ts`): unseen and invented subjects, both
  daily bounds and their windows, in parallel; a repeat after an Approve
  and with another reason; the bar in both filing orders and the sweep.
- Fingerprints: one runner's holds count once, the filler stays held, a
  deleted hold counts; the joins in `breakers.test.ts`.
- Owner delete: photo, kit and run paths, a held copy, a removal request;
  an ordinary or decided delete keeps nothing.
- Outbox: operator mail ahead of a backlog, the hourly line, the cap and
  `OWED_AGAIN`. Blocks, suggestions, the word list, digits, sweep order.

## Issues

- Refs #756 (ids ticked by the coordinator on merge).
- Deferred: three private drafts (coordinator-13 filed them).

## Owner answers (2026-11-16)

- 20 reports a day, 3 at-once hides a day; both refusal sentences as written.
- A runner the poster blocked can still report the kit.
- One order-free bar, the lowest among the reasons filed.
- The fingerprint breaker counts distinct uploaders (amends design 164).
- An owner's delete under review keeps the fingerprint and flags the
  account; `withdrawn` added to the enum, no migration.
- Privacy policy: "If you delete a photo while we are reviewing it, we
  keep a short fingerprint of it, never the image itself, so that a copy
  uploaded again is held for a person to check."
- No cap on blocks; no paging of the Blocked page for now.
- Screening sweep rotation: random order, no migration (coordinator).

## Open questions

None.
