# Task 121 — Logging: A1, A2, A3, DS2, runs, Strava

Lane 1 of 4 building to rounds 21–23. Read
`121-124-build-to-rounds-21-23.md` first: it holds the rules every lane
shares.

## You own

- `src/modules/runs/**`, `src/routes/runs/**`
- In `src/modules/feed/`: `components/AttachKit.tsx`, `VerdictForm.tsx`,
  `VerdictChips.tsx`, `SpecificsSheet.tsx`, `NotedReceipt.tsx`,
  `BandHistory.tsx`, and `chips.ts`, `band-signals.ts`. Lane 123 owns the rest
  of `modules/feed`; `entries.ts` and `functions.ts` are shared, so keep your
  changes there to additions.
- `src/routes/feed/attach.$runId.tsx`, `src/routes/feed/verdict.$entryId.tsx`
- `e2e/run-logging/`, `e2e/verdict/`, `e2e/conformance/a3-*`

## Screens and what changes

**A1 · upload** (Product Screens A1; Round 22 `#a1`: "A1 Parse failed",
"A1 Duplicate").

- `/runs/import/$id` goes. A1 never navigates while parsing. Pending is the
  drop zone's own `[ Reading {file} ]`. Done is the parsed card, in place.
  Parse failed and duplicate are drawn. Stalled (over 20s) is the form failure
  band: "Our end is slow. Your file is fine." + Try again. The old URL
  redirects to A1.
- Round 20's REPLACE and the run-time correction on the parsed card.

**Run detail and the runs list** (Round 22 `#r`: "R Runs list", "R Run before
kit").

- The manual-temperature form goes, for one row: "No conditions · Set
  conditions ›", which opens R2b. The runner picks from what R2b offers and
  never types a number; weather that arrived is never editable.
- Draw the list's status badges and empty state as the frame does.
- D-102: manual entry lands on picking the outfit (R1: "Next · pick the
  outfit"), not on run detail.

**A2 · attach kit** (Product Screens A2, A2b; Round 22 `#a2`: "A2 Waiting",
"A2 No suggestion").

- The picker is inline at once; only most-likely waits. No suggestion is one
  line, never an empty card.
- Round 20: the kit is required, with the count in the header. The "ALL ›"
  and "+ CATEGORY" controls open A2b as a sheet. "Attach" never changes its
  label — pressing it with nothing chosen marks the picker with "Pick at
  least one piece." (D-102: the round-13 "Attach 0 items" is superseded).
- A failed attach is `useControlAction` with `NOTHING ATTACHED`, not a pink
  line.
- Round 20 moves the outfit photo from A3 to A2: the `FileWell` with
  `photoBlurStep`.

**A3 · verdict** (Product Screens A3; Round 21: "A3 Before verdict", "A3b
Anything specific", "A3 Noted, nothing moved").

- MORE › leaves with share and submit when Noted lands. The chips stay,
  read-only; chosen ones are still inked, with no ✕.
- A garment needs ≥2 runs in the band to count as "weakest" (`chips.ts`,
  assumption 1).
- Nothing to note is a receipt, not navigation. No band: "Logged. No weather
  came with this run, so no band record moved." No kit: "Logged. No kit on
  this run, so no garment record moved." A3 never navigates.
- Chips are drawn at 32px, with a `::before` at `inset: -6px 0` making the
  target 44, and a group gap of `12px 7px`. This applies to A3 and A3b's tags
  only.
- The run header: date · time in the run's zone (from #95), and "6.2 AT 41°".
- The photo block leaves A3 (see A2).

**DS2 · verdict backlog** (Desktop Contract DS2; Round 22 item 18 ruling).

- A failed row keeps its place and its choice, with a failure band spanning
  the row and Try again inside it (`ControlFailureBand` inside the row).
- Clearing the last row shows "[ ALL LOGGED ]" and the bar's count goes.
- A row with no conditions gets the rail sentence "No weather on this run."
  A verdict is still allowed.
- Between 720 and 1039 there is no table: A3, one run at a time, in the
  panel.
- Round 20: "Same as …?" and "No usual kit here · Pick".

**Strava** (Remaining T1–T3; Round 22 item 23 ruling).

- The OAuth return is a panel receipt. Connected: "Strava connected. New runs
  arrive on their own." + Continue. Not connected: "Strava isn't connected.
  Nothing changed." + Try again / Not now. Not configured: the row and button
  are absent.
- Disconnect confirms, as T3b draws it.
- Connect and disconnect failures use `NOT CONNECTED` / `STILL CONNECTED`.

## Conformance specs

- **Extend** `a3-verdict.conformance.spec.ts` to cover the three round-21
  states.
- **Add specs** for A1 (rest, parse failed, duplicate), A2 (waiting, no
  suggestion) and "R Run before kit".

## Demos

- `e2e/run-logging/` and `e2e/verdict/`.
- The verdict demo loses its A3 photo beat, which moves to A2.
