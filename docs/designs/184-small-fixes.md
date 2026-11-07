# Design: 184 Small fixes (wave 3)

## Problem

Seven small owner- or Design-answered items. Each issue body carries its
ruling, so this doc says only how each is built. #427 ships first, alone,
because the dark-theme lane rebases onto it before touching onboarding.

## Approach

- **#427 · R49·138, onboarding at desk width (PR 1).**
  - `Page` gains a `step` width: the panel below 1040, and from 1040 up
    left-aligned at a desk measure (`mx-auto max-w-panel desk:mx-0
    desk:max-w-column`). P3 takes `close`: the same, but unbounded at desk,
    so its band runs the full column and `NowGoRun` bounds its own body.
  - `ui/OnboardingShell`: the `<main>` the five steps already render, inside
    the page measure, under a wordmark-only bar shown only from 1040
    (`hidden desk:block`). Below 1040 nothing is added.
  - P3 goes light: the hi-viz band (bar + "Now go run.") is the one
    emphasis; the body sits on `--ground`, promises split by `--hairline`,
    Strava offer in the `--panel` inset. The kicker and numbers drop to
    muted, since the band is the only emphasis.
- **#442 · prefill on the worst hour.** `prefill.ts` compares
  `judgedFeelsLikeC` of each candidate with the target's, not the
  starting hour's `feelsLikeC`.
- **#385 · http:// accepted.** `httpsUrlSchema` transforms an explicit
  `http:` URL to `https:`; `httpsUrlProblem` errors only on a non-URL (and
  on a scheme that is neither).
- **#486 · kit caption cut.** Drop `caption` from `submitVerdictInput`, the
  entry write, the feed/profile/public-kit reads, the `/kit` view and the
  OG description. The column stays (D-167).
- **#363 · R-84.** `ToggleField` gains a `role="switch"` mode used by W3's
  blur toggle; `VerdictForm`'s five buttons become a `radiogroup` of
  `radio`s with roving tabindex, arrow keys move, space selects.
- **#406 · R47·123.** An unconfirmed runner's `AudiencePicker` stays at
  PRIVATE; SHARED/PUBLIC open #17's sheet without moving the selection,
  focus returns to the pressed option, and round 27's line sits under the
  group via `aria-describedby`.
- **#412 · R49·137.** The E2-lite sentence names garment types in tiers
  (All → Most → Some), ≤3 per clause, serial comma, no category fallback.
- **#482 (if time).** Machine paths and the owner's name out of docs.

## Contract touches

- Schema changes needed: **none** (the caption column stays).
- New route files: none. Onboarding routes swap `<main>` for the shell.
- New bindings/queues/crons: **none**.
- Screens: O0, O1, O3, P2.5, P3 (R49·138), A3 (R47·123, R-84), W3 (R-84),
  E2-lite (R49·137).

## Test plan

- `page.dom`: `step` and `close` widths (unit). `onboarding-shell.dom`: bar
  is desk-only and wordmark-only (unit). `now-go-run.dom`: band holds the
  steps and heading, body carries no ink ground (unit).
- `prefill` worker test: a run whose worst hour matches beats one whose
  start matches (integration).
- `common` contract test: http upgraded, non-URL refused (unit).
- Feed tests: caption rejected on input, absent from reads and `/kit`.
- `form.dom` switch role; `verdict-form.dom` radiogroup + arrows; A3
  unconfirmed hold (unit); sentence-builder table tests (unit).

## Issues

- Closes: #427 (PR 1); #442, #385, #486, #363, #406, #412, and #482 if
  reached (PR 2).
- Opens: #487 (design ask: the 560 measure).

## Open questions

- **560 is not in `MEASURE`** (tokens.js: "Nothing pins a width that isn't
  in MEASURE"). Guess: the contract wins, so desk content uses
  `MEASURE.column` (620). Design ask #487.
- **P3's primary** is drawn as the ink pill but labelled "as built". Kept
  as built (pink action pill): pink is action, and copy/order are
  unchanged.
