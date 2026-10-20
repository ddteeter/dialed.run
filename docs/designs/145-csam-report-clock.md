# Design: 145 The CSAM clock from the report (legal readiness C12)

## Problem

18 U.S.C. §2258A(h)(1), as the REPORT Act (Pub. L. 118-59) amended it,
treats a completed CyberTipline report as a request to preserve its
contents for a year after the report. `quarantined_content.retain_until`
was only ever quarantine time + 365 days, so a record reported late in its
year would be purged before the report's year was up, and the policy's
"one year after the report" would be untrue.

## Approach

- **Two nullable columns** on `quarantined_content`: `ncmec_reported_at`
  (integer seconds) and `ncmec_report_id` (text, CyberTipline's number).
- **`recordNcmecReport`** (`modules/safety/quarantine.ts`), admin-only:
  one `UPDATE` that sets `ncmec_reported_at = coalesce(ncmec_reported_at,
  now)` and `retain_until = max(retain_until, that + 365 days)`. SQLite
  reads every `SET` column as it stood, so the time and the clock agree.
  The first recording is the report time, so recording again (a retry, or
  adding the number afterwards) moves nothing; a given number replaces the
  stored one so a typo can be corrected. No record by that id is `gone`.
- **The time is "now"**, when the operator records it, not a typed time.
  The record is made after the report is filed, so its year ends no
  earlier than the report's would. Simpler, and it cannot be typed wrong.
- **The purge is unchanged.** `dueQuarantine` already reads only
  `retain_until`, and a claim's lease only lengthens it.
- **Review** (`/safety/review`) gains a Quarantine section:
  `QuarantineRecords` lists each record (held date, kept-until date,
  reported or not, uploader id) with an optional "CyberTipline report
  number" field and "Record the NCMEC report". The loader reads it through
  `quarantinedContentFor`, which now selects the record without its two
  snapshots, so the content never reaches a page's loader data.
- `recordNcmecReportAction` in `safety/functions.ts`, classed `admin`.

## Contract touches

- Schema: additive, `0062_add_quarantine_ncmec_report` (two nullable
  columns). Numbering: see open questions.
- Routes: `src/routes/safety/review.tsx` wires the component.
- Bindings, queues, crons: none.
- Undesigned surface: the Quarantine section (design-deltas item 67).

## Test plan

- `test/safety/ncmec-report.test.ts` (worker): recording moves
  `retain_until` to report + 1 year; never earlier than it stood;
  re-recording moves nothing; a corrected number; `gone`; admin-only; the
  purge keeps a reported record past the quarantine's year and purges it
  at the report's; an unreported record never purges before quarantine +
  1 year; Review's read carries no snapshots.
- `test/safety/inputs.test.ts`: `ncmecReportInput`.
- `test/lib/dates.test.ts`: `yearDayLabel`.
- `test/safety/quarantine-records.dom.test.tsx` (ui): the list, the
  recording, the field error, `gone`, the empty state.

## Open questions

- Migration number: `0062` here, because `test/migration-chain.test.ts`
  fails on a gap and `main` ends at 0061. C13's unpushed lane also writes
  0062; whichever merges second renumbers to 0063.
- A purge that has already claimed a record (its R2 copies going) when
  the report is recorded still finishes. That needs a record to be
  reported on the last day of its year, during the digest's firing.
