# Design: 178 board-gaps

## Problem

Four built screens still differ from their boards (survey items, re-read on
7a160a1a; all four still hold). Boards are authoritative for composition, so
each is drift: G's Recent entries rows say "Entry" (PR#168-1); the A2/A3 desk
rails carry only the run, not the band evidence (PR#113-1); E2-lite has no
summary sentence (PR#102-1); the closet tile has no photo, record or mileage
(PR#101-3).

## Approach

1. **G Recent entries** (round 35 #53b frame). `ownProfile` adds each recent
   entry's day (the observation's zone, else the runner's, else UTC, as
   `OtherProfile.day` does), distance and conditions. The link reads
   `Sat, Aug 29 · 8.2 mi`; the meta line holds the tag first, then
   `41° · OVERCAST` in mono, from `stripConditions` (the card strip's own cell, so the range per R-5). No conditions: `INDOOR` if the run says so,
   else the cell is absent (the card strip's rule, Feed board).
2. **Closet tile** (board C, round 27 #31b). A 4:5 photo at full tile width
   (`photoUrlFor`, the hatch placeholder when none); the existing
   [GENERIC]/[RETIRED]/Checking tags move onto the photo as the board's pills;
   under the name, `8/9 DIALED`, then `[38–46°] · 142 MI`. Data is already on
   `ClosetItemView.performance`; no new read. MOST DIALED / RETIRE? badges and
   the sort stay deferred (R46·109m).
3. **A2/A3 rail band history** (round 25 frames). New `feed/band-runs.ts`:
   `recentRunsInBand(userId, bandFloorC, excludeEntryId)` returns the last
   three verdicted runs in the 5 °C band, each with its day, conditions,
   verdict and pieces. It reads `verdictedEntriesInBand`, which now hands
   back the observation it already walked, so this is the same band as
   A3's history line and its chips: the temperature alone. The board's
   rows mix DAMP and RAIN under one heading, so the heading's sky is the
   run's. One GET server fn, `bandRunsQuery`. A2 fetches it after the
   screen is drawn, as MOST LIKELY does ("only most-likely waits"). A3's
   loader adds it beside counts and signals. A2's heading is
   `LAST 3 IN 38–46° DAMP` and A3's `BEFORE, IN 38–46° DAMP`. Each row has
   its day, conditions, `VerdictBadge` and piece pills.
4. **A3 kit record** (round 25). `THE KIT YOU'RE JUDGING`: each piece with
   `8/9 DIALED · 38–46°`, from the `bandSignals` the route already loads.
   `runsLabel` moves from `closet/label.ts` to `lib/runs-label.ts` so feed
   says "8 of 9 runs" as the closet does.
5. **E2-lite summary sentence (PR#102-1), to round 47 #114.**
   `matchTally` counts the dialed matched runners and their groups from
   its existing garment read. `summarySentence` (`bar-share.ts`) says
   them in round 35 #54's words. The histogram is cut (round 47 #113).
6. **Closet rail, round 47 #112b:** a group holding nothing leaves the rail.

All new reads are in `modules/feed`; routes only wire. No schema change.

## Contract touches

- Schema changes needed: **none**
- New route files: **none** (attach, verdict, me, closet index loaders gain wiring)
- New bindings/queues/crons: **none**
- Screens: G, A2 desk, A3 desk, C, E2-lite. One new server fn → a
  verification-class row. Design-deltas item 113 lists the readings.
- One fallow drizzle-rhyme grant for `band-runs.ts` (owner, 2026-11-06).

## Test plan

- worker: `band-runs.test.ts` — band + precip filter, newest three, excludes
  the entry being judged, other runners' entries absent, no-observation runs
  absent; `profiles` recent rows carry day/distance/conditions.
- ui: `OwnProfile.dom`, `ClosetGrid.dom` (photo/placeholder, record line,
  no-verdict tile), `AttachKit.dom`/`VerdictForm.dom` rail cards incl. empty.
- e2e transcripts updated for G, C, A2, A3; demo video.

## Open questions

Round 47 (113–119) answered all five. The histogram is cut, the sentence
rule is confirmed, and every other guess stands. 112b was taken here.
Design-deltas item 137 holds the sentence's own readings.

## Register changes for the coordinator

- On merge: PR#168-1, PR#113-1, PR#101-3 and PR#102-1 done. The E2
  histogram is cut by round 47 #113 and needs recording as cut.
