# Design: 120 Shared controls and the photo well

## Problem

Rounds 21–23 rule three things that many screens share. Four lanes (121–124)
are about to rebuild those screens in parallel, and built separately each lane
would ship its own copy. So they land first, alone:

1. **Garment photos skip W3's blur.** `PhotoBlur` is mounted only on the verdict
   route; garment detail uploads the picked bytes as they are. It is a privacy
   gap (D-102), and the shared photo well is where it gets closed.
2. **One photo well** (round 22, item 8), for A1's run file and every photo.
   Rest, drag-over, uploading, the field-message error, and — with a photo —
   the well _is_ the preview, with Replace and Remove under it.
3. **One failure pattern for a control** (round 23, item 9). Useful, Follow,
   Unblock, Attach, Strava and DS2 rows each fail differently today — pink
   lines, silent snap-backs, an optimistic count that reverses.

## Approach

- **`ui/photo-step.ts`** — the `PhotoStep` type (a render slot for W3's step)
  moves out of `VerdictForm` so closet can take the same slot. `GarmentDetail`
  holds a picked file until the step hands back the bytes; the route passes
  `PhotoBlur`. `GarmentDetail` gains its screen's one status region for the
  step's sentences (Accessibility Contract rule 08).
- **`ui/FileWell`** — rebuilt to the round-22 anatomy. New props: `kicker`,
  `wideLabel` (bend 1's desk title), `overLabel` (drag-over title), `preview`
  (`{ src, alt }`) with `onRemove`. Error becomes a field message on a 2px ink
  border, never a pink line. `data-part="photo-well"` and `data-state`
  (empty / drag-over / uploading / error / filled) for the harness.
- **`ui/FailureBand`** — the band `FormFailureBand` already draws, with its
  kicker as a prop. `FormFailureBand` becomes the form's case ("Nothing
  saved"); `ControlFailureBand` is item 9's: the kicker names what is still
  true, under the control. `data-part="failure-band"`, `data-state="failed"`.
- **`ui/use-control-action.ts`** — a non-optimistic action: re-entry guard,
  `pending` for the in-flight label, `classifyFailure` for the cause line, a
  status sentence for the screen's region, retry. Counts change on success
  only.
- **The worked example: Useful on D** (`EntryDetail`), the frame round 23
  draws. Lanes adopt the rest.

## Contract touches

- Schema changes: **none**. New routes: **none**. Bindings: **none**.
- Screens: A1 (well only), E garment detail (well, blur), D (Useful). The
  well's Remove is a prop only — the closet lane adds the server function.

## Test plan

- `ui`: FileWell per state (rest/over/uploading/error/filled, Replace opens
  the input, Remove calls back); FailureBand and ControlFailureBand;
  useControlAction (guard, pending, success, each failure kind, retry).
- `ui`: GarmentDetail holds the file until the step's `onReady`.
- `ui`: EntryDetail Useful — `[ Noting ]`, count on success only, band on
  failure, no rollback.
- e2e: garment photo demo passes through the blur step.

## Open questions

- Round 22's well hint reads "JPG, PNG or HEIC"; the build accepts JPEG, PNG
  and WebP. Proceeding with the true list and raising it as a design delta.
