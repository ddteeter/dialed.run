# Design: 204 dark ink blocks

## Problem

Round 50 ruled three dark-theme items. On a dark page an ink block inverts to
paper (T2 rule 04), which makes it the brightest thing on the screen; R50·143.1
moves every one to rule 04's own fallback, `--panel` with a 1px `--hairline`.
The Theme row's labels are sentence case where every other segmented label is
MONO.xs capitals (143.3). And R50·142 turns the two contrast misses on the dark
unread tint into a rule: `--cold-text` and `--label` never sit on `--unread`.

## Approach

- **143.1, in `src/ui/tokens.css` only.** Every ink block (top bar, auth's
  session notice, CallLadder's header and band, ConditionsBlock, ParsedCard's
  fetching block, the A2/A3 headers below `wide`) paints `bg-ground` and takes
  its column from `data-ground`. So the dark page's two
  `[data-ground="ink"|"ink-until-wide"]` rules stop applying `ground-paper`
  and apply a new `ground-panel` utility instead: `--ground: var(--panel)` and
  an inset 1px `--hairline` ring (no layout shift, the way notices draw their
  rule). The block keeps the page's dark column, so its roles need no second
  copy. `ink-until-wide` takes it below `wide` only, as now. The Desk
  (`night`) is untouched. `.row-press:active` is a press state, not a block,
  and keeps inverting to paper. No component file changes.
- **143.1, NowGoRun.** Already has no ink (band `bg-failure`, body
  `bg-panel`); confirmed, nothing to change.
- **Item 7, `--hiviz-text`.** With no block turning paper, the eyebrows that
  use it (auth's "You were signed out", CallLadder's "Log this next") sit on
  the dark column in both themes: hi-viz `#F5FF3D` on ink (17.6:1, light page)
  and on `--panel` `#16161B` (16.5:1, dark page). The paper column's `--ink`
  value stays, as T1's note ("never text on paper") and as the light page's
  answer outside a block.
- **143.3.** `ChoiceList` gains an opt-in `optionStep` that sets each option's
  words in `Mono` at that step; ThemeSwitch passes `"xs"`. `THEME_LABELS`
  stays "System" / "Light" / "Dark", so the drawn capitals are CSS and the
  spoken names are sentence case (Accessibility Contract, round 52). Needs
  `src/ui/form.tsx` (asked of the coordinator).
- **143.5.** CoverageMarks are already `--ink`. `WorksAt`'s [Untested] is
  `text-muted`, which resolves to `#8B8B93` on the dark page; pinned.
- **142.** `contrast.dom.test.tsx` drops `DARK_MISSES` and the recorded
  ratios for a `FORBIDDEN_ON_UNREAD` set stated for both columns, and a scan
  that no source file drawing `bg-unread` also draws `text-cold-text` or
  `text-label`. Today nothing draws `bg-unread` (the bell's unread row is a
  white row with a pink dot), so there is no current finding.

## Contract touches

- Schema changes needed: **none**
- New route files: none
- New bindings/queues/crons: **none**
- Screens: every screen with an ink block, on dark; U1's Theme row.

## Test plan

- `test/ui/contrast.dom.test.tsx` (vitest): the dark page's ink blocks apply
  `ground-panel`, never `ground-paper`; `ground-panel` is `--panel` with a
  `--hairline` ring; night still applies `ground-ink`; the forbidden pairs in
  both columns; the `bg-unread` scan.
- `test/ui/theme-switch.dom.test.tsx` (vitest): each option's words are
  MONO.xs (uppercase class) and its accessible name is sentence case.
- `test/ui/form.dom.test.tsx` (vitest): `optionStep` wraps the label in
  `Mono`; omitted, the label stays a bare string.
- A WorksAt dom test: [Untested] carries `text-muted`, and `--muted` is
  `#8B8B93` in the dark column.
- No new Playwright spec: values are the contracts' job. Transcripts and
  conformance are re-run; the Theme row's transcript should not change.

## Issues

Closes #488, #494.
