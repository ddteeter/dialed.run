# Design: 155 C8 follow-up (round 40 C3, R-162, R-163, round 39 #71 #73 #76)

## Problem

C8 (#220, design 154) shipped the moderation notices with seven loose ends
the owner has since settled: the removal email's round 40 words (C3), two
blocked register rows (R-162, R-163), three round 39 build items on the
Desk (#71, #73, #76), and the suspected-CSAM closure email, which must be
the generic one. All wording is the owner's (2026-10-22, 2026-10-24).

## Approach

- **Removal email (C3).** `content_removed` gains an optional `runDay`
  ("Sat, Aug 29"), formatted when the debt is owed by `proseDayLabel` in
  the run's own zone (its starting hour's observation, R-96), so the
  sender needs no database. PHOTO: "We removed the photo from your {day}
  run." KIT: "We removed your {day} run from the feed." The copyright
  bodies are round 38 #63b verbatim and name no day. **Law 9:** a row owed
  before `runDay` existed says "one of your runs", the sentences already
  approved (and kept verbatim in the copyright bodies), so no new words.
  The weather read degrades to UTC (law 5): a removal never fails over a
  date. Button "See the community rules" → `/terms#the-rules`, the id the
  terms page gives "## The rules" (pinned by a test).
- **CSAM closure (item 7).** `account_closed` gains optional
  `namesNoReason: true`; the body is then "We closed your account for
  breaking the community rules." plus the can't-log-in line, with no
  reason, rule or "who decided". The reason is still written (law 9).
- **R-162 (b).** `moderateContent` on a kit also tells the reporters of
  each photo on it (`photoReporterNotices`, one `inArray` read). A kit the
  author deleted first stays silent, so (a) needs no code.
- **R-163.** A `/takedown` hold raises `HIDDEN_NOTICE` for the author, in
  the hold's batch, only when the subject is in the state the hold moves
  (read first), so nothing already hidden or removed is told it was
  hidden. CSAM: the notice goes out before anyone knows (as a report's
  does, design 154); the quarantine after it says nothing (D-70).
- **#76.** The CSAM option reads "Suspected CSAM (the notice names no rule)".
- **#73.** "Counter-notice received" takes RECEIVED ON (`type="date"`,
  default today in UTC, the Desk's clock). The schema refuses a future day
  ("Pick today or an earlier day."); a day before the hide is refused by
  the client's schema and by the update's `WHERE` ("Pick a date on or
  after it was hidden."). `counter_notice_at` stores that day's 00:00 UTC
  and the restore counts from it. Both Case over presses confirm in place
  (`role="alertdialog"`), Not yet returns focus to the pressed one, and a
  settled row leaves the list, its sentence said by the list's status.
- **#71.** Matching photos: kicker "Matching photos · any runner · N"
  (no count when empty), merged nearest first with kits before garments
  at a distance; under each tile the id, "{N} bits" / "same", `[private]`
  for a kit not shared, and the owner's @handle opening D8.

## Contract touches

- Schema: **none** (`counter_notice_at` exists). No migration.
- Email templates: two optional fields. Routes, bindings, queues: none.
- Screens: D1 Review (holds, matches), D8 Close account; emails.

## Test plan

- Unit: email bodies with and without `runDay`, copyright, the button;
  closure generic body; the rules anchor against `terms.md`.
- Worker: removal email carries the run's day (zone and UTC fallback);
  a kit removal tells its photos' reporters; a takedown hold notifies
  the author once, never over a removed or hidden subject; counter-notice
  date stored and refused.
- UI: RECEIVED ON default and refusals; the confirm, Not yet focus, row
  leaves; match tile meta, `[private]`, owner link, order, kicker.

## Open questions

None open; the fallback wording choice above is recorded here for review.
