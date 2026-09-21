# Design: 115 Desktop

## Problem

`design/Desktop Contract.dc.html` is in v1 and nothing in `src/` has a layout
above 720 except four `wide:`/`desk:` grid columns. The doctrine is that the
phone owns the act and desktop owns the table: every logging flow stays the
phone flow in a 390 panel, and exactly one job — clearing a verdict backlog —
earns a wide layout. This lane builds the shell (DS1), the one wide layout
(DS2), and the four bends.

**Round 15 answered all five open questions** (imported in this PR: `Desktop
Contract.dc.html`, `Remaining Screens.dc.html`, `motion.js`). Search is a
**link**, not a field; no theme control in the bar until 111; the pill says
**"Log a run"** at width and `+ Add` on phone; **Feed stays one column at
desk** in v1 because two of its three rail cards are the Call; and the top
bar's underline is **static** — sliding belongs to the phone bar, whose five
equal columns make it free.

## Approach

**The bar and the tab bar are two elements, and the nav table is one.**
`data-ground="ink"` cannot be applied per-breakpoint — it is an attribute, and
the roles it redefines are inherited — so the inverted bar is `hidden
wide:flex` and `TabBar` gains `wide:hidden`. What must not be duplicated is
the *set of destinations*: `TABS`, `activeTabIndex` and `tabToLight` move out
of `TabBar.tsx` into a new pure `src/ui/tabs.ts` that both bars import, and a
test pins that the two render the same four in the same order.

- `src/ui/TopBar.tsx` — wordmark → Feed, the four links, search link, bell,
  "Log a run". `data-ground="ink"`, `bg-ground text-ink`: T2 rule 04 and the
  focus ring both fall out of `--ink` flipping, per 112's note. The bell is
  `Layout`'s existing `bell` node rendered in a second place — the S1 list
  stays the `/notifications` route, which at width *is* the centred panel, so
  D-87's unread-inside-ink trap never arises.
- `src/ui/Page.tsx` — `narrow`/`wide` become **`panel`/`column`**, DS3's own
  two answers. Panel stays centred at 390; column is left-aligned at width
  inside `max-w-page`, which is DS3's reflow rule ("not centred, so it lines
  up with the wide screens' primary column").
- `src/ui/Sheet.tsx` — at width the sheet becomes the panel: top-aligned
  SPACE[12] under the bar, 390, `rounded-sheet`, and **no scrim**
  (`wide:backdrop:bg-ground`) — DS5's "modals with scrims".
- `src/modules/runs/backlog.ts` + `components/VerdictBacklog.tsx` +
  `src/routes/runs/backlog.tsx` — DS2. Rows are read in one pass (one history
  scan shared across rows, not one per row); a row saves through the existing
  `attachKit` + `submitVerdict`, so it is A3 laid flat rather than a second
  form. Keyboard: `↑`/`↓`, `1`–`4`, `Enter`, `Tab` into the outfit cell.
  Reached from "Clear the queue ›" on Feed and from the S1 verdict prompt.
- `ClosetGrid` — filter rail left of the grid at `desk:` only.

**Bend 1** is copy plus a `drop` handler on the two file wells (`UploadForm`,
the garment photo) — the same input, the same WASM blur path, no fork.
**Bend 2 is already satisfied and its extra line is not warranted**: the built
onboarding is O1 → O3 → O4 → P3, all four at `width="panel"`. There is no O2
to skip, and once bend 1 lands "photos come from your phone" is false at
width. Recorded as a design-delta rather than invented.
**Bend 4** is DS1: `Layout`'s bell row is `wide:hidden` and each screen's
heading stays the single `h1` it already is — the ink header block the
contract describes was never built, so nothing collapses into two headings.

## Contract touches

- Schema changes needed: **none** — the backlog reads `runs`, `outfit_entries`
  and observations that already exist.
- New route files: `src/routes/runs/backlog.tsx` (+ its `stryker.conf.json`
  negation, per `server-functions-are-glue`).
- New bindings/queues/crons: **none**
- Screens: DS1, DS2. Every other surface is DS3's panel or reflow rule and
  adds no screen. `docs/design-deltas.md` item 18 closes (round 15); three
  new open items — the O5 line, Feed's desk rail, the two duplicated controls.

## Test plan

- `test/ui/tabs.test.ts` (unit) — `activeTabIndex`/`tabToLight` move here
  unchanged; plus: both bars read one table, so their destinations agree.
- `test/ui/top-bar.dom.test.tsx` (unit) — four links in order, the static
  underline on the active one and on no other, the launcher is a
  `<button aria-haspopup="dialog">` named "Log a run", the wordmark links to
  Feed, `data-ground="ink"` is on the bar.
- `test/ui/layout.dom.test.tsx` (extended) — the bell is rendered in both
  seats; the tab bar and the bar are each hidden at the other width.
- `test/ui/page.dom.test.tsx` (extended) — panel centres, column does not.
- `test/ui/sheet.dom.test.tsx` (extended) — the panel's top alignment and the
  absent scrim.
- `test/runs/backlog.test.ts` (integration, worker) — only runs with no entry,
  oldest first, the suggestion, and a save that lands one entry and one
  verdict.
- `test/runs/verdict-backlog.dom.test.tsx` (unit) — every key, the row that
  has no suggestion, and the saved row that stays put.
- `test/architecture/measures.test.ts` (unit) — no `wide:`/`desk:` variant
  outside the two breakpoints, and no width pinned outside `MEASURE`.
- e2e: desktop-width assertions added to the **existing** feature specs
  (`e2e/feed`, `e2e/closet`, `e2e/verdict`, `e2e/run-logging`), plus
  phone-width coverage so the mobile layout cannot rot. Demo re-recorded at
  both widths.

## Open questions

None outstanding — round 15 answered all five. Two things I am proceeding on
and flagging: the bell, the launcher and the `<nav>` label exist twice in the
markup (one hidden at each width, which no single-DOM arrangement avoids once
the bar must invert), and Feed's desk rail is deferred to Epic 200 with the
owner's and design's agreement rather than part-built.
