# Design: 212 Closet and runs: audit fixes and Round 55 builds (wave 8, lane 8d)

## Problem

The 2026-11 styling audit found the closet (#626) and runs, upload, manual
entry, attach and verdict (#631) drawn differently from their boards.
Round 55 then drew or ruled the open questions in those areas (#634, #639),
and Round 54 settled two layout calls: A2b/A3b push at desk (164.3, #618)
and the closet's exceptions to the 620 column (168.2, #622). Each audit
finding is confirmed against a fresh capture before it is fixed. A finding
that a ruling changes is built to the ruling.

## Approach

**Closet** (`src/modules/closet/**`, `src/routes/closet/**`):

- **Grid (C-01, N1-01, 187, 188, 189):** two tracks on the phone at every
  count, and `auto-fill, minmax(180px,1fr)` from `wide`. The well is square.
  A photo-less tile shows the hatch with its category word (TYPE.heading,
  `--muted`) and keeps its pills. Names clamp to two lines and two lines
  are always reserved. The full name stays the link's name. The record
  line carries the mileage ("3/17 DIALED · 109 MI") and the range slot
  goes. Add follows the last tile when the row has room. When the count
  fills the row, Add is one 56-tall dashed row, "+ Add a piece".
  `auto-rows-fr` goes.
- **List page (168.2, C-09, C-10, C-11, C-13, N1-05):** the grid sits on
  MEASURE.page, centred. The phone gutter is 16, per 185. The rail and
  grid use a fixed rail track, so a bold choice doesn't move the grid.
  With no pieces, the empty state takes the content column. The nudge
  counts the pieces shown, in sans.
- **WORKS AT (C-14, 192):** the header row reads WORKS AT, then the value
  and Clear at the right ("ANY" unset). Thumbs sit at least 24 apart. The
  readout keeps exact values, and a lower bound alone reads `61°+`.
- **Garment detail (C-05, C-06, N1-08, C-17, N1-06, N1-09, 191):** WRONG? ›
  left-aligned on the AS LABELLED BY line. One hairline between stats and
  actions. Mileage in the runner's unit, hidden at zero, as on the tile.
  The kicker drops the type when it repeats the category. The swatch edge
  is `--hairline-2`.
- **Form (190, 193, 168.2):** the title is "Add a garment" / "Edit {name}"
  at TYPE.title, and "What is it?" takes the group rule. At ≥1040 the 620
  form sits at the page's left with "Already in your closet" as a rail in
  the rest of 1180. Below that, the rail drops under the form. The card
  lists in-use pieces first (most worn first), then retired, five shown,
  closing on "+ N more {type}" to the filtered closet. RETIRED appears
  once, as a tag.
- **Delete (C-15):** a fixed label column for GOES/STAYS.
- **Photo well (C-04, N1-07):** `src/ui/FileWell.tsx` clips the photo to
  the well's rounded 4:3 frame at every width, so a square or portrait
  photo is contained rather than stretching the well (coordinator,
  2026-11-13: this lane's).
- **Not-found (185):** "That piece isn't in your closet. It may have been
  deleted." → Go to your closet, in the screen's own column.

**Runs** (`src/modules/runs/**`, `src/routes/runs/**`):

- **Manual entry (P2a-01):** a blank Started gets "Pick when the run
  started." (the message moves to the type check in `lib/contracts/runs.ts`).
- **A1 (232, 233, 234, D1-08, D1-03, P2a-02):** the primary is "WHAT DID YOU
  WEAR?". The conditions slot keeps its size: either an outlined
  "FETCHING WEATHER" box or the ink "INDOOR · TREADMILL" block. "Wrong file?
  Tap REPLACE above." The time button doesn't stretch its row. The sky
  word uses the text role. One time zone rule (conditions zone, else
  device) for the parsed card, duplicate receipt, list and detail.
- **Runs list (235, N1-14):** month headings with counts, 64 rows, one
  mono line, marks at the right, and "THAT'S EVERY RUN · SINCE …". Strava
  reminders go on a line under the title.
- **Backlog (236 revised, 237, D1-11):** desk table on MEASURE.page with
  inline segments, and the credit once under the table. Phone cards as S1.
  The empty state is VERDICTS, [ALL LOGGED].
- **Strava (D1-15, P2a-09, 238):** the callback page wears the shell and
  R39's receipt. Connected reads as one sentence, and Disconnect is a text
  link.
- **Conditions sheet (P2a-04):** the duplicate caption goes. The visible
  title follows #643 (8a).
- **Garmin picker (P2a-05):** sans rows, and the action is centred.
- **A2/A3 (D2-01, D2-04, N1-17, D2-05, D2-12, 239–242, 164.3):** a bottom pad
  under LOG IT. The conditions chip is filled with × when on. The heading
  row is stable. 72-square picker tiles. A 76 attached-photo thumb.
  "← Back" above the title. A2's This run card matches A3's. The Garmin
  credit on A2/A3 for Garmin runs. PrivateRunLine's inline Change drops
  the 44 box's line stretch (D2-06; coordinator, 2026-11-13: this lane's).
  At desk, A2b and A3b are pages in the 620 column (back, title, meta,
  search, one card of checkboxes, Done), and the phone keeps the sheet.
  164.3's "the URL changes" is met by a search parameter on the screen's
  own route (`?pick=<group>` on A2, `?specifics` on A3), not a child
  route. The screen underneath stays mounted, so a held photo, which no
  URL can carry, and the picks survive the push (coordinator,
  2026-11-13).

The bespoke controls (ClosetGrid's Show retired, ManualRunForm's
treadmill box, VerdictForm's audience picker, KitPicker) move onto 8a's
set after #620 merges, in this PR if the timing allows.

## Contract touches

- Schema changes: **none**. The zod message move is in `lib/contracts/runs.ts`.
- New route files: **none**. A2b and A3b are search parameters on the
  A2 and A3 routes (see Approach).
- New bindings/queues/crons: **none**
- Screens: C, F, F-detail, A1, A2, A2b, A3, A3b, R1/R2a/R2b, runs list, S1
  backlog, T1/T3c. Round 54/55 deltas are the docs pass's.

## Test plan

- `ui` dom tests per component for each changed state: the grid's Add
  placement, the tile record line, the nudge count, WORKS AT's header,
  detail mileage units, the kicker, the rail order and overflow, the list's
  month groups, backlog cards and the empty state, the callback receipt,
  and the time-zone rule.
- `worker`: the manual-run schema message. `ui`: the push pages' search
  parsing (`kit-push.ts`).
- e2e: extend the existing closet, runs and attach journeys for 164.3's
  desk push and the conformance specs. No new journey.

## Issues

- Closes: #626, #631, #634, #639. #618 and #622 stay open (other lanes'
  parts).
- Opens: whatever is found or deferred, listed in the PR.

## Open questions

- None open. Ownership was settled with the coordinator on 2026-11-13.
  The sheet title is 8a's (#643), so this lane only drops the duplicate
  caption.
