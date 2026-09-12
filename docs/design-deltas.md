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

6. **P2.5 "make them real" has no artboard, and it is the last screen in
   lane 105.** `docs/product.md` lists it as "new (D-27); needs design". Six
   questions went to design 2026-09-11: which tapped rows it offers and who
   chooses; how many fields naming costs (F asks brand → name → link →
   photo, and P2.5 should be lighter or it is just F again); whether a
   link-paste field exists at all **given lane 107 is unmerged, so
   `src/modules/enrichment/` does not exist and a paste would do nothing
   visible**; whether the screen states a target the way O3's "enough to
   start" does; how a named row reads against a generic one while naming;
   and what skip looks like. Assumed unless design says otherwise: fully
   skippable, never blocking, no link paste in v1. Copy is not part of the
   ask — D-45 collects all user-facing text in one pass and P2.5's rides
   along; what is needed is the screen's argument, since the packet
   requires it to sell "the specific piece is what learns".

5. **Onboarding's steps are inside the app's page column, and the
   artboards draw them full-bleed.** O1, O3 and P3 are each a card with
   their own internal structure and no app heading; `src/routes/onboarding/*`
   renders them inside `ui/Page`, which adds an `<h1>` above each. A heading
   is not optional — a screen with none is an accessibility failure — so the
   three are design's own copy where it exists ("One question does most of
   the work", O1) and new where it does not ("Start your closet" for O3,
   chosen to avoid repeating that screen's own "TAP WHAT YOU OWN" caption).
   **The question for design is whether these steps should sit in the page
   column at all**, or be full-bleed like the artboards, in which case the
   heading moves inside the card and the copy is design's to write. Raised
   by lane 105 while building; nothing is blocked either way.

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

## Answered in round 6 (imported 2026-09-11)

Both raised by lane 105 while building, and both answered with a change to
the artboards rather than a note.

**5 — O3 is one list.** The climate band is a **sort key and a fold point,
never a filter**: 24 canonical rows, ranked by cohort frequency in the
runner's zone, folded at 14 with the remainder one tap behind a disclosure
that states its own count. **No row is ever absent** — a Minneapolis runner
owns tights and a singlet, and one band per person is a season rather than
a wardrobe.

**Nothing arrives ticked.** A tick means "you tapped it just now", is a
toggle, and the counter counts taps. The artboard's six pre-ticks were O2
residue and are gone; "12 pieces" was a mock and not a target. "Enough to
start" appears at six and is advice, not a gate; Next is live from the
first tap. When O2 returns a photo-derived row is ticked, non-toggling and
tagged `FROM PHOTO` — visibly a different thing from a tap.

Section AA of `Remaining Screens.dc.html` carries the six-rule contract and
addresses lane 105 directly: replace `Record<band, TapListEntry[]>` with
one `TAP_LIST: TapListEntry[]` of 24 rows, and give each entry a
`rank[band]`.

**6 — hue means verdict; coverage becomes ink density.** Pink/teal/grey are
cold/dialed/warm **permanently**. Coverage goes monochrome — solid, 135°
hatch, hairline — because coverage is *ordinal* (none → all) and density
says that natively, while cold/dialed/warm is a *direction around a centre*
that density cannot express.

Verdict also stops being hue-alone: a three-slot mark whose filled slot's
**position** carries the meaning, plus a word. **`text-night/30` for warm is
retired — opacity never encodes meaning.** O6's bar and caption are
redrawn, so the Call teaser drops its bracket placeholder for the real
thing. AA3's weighting diagram now encodes by bar length, keeping the
density channel exclusively coverage's.

That answers the accessibility half of the question too: the profile's
cold/dialed/warm was a three-way distinction carried by hue alone, and it
no longer is.

## Answered in round 5 (imported 2026-09-08)

**Where a manually-added garment's type comes from** — screens Z/Z1/Z2/Z3,
and the answer is the first of the three shapes the question offered:

> Type is a property of the product, not of the garment. F never asks for
> it, nothing parses it out of a name, and a garment that has none is drawn
> as a garment that has none.

Five instructions came with it, now product rules:

1. `wardrobe_items.type` is a **cache**, written on match and on
   enrichment, never by a user.
2. **No parser.** Free text is never mined for a type, on write or on read.
3. Type filter chips are built from the types **actually present** in a
   category, never a fixed taxonomy. An all-generic category shows no chips
   — correct, not broken.
4. Detail subtitle is `type ?? categoryLabel + " · GENERIC"`. One
   expression, one slot, no empty space and no em-dash placeholder.
5. **Type never affects a recommendation.** Category and the learned range
   do that. Type is for finding things.

The two roads not taken are the useful part, because both were tempting: a
second one-tap row on F is "cheap to build and expensive every single
time", and charging a tap for a filter facet inverts F's whole argument
that identity is the only thing worth one. A parser "works until it
doesn't, fails invisibly, and can't be corrected by the person looking at
the wrong answer" — "L/S" in free text is not a type, and reading it as one
files "Crew for cold L/S days" wrong, silently, forever.

**Still open, by design's own note:** whether a runner can override an
inherited type when the product record is wrong. Probably yes, from garment
detail, post-v1 — an edit, not a question at add time.

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
