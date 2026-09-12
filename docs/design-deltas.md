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


## Answered in round 7 (imported 2026-09-12)

**P2.5 — §AC · Make them real**, answering all six questions lane 105 asked.
The argument design settled on: *a category can't remember.* "Merino base
layer" cannot hold a temperature range, because no two of them are the same
garment; a named product is one object, and naming is how a runner's piece
joins a population.

- **Q1 — every generic row is offered, ranked never filtered**, the same
  doctrine as §AA. Rows worn on an O4-tagged run sort first under their own
  heading; the rest follow, folded past five. No badge claims to know a
  stranger's favourites — *the order* carries the suggestion.
- **Q2 — two fields, one required.** Brand (seed-list autocomplete) and
  model (optional, suggestions from that brand's products). **No photo:**
  naming is an act of identity, and a photo says nothing about which
  product this is.
- **Q3 — no link field**, agreeing with the recommendation. *"A field that
  swallows a URL and shows nothing is a screen making a promise the build
  can't keep, on the one screen whose entire job is to be believed."*
- **Q4 — no target, no gate**, and no "enough to start" equivalent. O3 can
  say it because six taps is a real threshold for a first call; naming
  changes nothing about whether the app works today.
- **Q5 — the Z language verbatim** while generic; named, the subtitle
  becomes the product's type.
- **Q6 — Next always enabled**, skip as O3's underlined text, both land on
  P3, and P2.5 never reappears. The closet nudge is the only follow-up.

**What v1 could not build, and why** — two rows rather than silent gaps:

- **D-54**: §AC3's three payout lines each need something that does not
  exist (`products.type` → lane 107; an owner count → no such read; tagged
  runs → O4). The named row states what happened and stops.
- **The ranked heading is inert.** Rule 01 sorts by O4-tagged runs and O4
  is out of scope, so rule 02's fallback — *"the first heading is absent —
  not empty. One flat list, closet order"* — is what every v1 runner sees.

**Design also flagged one back at us, and the build was already right:**
O3's artboard still draws a paste field with `SPECS FOUND`, same lane-107
dependency. `TapListForm` never built one. Recorded as **D-55** so nobody
"fixes" the code to match a stale artboard.

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
