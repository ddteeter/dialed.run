# Design: 151 Keeping a removed intimate image's fingerprint (D-147)

## Problem

Design 146 deletes a photo's fingerprint with the photo (D-142), so an
intimate image we removed can be uploaded again and nothing notices. Once
someone has posted one here, a second attempt is a real risk. The FTC's
guidance suggests hashing "to prevent the reappearance" of removed
content. Separately, a person asking us to remove an image should be told
how to stop it spreading elsewhere.

## Decisions (owner, 2026-10-24) — recorded as D-147, amending D-142

- **Scope:** only removals for reason `intimate` (a Remove from an
  intimate-image report or a `/takedown` request). A CSAM quarantine keeps
  its own snapshot and year (D-70); PhotoDNA covers known CSAM (D-129).
- **On match:** the upload succeeds, the photo is held as
  `hidden_pending_review`, and one Review row is queued. It is never
  refused and never auto-removed.
- **Retention:** 3 years from the removal, swept with D-131's records.
- **Algorithm:** stays dHash. Outside hash lists (StopNCII) are out of
  scope; a PDQ switch later is a backfill from the stored R2 copies.

## Approach

1. **Keep:** `feed/moderation.ts` `moderateContent`. When
   `reason === "intimate"` and the action deletes (not a copyright hold),
   the batch gets an `INSERT … SELECT` into `removed_fingerprints` from the
   photos in scope, _before_ their delete in the same batch. One batch, so
   no photo goes without its hash being kept.
2. **Check:** `feed/photos.ts` `uploadPhoto`, after the row insert and
   before screening: a read of `removed_fingerprints` within
   `FINGERPRINT_MATCH_DISTANCE`, using design 146's `distanceSql` (moved to
   `lib/sql/` so feed and safety share it). On a match, one batch sets
   `screen_status = 'hidden_pending_review'` and enqueues a Review row with
   `source: 'fingerprint'`. Screening only writes over `pending`, so a
   classifier pass cannot publish it. **Kit photos only.** A garment photo
   is never shown to anyone else, so a copy in a closet harms nobody we
   could protect, and queueing it would show an operator a private photo.
3. **Review row:** the existing Matching photos block shows which removal
   it matched and the distance. The author sees D-145's "hidden while a
   person reviews it" notice (PR #220).
4. **Sweep:** `safety/retention.ts` gains a sixth delete: rows past the
   1096-day line.
5. **Copy:** a pointer to StopNCII.org (18+) and Take It Down (under 18)
   on the `/takedown` receipt (`TakedownRequest.tsx`), the confirm page
   (`TakedownConfirm.tsx`), and the in-app report sheet's `intimate`
   branch (`ReportSheet.tsx`).
6. **Legal text:** the privacy policy's Fingerprints bullet and retention
   row ("deleted with the photo, except a photo we remove as an intimate
   image shared without consent: its fingerprint is kept 3 years to catch
   it being uploaded again"), plus `privacy-policy-sources.md`.

## Contract touches

- Schema (additive, proceeds): table `removed_fingerprints` (`id`,
  `fingerprint`, `moderation_action_id`, `created_at`), index on
  `created_at` for the sweep. `review_queue.source` gains the TS enum value
  `fingerprint` (a text column, no SQL change). Migration
  `0067_add_removed_fingerprints`, renumbered past #220 if it lands first.
- Routes, bindings, queues, crons: none.
- Design deltas: the StopNCII / Take It Down line (copy on an existing
  receipt) and the "matched a removed image" line on the Review row.

## Test plan

- `test/feed/moderation.test.ts` (worker): an intimate Remove keeps every
  in-scope fingerprint; other reasons, quarantine and copyright holds keep
  none; a photo with no fingerprint keeps nothing.
- `test/feed/photo-fingerprint.test.ts` (worker): a re-upload within 8
  bits is held and queued; 9 bits passes; a later classifier pass leaves it
  hidden.
- `test/safety/retention.test.ts` (worker): swept at 1096 days, kept at 1095.
- `*.dom.test.tsx` (ui): the pointer renders on each surface; Review shows
  the matched removal.

## Open questions

- **Wording.** The draft is "If it may be on other sites too, StopNCII.org
  (18 and over) or Take It Down (under 18) can help stop it spreading there.
  They fingerprint the image on your own device; the image never leaves
  it." I'm proceeding with this unless vetoed.
- **The notice tips off a deliberate re-uploader.** D-145 requires it for
  any hide, so it stays. I'm flagging it, not asking for a change.
