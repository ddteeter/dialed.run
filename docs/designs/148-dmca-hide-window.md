# Design: 148 The DMCA hide window (C5, D-130)

## Problem

A copyright takedown deletes the kit or photo at once, so a valid
counter-notice cannot put it back, which 17 U.S.C. §512(g)(2)(C) expects.
D-130 (owner, 2026-10-18; design approved 2026-10-22): hide it instead,
delete it after 30 days, and restore it on a counter-notice unless the
sender goes to court.

## Approach

- **A hold row per copyright takedown** (`copyright_holds`, new table):
  the subject, its owner and entry, the audit row it answers, `hidden_at`,
  `purge_at` (+30 days), and the Desk's `counter_notice_at`,
  `restore_at` and `court_action_at` with who recorded each. `status` is
  `hidden` → `restored`, or `hidden` → `purging` → `purged`.
- **Hide** (`feed/moderation.ts`): a takedown whose reason is `copyright`
  writes, in one batch, the hold, the hide (entry
  `moderation_status = 'removed'`; photo `screen_status = 'removed'`, a
  new value), the audit row and the author's notice, which are unchanged.
  Open reviews stay open: a reviewer can still Remove or quarantine it. No bytes are owed to R2, so the photo's fingerprint stays
  until purge (C16). A removal request's `intimate` takedown still deletes.
- **Who sees a hidden subject.** Nobody but the Desk sees a hidden photo,
  its author included (`entries.ts`, `photos.ts`): the band says "PHOTO
  REMOVED". A hidden entry is out of the feed and every stranger's read
  (`publiclyVisibleEntry` already wants `ok`) and, as the band "REMOVED
  FROM THE FEED" says, its author still sees it, as every owner read does.
- **Desk** (`safety/copyright-holds.ts`, `CopyrightHolds.tsx` on Review):
  the held list, each row with **Counter-notice received** (records now,
  and `restore_at` = 00:00 UTC of the 12th weekday after it) and, once
  one is recorded, **Court action filed**. Admin + confirmed address.
- **Daily sweep** (feed `sweepCopyrightHolds`, handed to the daily firing
  as `DailyUpkeep.sweepCopyrightHolds`, no new cron): restore due holds
  with no court action — the claim and the give-back in one batch, the
  give-back conditional on this sweep's claim (`releaseHoldWrites`'s
  pattern) — then purge holds past 30 days with no pending counter-notice:
  claim `purging`, then feed's own delete statements with the R2 debt and
  `purged`, in one `commit`. A `purging` row is re-driven next day.
- **Strikes**: `copyrightStrikes(owner)` counts the owner's holds that
  were not restored; the Desk row shows it. Restored ones do not count.
  The run's "removed" band stops showing once its hold is restored.
- **Guard**: a review Approve never un-hides a subject a live hold covers.

## Contract touches

- Schema (additive): table `copyright_holds`; `entry_photos.screen_status`
  gains `'removed'` (a TS enum value, no SQL). Migration
  `0065_add_copyright_holds`.
- Routes: Review loader returns the holds; two Desk server functions.
- Crons: none new; rides `0 12 * * *`.
- Undesigned surface: the Desk's held list — design-deltas item 73.

## Test plan

Worker: hide on removal (rows kept, hold written, bytes kept);
second takedown answers `already_removed`; owner cannot see a hidden
photo; 12th weekday; restore on that day, not before; court action
cancels; purge after 30 days; no purge while a counter-notice is pending;
no restore after purge; sweep re-run is a no-op; strikes honour a restore;
review Approve keeps a held subject hidden. Dom: the held list's rows,
both actions and their answers.

## Open questions

- Counter-notice is recorded at the click, not a typed date.
- After a court action the hold is no longer "pending", so the 30-day
  purge goes ahead. A litigation hold might want it kept; asked.
