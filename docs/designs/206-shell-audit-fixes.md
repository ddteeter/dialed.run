# Design: 206 Shell and shared-UI fixes from the styling audit

## Problem

The 2026-11 styling audit found defects in the shared shell and `src/ui`
primitives (#632, with the `src/ui` findings traded in from #627 and #628).
They show on most screens: the bell rides high in the desk bar, the footer's
gaps are uneven, tabs don't light on pages they hold, and pending labels
throw their brackets around. None of them needs a design answer; anything
Round 54 (Design 164–170) decides is left alone.

## Approach

Fix each finding once, where it starts. Round 54 then added two rulings to
this lane: Design 169 (#623) and Design 165 (#619).

- **Design 169: the bell joins each screen's first row.**
  - `Layout` drops the phone's empty bell row and provides the bell to a
    `PhoneBell` seat (`src/ui/PhoneBell.tsx`).
  - `Page` seats it at the end of the title row, after `headingAction`. A
    new `back` slot puts a sub-page's back link above the title, with the
    bell in its row.
  - Screens that draw their own first row seat it themselves:
    notifications, the Call, A1, the backlog, the closet, X1 and X2.
  - The closet routes gain the bell. `garmentLoader` reads it after the
    session gate.
  - Feed's seven screens are 7d's to seat.
- **Design 165: the dark phone sheet.**
  - Below 720 in dark, a sheet takes `ground-sheet`: `--panel`, a hairline
    over the top and sides, and a 36×4 grabber in `--hairline-2`.
  - Two stacked sheets mark themselves. The lower one stays at least 48
    taller than the upper, and the upper's edge is `--hairline-2`.
  - Headings in ConfirmSheet and DeleteAccount are `text-title`. Both
    themes is a guess until Design 173 (#643).

- **Bell** (A-08, B-03, E1-10, F-06, D1-17, E2-11, G-23).
  `NotificationBell` centres its glyph in its 44 target. The count or dot
  moves from beside the glyph to an absolutely placed mark on its corner.
- **Footer** (A-03, B-14). The gaps come from padding, not `gap-x`. Every
  link is wider than 44px, so `target`'s `min-width` stops padding "Terms"
  alone. The phone still wraps, and each line stays 44 high (the target
  rule). 7d copies the fix to `PublicFrame`.
- **Tabs** (B-04, D1-19). You also holds `/account/*` settings pages and
  `/runs` (round 22 boards R list and run detail light YOU).
- **404** (A-04). "404" becomes a muted `MONO.xs` kicker, and the way out
  becomes a hairline pill, matching board X1.
- **Blocked runners** (B-02). The route wears `BelledLayout` and gets a
  "‹ Settings" back link, like the other settings sub-pages.
- **FailureBand** (A-07, #628 E1-16c). Try again is a pill.
- **PendingLabel** (P2a-03, B-09; the primitive half of E1-07 and N2-09).
  The pending layer is inline text, so a wrap keeps `]` after the last
  word. A new `align` prop (start, center or end; default center) lets a
  left- or right-set control sit flush. Call sites in other lanes opt in.
- **Dark top bar** (R-01). On a dark page the bar draws only its bottom
  hairline, not the four-sided ring.
- **Option labels** (R-02). A `Mono` option label resets to regular
  weight, matching the Theme chips.
- **Notifications** (#628 N2-01). A linked row's words keep the 44px hit
  area without growing the row, so the dot and time sit as they do on a
  plain row.
- **Night ground** (#627 P3-02). `[data-ground="night"]` sets
  `color-scheme: dark`, so native pickers draw light icons on the Desk.
- **ListSection** (#627 G-13, src/ui half). The section kicker is muted.

## Contract touches

- Schema changes needed: **none**
- New route files: none (`src/routes/safety/blocked.tsx` edited)
- New bindings/queues/crons: **none**
- Screens: shell (DS1 bar, phone bell row, signed-out footer), X1, W2.

## Test plan

- `test/ui/tabs.test.ts` (vitest): `/account/sign-in`, `/account/username`,
  `/runs` and `/runs/:id` light You, while `/runs/new` still follows the
  log flow.
- `NotificationBell` dom test (vitest ui): the link centres its glyph, and
  the mark is a corner overlay.
- `PendingLabel` dom tests: the `align` classes, and a pending layer that is
  not a flex row.
- `SystemState`, `FailureBand`, `OptionLabel`, `Layout` footer and
  `ListSection` dom tests: the new classes.
- Before and after captures at 390 and 1280, light and dark, for every
  finding: a throwaway spec, not committed.

## Issues

- Closes: #632 (except the parts handed to 7d and Round 54, listed on the
  issue), #619, #623.
- Refs: #627, #628 (findings ticked "done in 7b").

## Open questions

- Sheet headings at TYPE.title in both themes is a guess; Design 173
  (#643) decides.
- X2 (loader failed) has no first row of its own, so it gets one for the
  bell above the band. This is a guess.
- The footer's 44px lines on a phone are the target rule, not a defect. Only
  the gaps change.
