# Design: 159 Garment photo Remove notice (R-167)

## Problem

Since C17 (design 157) a garment photo reaches Review, but **Remove** only
hides it (`flagged`) and tells its owner nothing, and its "being checked"
tag never clears. A garment photo found only by copy search (Matching
photos) cannot be acted on from Review at all. The owner approved the
notice's words on 2026-10-26.

## Approach

1. **Remove deletes and tells, as a kit photo's does.**
   `feed/garment-moderation.ts` gains the Remove beside the quarantine
   (`moderateGarmentPhoto`, one entry for both): the same read of the
   garment and its photo, then one batch — the audit row (`remove`,
   `garment`), the photo's fingerprint kept when the reason is `intimate`
   (D-147, `keptGarmentFingerprint`), the open review settled and the
   screenings deleted, the photo cleared off the garment (only the version
   read), the bell row, and outbox debts for the email and the photo's
   bytes (`photo_delete`). The garment stays. `decideReview` sends a
   garment row's Remove here; `subjectWriters.garment` is reached only
   once the photo is gone.
2. **The words (owner, 2026-10-26).** `content_removed` gains the subject
   `garment` (an enum widening, law 9-safe): subject "We removed a photo
   from your closet"; body "We removed the photo of one of your garments.
   Reason: {reason}. {rule line} {who decided} The garment stays in your
   closet."; the same button and `REDRESS_FOOT`. Who decided is
   `wasFlaggedAutomatically` (classifier or fingerprint row). The bell:
   "We removed the photo of one of your garments. Reason: {reason}." —
   raised (`notificationRaise`), since its subject is the garment and a
   later photo on it can be removed too. The opening sentence is one
   constant in `lib/contracts/email-kinds.ts`, shared by both. The email's
   dedupe key names the photo version. A quarantine stays silent (D-70).
3. **Matching photos act on a garment.** A kit match is acted on through
   its kit's page (report → Review row); a garment has no page. So each
   garment match carries the garment row's own decision bar without
   Approve: the reason, **Remove**, **Remove as suspected CSAM** (with the
   same in-row question). The bar is lifted out of `ReviewQueue.tsx` into
   `RemovalDecision.tsx`, shared by both. A new admin server function,
   `decideGarmentMatchAction` (`garmentMatchActionInput`: item id, action,
   reason), calls `moderateGarmentPhoto`. A decided match leaves the list.
   Offered on Review rows and removal requests alike.

## Contract touches

- Schema: **none**. No migration (`notifications.kind` is free text;
  `moderation_actions.subject_type` already widened to `garment`).
- Email template: `content_removed.subject` gains `garment`.
- Server functions: `decideGarmentMatchAction` (admin, `verifiedUserId`).
- Routes: `safety/review.tsx` wires the new action. Bindings: none.
- Screens: Review (match tiles), the bell. Design deltas 88 (amended), 89.

## Test plan

- Worker (`garment-moderation.test.ts`): Remove clears the photo, settles
  the review, deletes screenings, writes the audit row, the bell row and
  the email debt (person vs automatic), owes `photo_delete`; intimate keeps
  the fingerprint; a repeat is `already_removed`; quarantine still silent.
  `decideReview` Remove on a garment row tells the owner.
- Unit: email subject/body for `garment`, flagged and not; bell sentence.
- UI: garment match tile shows the bar (no Approve), sends item id,
  action and reason, asks before a quarantine, leaves the list; a kit
  match shows no bar.

## Open questions

- No in-app band on the garment page after a Remove (the photo is gone;
  the bell says why). Any band would need new words.
