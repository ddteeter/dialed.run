# 119 · Composition conformance

Diff the built screen against the artboard, mechanically.

## Why

The unit suite checks **values** — type steps, the mono ramp, colour
contrast, motion durations, the icon manifest — against the contracts in
`design/`, and the architecture tests check **rules**: 44px targets, focus
never removed, routes stay glue. Between them they are about 3,500
assertions and they were all green through four composition defects on one
control in a single day:

1. the verdict laid out as a vertical stack where round 17 ruled one row;
2. "Dialed" floating off its neighbours' first baseline — true of round
   18's board, and reversed by round 19 (see "Compare, don't assert" below);
3. the brackets stacking as rows of their own;
4. then the brackets splitting across a wrapping label.

None of those is a value or a rule. They are **composition** — what sits
where — and nothing checked it. The `ui` vitest project runs in happy-dom,
which parses CSS and lays nothing out, so every rect there is zero and
"one row" is not a question it can answer. The class strings were exactly
as intended.

Two of the four were found by the owner watching a demo video. That does
not scale, and it is the most expensive possible review surface.

## The opportunity

**The artboards are HTML.** A design spec that is a picture can only be
compared by eye; one that is a document can be rendered, measured and
diffed. Round 18's packet made them properly machine-readable:

- `data-screen-label` on 116 screens (already there);
- `data-annotation` on 187 captions and commentary, so a screen's own copy
  can be read without the notes _about_ that copy;
- `data-part` naming regions — `status-bar`, `tab-bar` mechanically, and
  A3's `header`/`verdict-row`/`flag-chips`/`noted`/`share-toggle`/`submit`,
  A2's `most-likely`/`kit-list`, Closet's `top-bar`/`rail` by hand;
- wrappers at 390px, the device width, where they had been 380.

This repo already spelled the region idea `data-slot`, and `top-bar` and
`tab-bar` matched design's names for free.

## What it compares

Relations, never pixels.

| dimension             | how                                                |
| --------------------- | -------------------------------------------------- |
| Which cells, in order | each region child's text, walked node by node      |
| One band or a stack   | text leaves grouped into rows by top edge          |
| Colour                | computed `rgb()` mapped back to a **T1 role name** |

The colour mapping is the part worth keeping in mind. The boards are a
prototype and style with raw hex — 8,728 declarations of it; the app
compiles to `var(--role)`. Both resolve to the same hex, so `Theme.dc.html`'s
own T1 table turns each side back into a role and a difference reads
"board `--action`, app `--ink`" rather than two six-digit numbers.
Measured before building: **93% of colour uses inside the boards' screen
frames already map to a T1 role**, so this works today without asking
design to restyle anything.

### Why not screenshots

Pixel diffing is the obvious answer and it is the wrong one here.

- It pins whatever shipped. It would have baselined the verdict stack as
  correct, which is the bug this exists because of.
- The board's data is invented ("SAT AUG 29", "6.2 AT 41°") where ours is
  real, so most of the frame is noise.
- It fails as a red blob. This fails as two lists of strings and the row
  that differs.

Three webfont families, real motion and dynamic data would also make
stable baselines a permanent tax.

## Two things that are easy to get wrong

**Fonts.** The boards `<link>` Google Fonts and the app self-hosts, so in
CI the board falls back to a system face. Different metrics mean different
wrap points, and the signature would report a composition difference that
is really a font that did not load. `openBoard` injects the app's own
`fonts.css` pointed at its `/fonts`, and waits on `document.fonts`.

**Cells, not rows.** Grouping text by top edge reads a wrapped cell as two
rows, and flattening those back out is row-major: a board whose cells wrap
("WAY" / "COLD") against an app whose cells do not produces
`WAY A BIT DIALED A BIT WAY COLD COLD` versus `WAY COLD A BIT COLD`. Same
composition, scrambled by a fold. A cell's text does not care where it
folded. Rows stay for the one question they genuinely answer — is this one
band or a stack.

## Compare, don't assert

The harness's own first finding went stale inside a day, and the way it
went stale is the lesson.

Round 18 drew the Dialed cell with two lines — "DIALED" and "7 IN BAND" —
so the board's centring put Dialed's first line level with its
neighbours'. The build's one-line Dialed, centred, sat lower; the diff
showed it; the fix was `justify-start`, and the spec gained an assertion:
_"every label starts on the band's first row."_

Round 19 moved the count out of the cell. Dialed became one line, and the
board still centres — so on the current board Dialed sits mid-cell. The
assertion kept passing against the top-aligned build, because it encoded
round 18's _consequence_ rather than reading the board. The owner caught
it watching a demo.

So a spec asserts a rule only where the rule is design's own words. Where
it is a measurement of the drawing — alignment, order, which row a thing
lands on — the spec reads the board's value and compares. `alignmentsOf`
classifies each cell `top` / `centre` / `bottom` on both sides, and
against the old build reports exactly the one cell that moved.

## Known gaps

A harness with no way to record a real difference gets deleted: either the
check stays red until someone stops reading it, or a feature gets built
inside a testing PR. Neither. A known gap maps a drawn cell to what we
currently draw, with the register entry that owns it — and the test asserts
each gap is **still** a gap, so closing one fails the test and tells you to
delete the line. It is enumerated and countable, which is what separates it
from a suppression.

The first screen through found two, and both were resolved by design in
round 19 rather than by us:

- **D-97** — the board's dialed cell read "DIALED 7 IN BAND" and ours
  "DIALED". Design moved the count to a line beneath the row, never inside
  a cell. The gap's own check failed with _"DIALED 7 IN BAND is no longer
  drawn — delete its KNOWN_GAPS entry"_, and it was deleted: the mechanism
  doing exactly what it was for. What remains (the line itself) is outside
  any region and stays in the register.
- **D-98** — the chosen cell wore `--ink` where the board drew `--action`,
  and the backlog that mirrors it filled by hue. Design ruled the fill is
  the verdict's T2 hue on both. That made the colour axis live: the spec
  now chooses the cell the board has chosen and compares fills as T1 roles,
  and against the old code it reports `- "--dialed-text"` / `+ "--ink"`.

With no gaps left on A3 the map was removed rather than kept empty; an
unused mechanism is dead code. It returns as a support helper with the
first screen that needs one.

## Unbuilt regions

Round 19 added `data-status="unbuilt"` on seven regions design knows we
have not built — DS1's primary and rail, D's try-kit, part of E1. The
extractor rejects those subtrees the way it rejects `data-annotation`, so
the harness skips them by design's word rather than by a list kept here.

## Scope

One screen — A3's verdict row. The harness is the deliverable; screens are
incremental from here, and design offered to name regions on the ones we
diff next rather than guessing at all ~60. The order that follows the v1
loop is A1, A2, C, D, E1, then DS1 and DS2.

## What it does not do

It will not judge aesthetics, compare photography, or fingerprint a screen
whose data we cannot reproduce. Where design deliberately gave us a
fallback — Closet's rail, "ships whole or one column" — the divergence is
correct and needs a per-screen note. That review cost is real and one-time.
