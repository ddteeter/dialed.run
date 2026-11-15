# Design: 219 Runs and closet: the styling-audit re-run's fixes (wave 10, lane 10c)

## Problem

The styling-audit re-run (#666) left eight built-wrong findings in runs,
the backlog, manual entry and attach (#704) and eight in the closet
(#699). Each is confirmed against a fresh capture from main `1d1c2b4d`
before it is fixed. If a finding is already right on main, the PR says so.

## Approach

**Runs** (`src/modules/runs/**`, and for A2/A3 `src/modules/feed/components/`
`KitPicker`, `VerdictForm` and `band-runs.ts`, lent to this lane by the coordinator, 2026-11-14):

- **Backlog conditions (R2-RUNS-04):** a band the runner set reads as the
  list draws it, `SET · 42–51° · DRY` in the label colour, never the stored
  middle, the storage word or a zero wind.
- **Backlog desk (R2-RUNS-05):** the table is one `--panel` card with a
  hairline edge. The five segments are equal columns. Eight rows, then
  "Show N more". Distances are spaced (`10.0 MI`).
- **Manual entry (R2-RUNS-06):** the route loads the viewer's units. The
  field is "Distance (mi)" or "Distance (km)" and converts by that unit,
  through `metresPer`, now exported from `lib/contracts/measures.ts`.
- **Runs list row (R2-RUNS-02):** the distance and the SET badge never
  shrink, and the Garmin credit is never cut (Garmin Rulings 77). When the
  row is too narrow, the credit takes its own line, as on the feed card.
  **Guess**, pending Design 314 (#760, coordinator, 2026-11-14).
- **T1 (R2-RUNS-07):** with one run, "Your run, its outfit and verdict"
  (owner, 2026-11-14, on #704).
- **A1 slot (R2-RUNS-08):** the waiting slot reserves the block's resting
  height plus an unseen copy of the note the block will carry, so the
  primary doesn't move.
- **A3 and band cards (P2a-02):** a zone-less run falls back to the
  runner's home zone, as the list does.
- **A2 tiles (R2-RUNS-03):** a long word breaks inside the tile rather
  than being cut. The hatch word is the piece's type.

**Closet** (`src/modules/closet/**`):

- **WORKS AT (R2-CLOSET-01, C-14):** the header holds, unseen, the widest
  value it can show for this closet's span, plus Clear. Setting a range
  then widens nothing. An open end reads as FILTERED does (`61°F+`,
  `under 58°F`). At a bound, a thumb's 24 spread goes inward, never past
  the track.
- **Already in your closet (R2-CLOSET-02, -03):** the name and meta are
  one line each and truncate. The tag is RETIRED (Round 56 · 248), and
  SAME NAME stays (round 28 #13; 248 draws no same-name row). The closing
  link is pink at 700 and full width, under a full-width hairline. The
  card fill is `RailCard` (`src/ui/DeskSplit.tsx`, lent by the
  coordinator), and it is filled only if A1–A3's boards draw their rail
  cards filled.
- **Rail rows (R2-CLOSET-04):** the swatch and the word share a gap. The
  label cell starts at the left, so pressing a row doesn't move it.
- **Chip count (R2-CLOSET-08):** a chosen chip's count takes the chip's
  text colour.
- **Piece page (N1-04, N1-10):** `[UNTESTED]` only when the piece has no
  verdicts. The label credit sits tight under the composition.

## Contract touches

- Schema changes: **none**. New route files: **none**. Bindings: **none**.
- Screens: S1 backlog, R1, runs list, T1, A1, A2, A3, C, F, F-detail.

## Test plan

- `ui` dom tests per changed state: the backlog's set-band line, its card,
  equal segments and Show more; R1's unit label and conversion; the row's
  classes; T1's singular; the slot's note copy; A3's and the band card's
  home-zone dates; the tile hatch word; WORKS AT's reserved width, open
  ends and thumb shifts; the rail card row, tag and link; the rail row's
  gap; the chip count; the piece page's tag.
- No new e2e journey. The existing runs, closet and attach specs run in the CI-style e2e.

## Issues

- Closes: #704, #699.
- Opens: whatever is found or deferred, listed in the PR.

## Open questions

- R2-RUNS-02 is built on the guess above until Design 314 (#760) rules.
