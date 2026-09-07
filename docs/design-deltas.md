# dialed.run — Design Deltas (work order for Claude Design)

The `design/*.dc.html` artboards are the visual truth; this file is the queue
of revisions to work back through the Claude Design project ("Runner Wardrobe
App Brief"). **Round 1 shipped in revision 2** (V1 Screens K/L/M/N/P/Q, comments
removed, E2-lite, 5-state lexicon, Visual Crossing attribution).
**Round 2 shipped in revision 3, imported 2026-08-30** — the
product-identity round (D-26…D-33): F identity-first with F2 enrichment
states (reading/failed, never blocking), P2.5 naming step, `[GENERIC]`
badges + closet nudge system-wide, brand-as-text display everywhere,
ownership proof from public entries only ("worn by 12 runners this
month"), the Strava notification stripped of all activity data, and
laundry state decided to the call epic. The artboards and the plan are
in sync.

## Open queue (nothing blocks v1 lanes)

1. **106-era design** (the revision's own "still to spec" list): report
   flow, blocked-runners list, faces-blurred option for outfit photos —
   needed before/with task 106, not before lane work starts.
2. **Desktop feed** and **shoe mileage as its own object** — unscheduled;
   neither is in a v1 packet.
3. **Call epic screens** (B1/B2, O2, O4, O5) — already drawn; revisit when
   Epic 200 opens, incl. multi-part fabric display on garment/product
   detail (D-34) if composition surfaces there.
4. **Lane 102's placeholder surfaces** (shipped in PR #4 on
   placeholder-faithful layouts; the packet referenced these as deltas
   #2/#3/#6 but a renumbering dropped them from this queue): manual run
   entry, the notifications bell + notification list (the bell currently
   renders a raw 🔔 emoji — replace with `<Icon name="bell">` now that the
   Icon Pack landed), Strava connect/disconnect, and import status. All
   need real design before launch gate.
5. **Settings/privacy screen** (You tab) — product.md marks it "needs
   design"; lane 104 ships whatever placeholder its packet requires.
6. **Motion Doctrine adoption** (imported 2026-09-06 — `design/motion.js`
   + `Motion Doctrine.dc.html`; ported to `src/ui/motion.css` +
   `ui/motion.ts`; icon manifest gained `bracketLeft`/`bracketRight` for
   the reveal moves): shipped v1 surfaces predate it and animate either
   not at all or ad hoc — lanes adopt the per-surface map opportunistically,
   audited at the launch gate. Open tension to decide: the e2e demo
   fixture strips ALL motion for stable recordings, so demo videos will
   not show doctrine motion (verdict-commit bracket close, etc.) — either
   accept that or let demos record sanctioned motion once it exists.
7. **Icon Pack nav drift** (imported 2026-09-06, `design/icons.js` +
   `Icon Pack.dc.html`; ported to `src/ui/icons.tsx`): the pack's nav
   group is feed / closet / log / discover / **profile**, but product.md's
   tab bar is Feed / Closet / +Add / **Call** (teaser) / You — the pack
   has a `discover` glyph and no `call` glyph. Needs a call (ha): either
   design draws a Call-teaser glyph, or the tab uses `verdictPending`/text
   until Epic 200. Also: no glyph maps to sports-bra or arm-sleeves if
   those categories ship.

## Resolved design↔contract nit (no upstream change needed)

Skipping the name in F/P2.5 files the garment as `[GENERIC]`; the contract
requires `name`, so generic saves default it to the category/tap-list label
(taplist rows already work this way). Noted in task 101.
