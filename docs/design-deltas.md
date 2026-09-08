# dialed.run — Design Deltas (work order for Claude Design)

The `design/*.dc.html` artboards are the visual truth; this file is the queue
of revisions to work back through the Claude Design project ("Runner Wardrobe
App Brief"). It is a **work order, not a changelog** — an item leaves when
design has answered it, and the answer lives in the artboards from then on.

**Round 1** shipped in revision 2 (V1 Screens K/L/M/N/P/Q, comments removed,
E2-lite, 5-state lexicon, Visual Crossing attribution).
**Round 2** shipped in revision 3, imported 2026-08-30 — the product-identity
round (D-26…D-33).
**Round 3** shipped the Motion Doctrine and the Icon Pack, imported 2026-09-06.
**Round 4** shipped 2026-09-07 and cleared most of this queue: see
"Answered in round 4" below.

## Open queue (nothing blocks v1 lanes)

1. **Call epic screens** (B1/B2, O2, O4, O5) — already drawn; revisit when
   Epic 200 opens, incl. multi-part fabric display on garment/product
   detail (D-34) if composition surfaces there. The Call tab's own glyph
   is deliberately deferred to the same moment (see round 4, item 7).
2. **Motion Doctrine adoption.** Not a design ask — an implementation debt.
   Shipped v1 surfaces predate the doctrine and animate either not at all or
   ad hoc; lanes adopt the per-surface map opportunistically, audited at the
   launch gate (workflow.md checklist #5).
   RESOLVED 2026-09-06 for demos: they record full motion — the fixture's
   motion-strip and the demo project's reduced-motion emulation were removed,
   because demo videos are a primary review surface and must show the
   doctrine's real behaviour.
3. **Transient feedback for actions with no landing place** — narrowed by
   round 4, not closed. The Form Contract settles it *inside a form*: a
   failure band sits above the submit button and stays, because "a toast
   takes the retry with it when it leaves", and success gets no toast and no
   green check at all. S2 removes the other case we had — notifications
   clear their unread dot when the screen opens, so there is no per-row
   "marked read" to confirm.
   What is still unanswered is an action with no screen to land on: copying
   a share link, an autosave. Wanted before the first one ships, not after:
   what it looks like, where it appears, how long it stays, how it behaves
   under the doctrine, and how a screen reader is told. The default answer
   may well be "design the action so the state change is visible instead" —
   that is the position round 4 took twice — but that has to be a decision,
   not a gap.
4. **Does a garment carry a type?** **Answered: yes**, by the owner on
   2026-09-07. `garmentSchema` now carries an optional per-category `type`,
   named for the pack's glyphs so a garment's icon *is* its type. The
   tap-list sets one on every row.

   Kept here because it is the one place a reader would look for it, and
   because it is worth recording what design's role in it was: **none, and
   that was the point.** It arrived filed as a question for design with
   three options, two of which were impossible. P2's tap-list is already a
   list of types and the pack already draws one glyph each, so design had
   answered twice before being asked; the disagreement was between our
   contract and both of them. Asking for category-level glyphs would have
   put the same icon on all sixteen rows of P2.

   The rule: if the answer is a drawing, it comes here. If the answer is a
   schema or a product call, it goes to the owner and lives in
   `docs/deferred.md`.

## Answered in round 4 (imported 2026-09-07)

Kept as a record of what moved, and where the answer now lives. Implementation
debt these created is tracked in `docs/deferred.md`, not here.

| Was | Answer |
| --- | --- |
| **106-era design**: report flow, blocked-runners list, faces-blurred option | `Remaining Screens` W1/W2/W3. Faces blurred **at capture, on by default**. |
| **Desktop feed** — unscheduled, and recurring as an argument | Screen X, 1440 wide, post-v1. Two columns: the phone's feed at a reading measure, plus tomorrow's answer, today's consensus and the verdict backlog. Logging on desktop opens the same flow in a centred phone-width panel rather than a second wide form. |
| **Shoe mileage as its own object** — unscheduled | Screens Y1/Y2 (shoe detail, and shoes in the closet). |
| **Lane 102's placeholder surfaces** — manual run entry, notifications bell + list, Strava connect/disconnect, import status | R1/R2 (prefilled + failure states), S1/S2 (list, and bell/badge/empty), T1/T2/T3 (not connected, importing, connected & disconnect). |
| **Settings/privacy screen** (You tab) | U1/U2. |
| **Icon Pack nav drift** — four nav glyphs for five tabs, no `call` glyph | `icons.js` now exports `TAB_BAR`, ported to `ui/icons.tsx` and pinned by `test/ui/icons.test.tsx`. Call borrows `verdictPending`: brackets around three dots is already the pack's idiom for "no verdict yet", which is what an unopened surface is. A dedicated glyph would ship a meaning we have not decided, so it waits for Epic 200. `discover` moved nav → social; it is a browse surface, not a v1 tab. |
| **No form-validation strategy** (`docs/deferred.md` D-17) | `Form Contract.dc.html`, the new §Forms & failure in `product.md`, and a reference `design/src/ui/FormField.tsx`. Field failure and form failure are different events with different marks; per-field vs summary is decided by count so every lane lands in the same place; errors are marked, not reddened; nothing animates. |

## Resolved design↔contract nit (no upstream change needed)

Skipping the name in F/P2.5 files the garment as `[GENERIC]`; the contract
requires `name`, so generic saves default it to the category/tap-list label
(taplist rows already work this way). Noted in task 101.
