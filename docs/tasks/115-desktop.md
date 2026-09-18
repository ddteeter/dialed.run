# Task 115 — Desktop (sequential on main; adoption lane 4 of 4)

## Goal

Build `design/Desktop Contract.dc.html`. Desktop is in v1 (owner, 2026-09-17),
and the contract is what keeps that from meaning "design 65 screens twice".

## The doctrine, in one paragraph

**Desktop is a reading and closet-admin surface.** Every act of logging — a
run, a verdict, a garment — is the phone flow, unchanged, in a centred panel
at phone width. Exactly one job earns a wide layout it did not have: clearing
a backlog of verdicts, *"because a keyboard and a table beat six sheets."*

Read the contract before the packet. It confirms the doctrine holds across
all eight v1 areas and names the four places it bends — **none of them a
second wide form.**

## Why it is last

It consumes all three lanes before it: `BREAKPOINT` and `MEASURE` come from
the token port (113), the top bar needs motion's tab-switch treatment (114),
and its focus order is only checkable once the focus rules exist (112).

## You own

- `src/ui/Layout.tsx`, `Page.tsx`, `TabBar.tsx`, `Sheet.tsx`
- `src/routes/**` — layout wiring only, and every lane's routes, so **this
  lane runs alone**. It is the one adoption lane that crosses route
  ownership.
- A new `src/modules/runs/components/` surface for the backlog table (DS2).

## Requirements

### 1. The shell (DS1) — one top bar from 720px

- **The tab bar becomes a top bar at `BREAKPOINT.wide` (720px).** Same four
  destinations, same order, as four text links. Same active rule: pink
  underline, no crossfade — `motion.js`'s tab-switch treatment applies
  unchanged.
- **Not a sidebar.** The contract is explicit: *"the left rail is the Desk's
  chrome and is what marks a screen as operator-only. The product never grows
  one."* A sidebar here would make the runner app look like the admin tool.
- **The bell** leaves the per-screen header and sits right in the bar, S2
  states unchanged. It opens the S1 list **as a centred panel, not a
  dropdown.**
- **The wordmark** sits in the bar and links to Feed. The phone has no
  on-screen wordmark, so this is the one place the logo appears in the
  product.
- **The FAB** — which lives in the tab bar on phone — becomes the pink pill
  in the top bar, on every screen, opening A1 in the centred panel.
- **Per-screen ink header blocks collapse.** At width there is one top bar;
  the phone's ink header block with title + bell (+ theme segment on You)
  drops to a plain heading. T2 rule 04 applies to the one bar that remains:
  ink bar on paper, paper bar on ink.
- **X and C were each drawn with a slightly different bar. DS1 supersedes
  both** — do not reconcile three bars, build one.

### 2. The four bends

1. **A1 upload and F add-garment** show a drop zone in the photo well at
   width: *"Drop a photo, or shoot it on your phone later."* Copy and one
   state change; **the layout is untouched.** Face-blur runs the same WASM
   path on the dropped file — do not fork it.
2. **Onboarding** runs O1 → O3 → O4 → O5 in the centred panel. O2
   (shoot-the-closet) stays a phone act and O5 adds one line: *"Photos come
   from your phone — we'll remind you."* The O6 ladder loses no rung.
3. **DS2, the verdict backlog** — see below.
4. **Headers** — covered in DS1 above.

### 3. DS2 — the one wide layout

A row per imported run with no outfit. **Each row is A3's three inputs laid
flat** — outfit, verdict, save — *not a new form*. Editing an outfit still
opens A2 in the panel.

Keyboard, and this is the reason the surface exists: `↑`/`↓` moves rows,
`1`–`4` sets the verdict, `Enter` saves, `Tab` into the outfit cell opens A2
in a panel. Reached from "Clear the queue ›" on X, or the S1 verdict prompt.

### 4. Measures and breakpoints

- `BREAKPOINT.wide` 720, `BREAKPOINT.desk` 1040. **Two thresholds, three
  layouts. Never a third breakpoint.**
- `MEASURE.panel` 390 — every "centred at phone width" surface is *exactly*
  this wide. `MEASURE.column` 620 for reading. `MEASURE.page` 1180 for the
  shell's content max-width.
- Between wide and desk: `min(100% − 2×SPACE[6], MEASURE.column)`. **Never a
  fluid two-column.**
- Two columns are permitted only at `desk`, only for Feed X, Closet C and the
  verdict backlog. **Never three.**
- Nothing pins a width that is not in `MEASURE`.

### 5. What must not happen

- **The Call does not go wide.** *"A wide Call would be a dashboard, and a
  dashboard is the opposite of an answer."* It is the centred panel plus its
  summary card in the feed rail. (There is no Call in v1 — this binds the
  teaser and Epic 200 both.)
- **No second wide form.** Duplicating the log flow *"would double the
  surface that has to stay in sync for the least-used path."*
- **Type does not shrink at width.** `tokens.js` law 3. Desktop gets more
  room, not smaller text.

## Out of scope

- The Desk (task 110) — operator surfaces, their own shell, deliberately not
  this.
- Dark mode (111).
- Any new screen not in the Desktop Contract.

## Test expectations

- Playwright already resolves a per-worktree port and runs one worker; add
  desktop-width assertions to the **existing** feature specs rather than a
  parallel desktop suite. `e2e/` is organised by feature, never by lane — grep
  `Covers:` before creating anything.
- The demo project records at 1280×720, which until now has been showing a
  phone-width app on a desktop canvas. **After this lane that is finally the
  right viewport** — but add phone-width coverage so the mobile layout does
  not silently rot.
- Unit-test the breakpoint decisions as pure functions where you can; a
  layout that branches inside a route file is untestable by construction and
  `server-functions-are-glue` forbids it anyway. Put the decision in a
  sibling and the markup in a component.

## Done criteria

- DS1 and DS2 built; the four bends in place; nothing on the must-not list.
- No width pinned that is not in `MEASURE`; no third breakpoint.
- `npm run verify && npm test && npm run build` green; mutation score holds.
- **Demo video: yes, at both widths.** This is the largest user-visible change
  in the sequence.
- Update `docs/architecture.md` if the shell's module boundaries move.
