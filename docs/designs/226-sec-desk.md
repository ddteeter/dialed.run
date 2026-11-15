# Design: 226 sec-desk

## Problem

Wave 12 lane 12b: the Desk items from the 2026-11-14 security audit,
tracked by id only in #756 (SA-M7, SA-M23, SA-M24, SA-M37, SA-M39,
SA-L11, SA-L12). This lane hardens the Desk's media route, Review's
decisions, removal requests, the corrections queue, the burst release,
the reports breaker and the moderator's placeholder handle.

## Approach

- **SA-M7, media responses.** `bytesResponse` (`modules/feed/photos.ts`)
  serves only an object stored as `image/jpeg` or `image/webp`, sets
  `Content-Type` from that list, and adds an enforced
  `Content-Security-Policy: sandbox; default-src 'none'`. The reviewer's
  route serves only keys under the photo roots (`entries/`, `items/`,
  `quarantine/`). A product page snapshot is stored as `text/plain`.
- **SA-M23, Approve and a removal request.** An Approve leaves a kit or
  photo hidden while a pending, held removal request names it; the row
  is still settled, and the request's own decision restores or removes
  it. The reporters are told as usual; the author's "left it up" waits.
- **SA-M24, the request's subject.** Review reads a photo request's kit
  from the photo's own row (the recorded subject first, the link's path
  second), and the request row shows a tile of the photo it names.
- **SA-M37, the corrections page.** The page's filer read and a
  decision's update bind their id lists as one JSON parameter
  (`inJsonList`), so any page size is one statement under D1's cap.
- **SA-M39, a link correction's length.** One constant,
  `CORRECTION_VALUE_MAX` (2048), bounds a filed link and the Desk's key.
- **SA-L11, Desk decisions.** Apply writes only a value a runner is still
  waiting on, parsed through the field's own schema; otherwise it writes
  nothing and answers `changed`. A Review decision's statements run only
  while the row is open and unchanged since it was read (status and
  `opened_at`), with the settle last, so of two overlapping decisions
  one lands. The unused claim action is removed.
- **SA-L12, safety and ops.** The burst release approves from at most a
  day back, whatever the request says, claims a row only while it still
  has the released cause, and a `reports` release (and its count) leaves
  out rows an at-once report opened. The reports breaker counts only openings that hid, and no row
  whose subject has an at-once report. A runner cannot claim a handle of
  the placeholder's shape, which is now `runner_` and six digits.

## Contract touches

- Schema changes needed: one **additive** nullable column,
  `review_queue.hid` (integer: 1 when that opening hid its subject, 0
  when it only queued; null on older rows, counted as before), in core
  migration 0006 after #786's 0005 (coordinator, 2026-11-15). The
  reports breaker counts openings that hid. The `review_queue` status
  comment is corrected in the same commit.
- New route files: none. New bindings/queues/crons: **none**.
- Screens: Review › removal request row gains the photo tile (guess,
  built from the Desk's existing tile; Design to confirm). Corrections
  sheet and Desk Corrections each get one new message.

## Test plan

All vitest (worker, plus dom tests for the two new messages and the
tile). No Playwright spec: no new route or server boundary.

- Media: a stored page and a non-image under a photo root are 404; a
  photo is served `image/jpeg` with the sandbox policy; a key outside
  the roots is 404; a snapshot is stored `text/plain`.
- Review: Approve under a held request leaves the subject hidden (kit
  and photo, burst release too), settles the row, and a Decline gives it
  back; replaying a second decision's batch changes nothing.
- Requests: a link pairing one kit with another kit's photo resolves to
  the photo's kit.
- Corrections: a page of a hundred products loads; 2048 files and 2049
  is refused; Apply of an unfiled value writes nothing.
- Release: an old row and an at-once row are left; a row whose cause
  changed is left. Breaker: at-once rows do not count.
- Handles: the shape is refused, kept by a renamed runner, never
  suggested; the placeholder has six digits.

## Issues

- Refs #756 (ids ticked by the coordinator on merge).

## Owner answers (2026-11-15)

- Link limit message: "Keep the link to 2048 characters."
- Apply on a changed suggestion: "That suggestion changed. Reload to see it."
- Placeholder: refuse the shape for runners, and widen it to six digits.
- Release: a `reports` release leaves out at-once rows.
- Approve under a request: reporters told, the author not.
- The request row shows the photo's tile.

## Open questions

- The tile's layout is a guess for Design.
