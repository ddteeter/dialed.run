# Design: 213 the floating-surface lift (#652, Design 246)

## Problem

R54·164.1 gave the desk drawer "one soft lift", but no contract carried an
elevation, so wave 8 (design 209) held the board's shadow as a stand-in
`--lift`, the same in both themes. Round 56 rules it (246a–c): `--lift` is a
T1 role, light only; in dark a floating surface takes `--hairline-2` as its
edge instead; and everything that floats over the page takes it, one level.

## Approach

- `src/ui/tokens.css`: `--lift` leaves `:root` for the T1 columns.
  `ground-paper` gets `0 8px 28px color-mix(in srgb, var(--ink) 10%,
transparent)` (246a: `rgb(11 11 14 / 0.10)`, with `--ink` as the colour).
  `ground-ink` gets `none`. `ground-drawer` drops its `box-shadow`, and
  `ground-sheet`'s edge becomes `--hairline-2`.
- `src/styles.css`: `--shadow-lift: var(--lift)` in `@theme`, so the lift is
  one class, `shadow-lift`, that a floating surface types.
- `src/ui/Sheet.tsx`: the dialog takes `shadow-lift` in every state, so the
  phone sheet and the drawer both lift in light, and neither does in dark,
  where the role is `none`. At width in dark the drawer's edge steps up to
  `--hairline-2` (`wide:dark:border-hairline-2`).
- **What floats, in the build (246c):** the drawer, which is also what the
  old contracts call the centred panel (`tokens.js` RADIUS.sheet; since R54
  the at-width sheet is the drawer, top-aligned at the right), the Desk pane
  below desk (the same `Sheet`, `isModal={false}`), and the phone sheet. No
  menu and no toast exists: the account control opens a sheet (round 52
  #161), and product.md §Forms says "Never a toast". So there is nothing
  more to put on it today. Anything that floats later types `shadow-lift`
  and the dark edge.

## Contract touches

- Schema changes needed: **none**
- New route files: none
- New bindings/queues/crons: **none**
- Screens: every sheet and drawer. Design 246 (R56); tokens.js ELEVATION
  lands with the coordinator's Round 56 docs pass, not here.

## Test plan

- `test/ui/contrast.dom.test.tsx` (vitest ui): `--lift` is the light
  column's value built from `--ink`, `none` in the dark column, and absent
  from `:root`; `ground-drawer` has no shadow; `ground-sheet`'s edge is
  `--hairline-2`.
- `test/ui/sheet.dom.test.tsx` (vitest ui): the dialog carries
  `shadow-lift` and `wide:dark:border-hairline-2`.
- `test/ui/tokens.dom.test.tsx` (vitest ui): the `--shadow-*` namespace
  is cleared and `--shadow-lift` reads `var(--lift)`, so there is one lift
  and no scale.
- No computed-value test: values are the contracts' job, not a spec's
  (`.claude/rules/testing.md`). The demo video shows the four states (light
  and dark, phone and desk), and I check the built CSS once so the dark
  edge comes after `ground-drawer`'s `border` shorthand.

## Issues

- Closes: #652
- Opens: none expected

## Open questions

None left. coordinator-9 read the three guesses against 246a–c
(2026-11-13):

1. The light drawer keeps its 1px `--hairline` edge as well as the lift:
   246 rules nothing about light edges, so 164.1 stands.
2. The light phone sheet takes the lift and no edge, as on main.
3. Stacked phone sheets in dark: Design 165 stepped the upper sheet's edge
   up to `--hairline-2`. 246b gives every dark floating surface that edge,
   and 246c says "one level only", so the step is withdrawn. The
   `data-[stacked=over]` class is gone, and the 48 height offset that
   keeps both top edges visible stays.
