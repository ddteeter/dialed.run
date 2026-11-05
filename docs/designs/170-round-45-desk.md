# Design: 170 Round 45 on the Desk

## Problem

Design answered the open queue's last six items as `Round 45 Rulings.dc.html`
(design deltas 99–103 and 107). Two are confirmed as built (99, 101). Four
change what the Desk does: Decline asks in the bar's place (107), a missing
file's row offers only Clear photo (100), the many-runners count says when the
search stopped short (102), and releasing a burst of holds can be stopped
partway and says how far it got (103).

## Approach

- **107** (`RemovalRequests.tsx`): Decline becomes a question in the bar's
  place, as Block's is: a `DECLINE THIS REQUEST` kicker, the §4a band, Why
  not (focused on open), chalk Decline and underlined Cancel. Cancel or Esc
  draws the bar again with focus on Decline. The reason lives in
  `RequestActions`, so it survives Cancel until the row is decided.
- **100** (`ReviewQueue.tsx`, `RemovalDecision.tsx`, `feed/missing-photo.ts`):
  a `[file missing]` row's bar is Clear photo alone, as the chalk pill, with
  no reason select and no Remove or CSAM. A `[not screened in a day]` row
  keeps the full bar. The two bell notices take Design's words. They stay
  bell only.
- **102** (`PhotoMatches.tsx`): the many-runners kicker reads `N+` when the
  search was cut off, as the section's count already does.
- **103** (`ReleaseHolds.tsx`): its own sheet rather than `ConfirmLink`, which
  serves every delete and has none of these states. The sheet adds Stop
  (it finishes the batch in flight, then stops), a stopped state ("Approved
  50 of 120. The other 70 are still waiting.", then Approve the rest), a
  failed batch (§4a, `NOT FINISHED`, with the same sentence), and, while a
  release is running, Esc and the scrim do nothing. Finished: the sheet closes,
  the line leaves, and focus goes to the next line or the heading. The body
  takes Design's rewording.
- **99, 101:** no change. 99's clause about the Desk's chalk pill does not
  arise: Au7's notice renders only on the log-in page, which is never on the
  ink ground.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Design deltas 99–103 and 107 answered (round 45). The ruling that bell
  rows open their subject (100) is deferred as R-178: no bell row links
  today, so it is designed once for every kind.

## Test plan

- `takedown-pages.dom` (ui): Decline's question replaces the bar; focus on
  Why not; Cancel and Esc restore the bar with focus on Decline and keep the
  reason; the order of chalk Decline then Cancel.
- `review-queue.dom` (ui): a file-missing row's only button is the chalk
  Clear photo, with no reason select; a not-screened row keeps the full bar.
- `missing-photo` (worker): both notices verbatim.
- `photo-matches.dom` (ui): `N+` for a cut-off search, `N` otherwise.
- `release-holds.dom` (ui): Stop while working, Esc and the scrim inert,
  the stopped and failed sentences, Approve the rest, the focus after the
  release finishes.

## Open questions

None. Owner, 2026-11-04: defer bell links (R-178); 99's Desk clause does not
arise.
