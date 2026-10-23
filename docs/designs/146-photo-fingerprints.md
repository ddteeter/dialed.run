# Design: 146 photo fingerprints (C16, D-142)

## Problem

The TAKE IT DOWN Act asks for reasonable efforts on known identical copies
of a removed intimate image. Today the effort is a person scrolling the
same runner's other photos (`safety/other-photos.ts`), which says itself
that "nothing hashes photos". D-142: a perceptual hash of every upload,
from the bytes before re-encoding, stored and deleted with the photo, used
only to find copies of a reported or removed image, private included.

## Approach

**Where it is computed: the Worker, from the uploaded bytes.** The server
already decodes every upload with Photon to strip EXIF (SAF-1) —
`feed/photos.ts`' `reencoded` and `closet/photos.ts`' `uploadItemPhoto` —
so the hash is taken from that decoded image *before* `get_bytes_jpeg`.
No new dependency, no binding, nothing in the client bundle. The browser's
blur/scale canvas step does re-encode first, but its output *is* the upload:
a client-computed hash of the pre-blur original would be a claim we cannot
check (a client can send any 16 hex chars), and would hash a picture we
never host, so it could not match a copy of what we do host.

**Algorithm: 64-bit dHash** (9×8 Triangle downscale, luma, left > right),
16 hex chars. Pure bit work in `lib/photo-fingerprint.ts`; Photon passed in.
Measured on 12 synthetic 1600×1200 scenes: a q88 re-encode, an 800×600 q70
copy, a WebP and a PNG of the same image differ by 0–5 bits; different
scenes by 12 or more. A match is **≤ 8 bits** (`FINGERPRINT_MATCH_DISTANCE`).

**Schema (additive, proceeds):** core migration `0064_add_photo_fingerprints`:
nullable `entry_photos.fingerprint`, nullable
`wardrobe_items.photo_fingerprint`, and an index on the latter. Old rows stay
NULL and never match. No other PR in flight touches migrations.

**Deleted with the photo** because it is a column of the photo's row: every
path that deletes an `entry_photos` row (retract, Remove/takedown,
quarantine, purge) or a garment (delete, purge) takes it along. A garment's
Remove photo clears it in the same write that clears `photo_key`, and a
replaced photo overwrites it. A quarantine's `photos_snapshot` copies the
whole row, so the CSAM record keeps the hash for its own year, then goes.

**The search** (`safety/photo-matches.ts`): for each Review row about an
intimate image and each removal request whose link is ours, the subject's
fingerprints are read, then every entry and garment photo within 8 bits is
listed — any runner, private included — capped at 12 per kind.
Hamming distance cannot use an index (SQLite has no popcount and no XOR of
text), so it is **filtered in SQL** by a 16-term expression: per hex digit,
a lookup string precomputed from the subject's digit. That keeps `LIMIT`
honest. The cost is a scan of `entry_photos` and of garments with a photo,
**only when an operator opens Review with such a row** — never on a
runner's page. At 100k photos that is 100k rows read per open row (about
$0.0001). If that grows, banded exact-match columns are the upgrade.

## Contract touches

- Schema: additive (above). Not destructive, not contract-shaped.
- New route files: none. New bindings/queues/crons: none.
- Screens: Review and removal requests gain a **Matching photos** block
  under "Their other photos" — undesigned, design-deltas item 66.

## Test plan

- `test/lib/photo-fingerprint.test.ts` (unit): bit order, luma weights,
  hex padding, distance, match threshold.
- `test/feed/photo-fingerprint.test.ts` (worker): stored on upload; a
  re-upload matches; a re-encoded copy matches; gone with retract, Remove
  and purge.
- `test/closet/photo-fingerprint.test.ts` (worker): stored, replaced,
  cleared by Remove photo, gone with delete.
- `test/safety/photo-matches.test.ts` (worker): finds a copy on another
  runner's private kit and garment; ignores a different picture and the
  subject itself; caps; nothing for a subject with no fingerprint.
- `test/safety/photo-matches.dom.test.tsx` (ui): list, empty state.

## Open questions

- **A removed image's hash goes with it**, so a later re-upload of it is
  not caught. Catching re-uploads needs a blocklist of hashes that outlives
  the photo, which D-142's "deleted with the photo" rules out. Owner's call.
- Photos uploaded before this ships have no fingerprint. A backfill would
  re-read every R2 original; not done (pre-public, few photos).
