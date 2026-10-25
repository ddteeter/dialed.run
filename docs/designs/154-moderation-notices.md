# Design: 154 Moderation notices (C8, D-132, D-145)

## Problem

DSA Art. 17 wants a statement of reasons for every restriction, automatic
hides included, and Art. 16(5) wants the person who reported something told
what was decided. Today an author hears only of a removal or closure, and a
reporter hears nothing. C8 adds the hide notice, the reporter's outcome and
the missing Art. 17(3) elements, in the owner's words (2026-10-22).
Suspected CSAM stays silent throughout.

## Approach

Every notice is a bell row (`notifications`), the path `content_removed`
already uses, written **in the batch** of the change it reports.

- **`safety/notices.ts`** (new) holds the copy and builds the rows:
  `hiddenNotice` (author, when `hidePendingReview` hides an entry or
  photo), `keptNotice` (author, on Approve of a reported entry or photo:
  the hide notice promises "We'll tell you what we decide"), and
  `reporterNotices` (`report_removed` / `report_kept`, one per reporter).
  Each reads the ids it needs before the batch (a batch cannot branch).
  The owner read excludes a copyright-removed entry or held photo, which
  the hide and the Approve leave alone, so nothing false is said.
- **Where they ride:** `reports.ts` `hidePendingReview` (hide);
  `review.ts` `resolveReview` (Approve: reporters `kept`, author `kept`
  when the row came from reports; Remove of a product: reporters
  `removed`); `feed/moderation.ts` `moderateContent` (Remove and takedown:
  reporters `removed`; a quarantine writes nothing); `bans.ts` `banUser`
  (reporters of the profile `removed`, unless the closure is suspected
  CSAM).
- **Dedupe:** reporters keep `INSERT OR IGNORE` on (user, kind, subject),
  so a retry notifies once. The author's two kinds use a new
  `notificationRaise` (upsert back to unread), so a kit approved, reported
  again and hidden again is told again.
- **Art. 17(3) in the emails.** `lib/contracts/community-rules.ts` (new)
  names the terms' ten rules, pinned to `terms.md` by a test. A removal
  reason maps to one (`removalRule`); `content_removed` and
  `account_closed` gain optional `rule` and (removal) `flagged`, both
  optional under law 9. The body adds "That breaks our community rules:
  don't …" and "A person made this decision" / "Our automatic check
  flagged it; a person made the decision" (from the subject's review row:
  `source` is `classifier` or, since #225, `fingerprint`); the foot becomes the approved redress line.
  A copyright-notice takedown names no rule (we acted on a notice, not a
  finding). The removal band in the app gains the same rule line.
- **Closures pick a rule.** D8's Close account gains a required "Which
  rule" pick: the ten rules, or "Suspected CSAM: name no rule".

## Contract touches

- Schema: **none** (`notifications.kind` is free text). No migration.
- New notification kinds: `content_hidden`, `content_kept`,
  `report_removed`, `report_kept`. Email templates: optional fields only.
- Routes, bindings, queues, crons: none. New edge: safety → notifications.
- Undesigned: the four bell rows, the band's rule line, D8's rule pick
  (design-deltas 74–76).

## Test plan

- Worker: a report's hide writes one hide notice; reconcile's hide too; a
  held photo gets none. Approve notifies each reporter once (a second
  decision is `already_resolved`) and the author; Remove notifies
  reporters `removed`; quarantine notifies nobody; a ban notifies the
  profile's reporters unless CSAM. The raise re-arms a read row.
- Unit: email bodies with and without rule and flag; rule names pinned to
  `terms.md`; `removalRule` covers every reason.
- UI: `ContentRemoved` shows the rule line; `NotificationList` renders the
  outcome texts; D8's pick refuses a close with no rule.

## Open questions (proceeding; in PR_BODY for the owner)

- Wording beyond the approved copy: the kit hide notice (photos cannot be
  reported from the app today, so the kit is the one runners will see),
  the author's "left it up", the rule names' phrasing, the closure body.
  **Approved (owner, 2026-10-24)**, with every item of PR_BODY's
  "Wording for owner approval" list.
- Mapping: intimate image → "sexual or explicit". **Resolved (owner,
  2026-10-24):** the Desk's catch-all `rules` reason ("it breaks the
  community rules") is retired, so every removal names one of the terms'
  rules (Art. 17(3)(e)); `removalRule` is total, and only a copyright
  notice's takedown names none. No schema change: the audit row stores
  the statement's words as free text, and nothing is deployed (D-139).
- A hide notice goes out before anyone knows a kit is suspected CSAM; a
  later quarantine then says nothing (D-70).
