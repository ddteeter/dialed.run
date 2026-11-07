# Design: 185 Dark theme (task 111)

## Problem

Round 8 drew every screen dark and nothing in the app has a dark mode.
Round 48 settled what was open (R48·133–136): a Theme row in U1, T1's dark
column per role, a derivation rule for screens with no dark frame, and the
OG card and Desk left alone. This lane ships it, with R-36 (forms on ink),
R-79 (pressed-row metadata) and R-87 (unread in an inverted block).

## Approach

**Tokens, one copy of each column** (`src/ui/tokens.css`). The light roles
move into `@utility ground-paper` and the dark roles stay in `ground-ink`
(gaining `--unread #2A2A14`, R-87). Then:

| selector                                                                                             | gets                                                          |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `:root`                                                                                              | paper, `color-scheme: light`                                  |
| `:root[data-theme="dark"]`, and under `prefers-color-scheme: dark` `:root:not([data-theme="light"])` | ink, `color-scheme: dark`                                     |
| `[data-ground="ink"]`, `-until-wide`, `.row-press:active` (R-79)                                     | the **opposite** of the page (T2 rule 04: headers invert too) |
| `[data-ground="night"]` (new)                                                                        | ink in both themes                                            |

`night` is for what T3 says is dark for everyone: the Desk (`DeskShell`).
NowGoRun's ink block went with R49·138b (P3's body is on the page's ground),
so its hi-viz band and bar take `--accent-ink` instead. The OG card and email already use fixed palettes
(`ops/og/palette.ts`, `email/palette.ts`) and are untouched. Coverage marks
(`ink.css`) switch from `--night-run` to `--ink` (T2 rule 03: coverage
inverts). `.row-press:active` paints `--ground`/`--ink` after it takes the
inverted roles, since inside it `--ink` is already the flipped value.

**The preference.** `user_profiles.theme` text enum `system | light | dark`,
not null, default `system` (D-139, pre-launch). Device cache in
`lib/browser/theme.ts`: one localStorage key, an inline head script (with the
request nonce, like `ZOD_JITLESS_SCRIPT`) that sets `data-theme` before first
paint, and `applyTheme()`. `system` means no attribute, so the media query
does the following and no listener is needed. Switching is a cut (T3).

**Sync.** The root loader's answer carries the signed-in runner's theme
(one PK read on `user_profiles`). A root `ThemeSync` applies and caches it
when signed in and clears the cache when signed out (R48·133: signed out is
always system; on sign-in the account's value takes over). On open-web paths
the root does not ask, so the sync leaves the device cache alone.

**U1 row.** A DISPLAY group after Review (which holds Notifications), before
Data: `ThemeSwitch` — a three-way radiogroup with arrow keys, SYSTEM / LIGHT
/ DARK, applies and saves at once, message band "Couldn't save. This device
will keep it." on failure. The server half is `modules/account` (`theme.ts`

- a server fn); `Settings.tsx` only slots it. Onboarding files wait until
  #427 merges.

**Surfaces (R48·135).** Every primitive in `src/ui` against T1; forms' ink
surface gets the 2px `--ink` border (R-36) wherever the page or block is
dark; light-ground notices become `--panel` + 1px `--hairline` on dark;
photos undimmed; wordmark brackets stay `--action`. Google's button already
reads `data-theme` (`google-button.tsx`). Marketing (`/`, signed out) follows
the system by construction.

## Contract touches

- Schema: `user_profiles.theme` (pre-approved destructive window D-139;
  additive anyway). Migration renumbered if corrections-desk merges first.
- Routes: `__root.tsx` (head script, sync), `account/$section.tsx` or the
  settings route (wire the save fn). No new route files.
- Bindings/queues/crons: **none**.
- Screens: U1 (DISPLAY · Theme), every screen's dark variant via T1.

## Test plan

- ui: `contrast.dom.test.tsx` — the dark set equals T1's whole dark column;
  every body-text pair clears 4.5:1 on the dark grounds (R48·134's build
  check); failures become design-asks, not skips.
- ui: `tokens.dom.test.tsx` — selector shape (both dark entries, inverted
  flips back on dark, `night` fixed, `row-press:active` inverted).
- ui: `theme.dom.test.tsx` — head script / `applyTheme` / cache, storage
  refused; `ThemeSwitch` arrow keys, save-at-once, failure band.
- worker: theme read/write, zod at the boundary, root answer carries it.
- e2e: U1 switch flips `data-theme` and survives reload; Desk stays dark.

## Issues

- Closes: #361, #470, #469, #468.
- Opens: #488 (two dark pairings on `--unread` under 4.5:1), #494 (what
  was built on a reading of R48 and T1–T3).

## Open questions

- Guess: every existing `data-ground="ink"` block inverts to paper on dark (T2 rule 04, literally). If a block reads
  too loud, the fallback is `--panel` + hairline (rule 04's own words).
- Guess: T3's You-tab header switch is superseded by R48·133's U1 row.
