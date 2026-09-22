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
- `src/modules/feed/backlog.ts` + `runs/components/VerdictBacklog.tsx` +
  `src/routes/runs/backlog.tsx` — DS2. The reads live in `feed` because
  outfit entries and the prefill are its; the table is `runs`, which is the
  packet's ownership, and the two meet at the barrel (type-only exports, so
  nothing server-side crosses into a client bundle). One history scan for
  the whole table, not one per row. A row saves through the existing
  `attachKit` + `submitVerdict`. Keyboard: `↑`/`↓`, **`1`–`5`**, `Enter`,
  `Tab` into the outfit cell. Reached from "Clear the queue ›" on Feed,
  which `isBacklogWorthOpening` gates at two.
- `ClosetGrid` — filter rail left of the grid at `desk:` only.

**Bend 1** is `ui/use-file-drop.ts` on the two wells (`UploadForm`, the
garment photo): a dropped file and a chosen one go to the same callback,
so the blur and the constraint checks are reached identically. A1's label
had promised a drop since round 13 and nothing listened — the input is
`sr-only`, so a file dropped on the box it draws opened in the browser and
took the runner out of the flow.
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
  adds no screen. `docs/design-deltas.md` item 18 **closes** (round 15) and
  items 20–22 open: DS2's four verdict slots superseded by five, bend 2's
  extra line, and the duplicated controls. `docs/deferred.md` gains D-89–D-92.
- **Module boundary moved**: `WeatherAttribution` from `modules/weather` to
  `ui/`, recorded in `docs/architecture.md`. Not a preference — reaching it
  through the weather barrel pulled `cloudflare:workers` into the client
  bundle and broke `npm run build`.
- One T1 role added: `--accent-ink`, which is the sentence T1 already writes
  in prose ("text on an accent is always ink", the fixed colour) made
  addressable, because inside the bar `--ink` is chalk.

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
- `test/feed/backlog.test.ts` (integration, worker) — only runs with no entry,
  oldest first, the suggestion, and a save that lands one entry and one
  verdict.
- `test/modules/verdict-backlog.dom.test.tsx` (unit) — every key, the row that
  has no suggestion, the two ways Enter is early, and the saved row that stays
  put. `test/runs/backlog-keys.test.ts` (unit) for the key map, including the
  keys the table must *not* claim.
- `test/ui/use-file-drop.dom.test.tsx` (unit) — bend 1's two silent failures:
  the missing `preventDefault` that stops the drop firing at all, and a drag
  carrying no file.
- `test/architecture/measures.test.ts` (unit) — DS4 asked of every class
  string: no breakpoint but the two, and no width pinned outside `MEASURE`.
  The first half is not pedantry — 113 cleared `--breakpoint-*`, so an `sm:`
  compiles to nothing at all and fails silently.
- e2e: desktop-width assertions added to the **existing** feature specs
  (`e2e/feed`, `e2e/closet`, `e2e/verdict`, `e2e/run-logging`), plus
  phone-width coverage so the mobile layout cannot rot. Demo re-recorded at
  both widths.

## Open questions

None outstanding. Round 15 answered all five; the verdict scale was a sixth,
raised while building DS2 and answered by the owner (five keys, 1–5) with the
drawing sent back to design as item 20. Three things to know rather than
decide: the bell, the launcher and the `Main` landmark exist twice in the
markup (one hidden at each width — no single-DOM arrangement avoids it once
the bar must invert, D-90); Feed's desk rail is deferred to Epic 200 rather
than part-built (D-89); and bend 2 turned out to be satisfied by construction,
because the built onboarding has no O2 to skip and no O5 to add a line to
(D-92).
