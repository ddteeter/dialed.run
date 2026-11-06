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
   `recentRunsInBand(userId, bandFloorC, precipClass, excludeEntryId)` → the
   last three verdicted runs in the 5 °C band and precip class, each with
   day, conditions, verdict and piece names. Built on
   `verdictedEntriesInBand`, so it is the same "band" as A3's history line
   and chips. One GET server fn, `bandRunsQuery`. A2 heading
   `LAST 3 IN 38–46° DAMP`; A3 `BEFORE, IN 38–46° DAMP`. Rows: day, conditions,
   `VerdictBadge`, piece pills.
4. **A3 kit record** (round 25). `THE KIT YOU'RE JUDGING`: each piece with
   `8/9 DIALED · 38–46°`, from the `bandSignals` the route already loads.
5. **E2-lite summary sentence** (Feed board, through round 27): "Most got it
   right in long sleeve and shorts. Some added gloves." Built once Design
   gives the rule (Q2); the histogram waits on Q1.

All new reads are in `modules/feed`; routes only wire. No schema change.

## Contract touches

- Schema changes needed: **none**
- New route files: **none** (attach, verdict, me, closet index loaders gain wiring)
- New bindings/queues/crons: **none**
- Screens: G, A2 desk, A3 desk, E2-lite, C. One new server fn → a
  verification-class row.

## Test plan

- worker: `band-runs.test.ts` — band + precip filter, newest three, excludes
  the entry being judged, other runners' entries absent, no-observation runs
  absent; `profiles` recent rows carry day/distance/conditions.
- ui: `OwnProfile.dom`, `ClosetGrid.dom` (photo/placeholder, record line,
  no-verdict tile), `AttachKit.dom`/`VerdictForm.dom` rail cards incl. empty.
- e2e transcripts updated for G, C, A2, A3; demo video.

## Open questions (sent to Design via coordinator-2; building around them)

1. E2 histogram: the Feed board (through r27) draws Matched at 14 runners with
   no "HOW IT WENT FOR THEM"; round 22 says it shows at 10+. Still v1?
2. E2 sentence rule: which runners "got it right" (dialed only?), and which
   groups enter each clause (tights 3/14 and gloves 2/6 are omitted on two
   frames). Absent when nobody dialed?
3. Closet tile with no verdicts / no runs, and 0 mi: what the record line says
   (the picker draws NO RUNS YET). Guess: `NO RUNS YET`, mileage absent at 0.
4. Rail band history empty: guess DS2's "No runs in this band yet."
5. Board C brackets one range (`[38–46°]`) and not another (`62–78°`). Guess:
   keep today's bracketed range on every tile.

## Register changes for the coordinator

- On merge: PR#168-1, PR#113-1, PR#101-3 (photo/record/mileage) done;
  PR#102-1 done or split per Q1/Q2.
