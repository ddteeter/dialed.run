# Design: 157 C17 quarantine gaps

## Problem

An audit of the CSAM and moderation paths (legal-readiness Step 3) found four
gaps: a quarantine keeps the content but not who uploaded it (email, IPs,
sessions), so a ban, the session sweep or the account purge destroys what
18 U.S.C. §2258A(h)(2) asks us to preserve; the reviewer photo route lets the
operator's browser cache material under review for an hour; garment photos
can be flagged but never reach a person, cannot be quarantined and skip the
D-147 removed-fingerprint hold; and `photo_screenings` rows outlive their
photos.

## Approach

1. **Uploader context in the quarantine record.** New nullable column
   `quarantined_content.uploader_snapshot`: JSON of the uploader's email,
   account creation, username, and every `session` row's times, IP address
   and user agent (never the token). Read in `safety/quarantine.ts`
   `uploaderContextOf` before the batch and written by `quarantineInsert`.
   It lives and dies with the record (`retain_until`, a year or a year past
   the NCMEC report), so no sweep has to exempt anything: the row has no
   foreign key, and the purge already deletes it. **IPs:** we record no IP
   per upload; the only IPs held are Better Auth's `session.ip_address`
   (`cf-connecting-ip`) and the HMAC'd `/takedown` key. Nothing new is
   recorded.
2. **`Cache-Control: private, no-store`** on `reviewerPhotoResponse`
   (`feed/photos.ts`); `/feed/photo/` keeps `private, max-age=3600`.
3. **Garment photos join the pipeline.** `review_queue.subject_type` gains
   `garment` (subject id = the item id; TypeScript-only, the column has no
   CHECK). The classifier queues a garment photo's `flag`/`review` as it
   does a kit photo's; a garment upload checks `removed_fingerprints` and
   holds a match for review (D-147), as `feed/photos.ts` does. Review shows
   the garment's card image; **Approve** clears it (`pass`), **Remove as
   suspected CSAM** quarantines it (`feed/garment-moderation.ts`: bytes
   copied to `quarantine/items/…`, the item row snapshotted, the photo
   cleared, the prefix owed a delete, silent per D-70). The screening's
   visibility write lands only over `pending`, as the kit path's does, so a
   late classifier answer never clears a hold. Owner delete, Remove photo,
   replace and the account purge settle the garment's open review.
   Garment photos reach no other runner (owner-scoped route, no other
   reader), so a runner report has nothing to point at.
4. **Screenings go with their photo.** `safety/screening.ts`
   `screeningDeletes` rides every batch that deletes an entry photo or
   clears a garment photo; a quarantine copies them into its snapshot
   first. The screening insert is an `INSERT … SELECT` gated on the photo
   still existing, so a classifier answer that lands after a delete writes
   nothing — no orphan can form, so no sweep is added.

## Contract touches

- Schema: core `0068_add_quarantine_uploader_snapshot` (additive column);
  `0069_quarantine_garment_photos` makes `quarantined_content.entry_id`
  nullable (a table rebuild — destructive-shaped, pre-approved before first
  deploy, D-139). Enum widenings (`review_queue`, `moderation_actions`,
  `quarantined_content` subject types) are TypeScript only.
- New route files: none. Bindings/queues/crons: none.
- Screens: Review (`/safety/review`) shows garment rows; the CSAM question
  names a "garment photo". No runner-facing copy changes.

## Test plan

- `quarantine-preservation.test.ts` (int): snapshot has email, sessions
  with IP/UA and no token; survives ban, session sweep and account purge;
  goes with the record's purge.
- `upload-screening.test.ts` (int): reviewer route sends `private, no-store`.
- `garment-moderation.test.ts` (int): classifier flag queues; fingerprint
  hold; Approve; quarantine (bytes copied, row cleared, record, silence);
  owner delete settles the review.
- Screening rows deleted on retract, photo delete, Remove, quarantine,
  garment delete/replace/Remove photo; late screening writes nothing.

## The row, as round 42 #88 draws it

The garment row was built as a placeholder (design deltas 88) and is now
drawn: it is the kit photo's content row, with the kicker "garment photo
· {id} · @{owner}" and the source tag beside it, the photo at F's card
size (the closet's photo well), then one MONO.xs line "{closet name} ·
{category} · {state}" (`garmentLineOf` in `safety/review.ts`; the name is
`lib/garment-label`'s, moved out of `closet` so `safety` can read it, and
the state is the rotation's "In use" or "Retired"). MATCHING PHOTOS and the
decision bar are the kit row's. A quarantine still tells nobody: no bell
row and no email (round 42 #88, D-70; pinned by `garment-remove.test.ts`
and `quarantine-gaps.test.ts`).

## Open questions (asked in the lane report)

- **Remove of a garment photo**: answered by design 159 (the owner's words,
  2026-10-26), confirmed in round 42 #88.
- This reverses design 106's 2026-09-15 call that garment photos never
  reach the queue (R-69's second shape). Privacy policy already lists
  moderation as a reason operators see private content.
