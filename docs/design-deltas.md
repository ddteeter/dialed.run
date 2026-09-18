# dialed.run — Design Deltas (work order for Claude Design)

This file is the queue of revisions to work back through the Claude Design
project ("Runner Wardrobe App Brief"). It is a **work order, not a
changelog** — an item leaves when design has answered it, and the answer
lives in the design bundle from then on.

**The contracts outrank the artboards** (owner's call, 2026-09-17). Where
`design/tokens.js` or `Theme.dc.html`'s T1 table disagrees with a drawing,
the contract wins and the drawing is behind. This reverses what this file
said until round 9, and it is not a technicality: round 9's light boards
still carry 397 font sizes the seven-step scale does not contain — 163 at
14px, 96 at 9px — and `tokens.js`'s own COLLAPSE table calls them "a design
correction we are asking for, not a value we are keeping". A lane reading
the board would build 14px; the contract says 15px.

So: **the artboards are the truth for composition** — what a screen
contains, where it sits, the hierarchy, the copy, which states exist. **The
contracts are the truth for values** — type, tracking, spacing, radius,
colour, breakpoints, measures. When you need a number, it comes from
`tokens.js` or T1, never from measuring a drawing.

**Round 1** shipped in revision 2 (V1 Screens K/L/M/N/P/Q, comments removed,
E2-lite, 5-state lexicon, Visual Crossing attribution).
**Round 2** shipped in revision 3, imported 2026-08-30 — the product-identity
round (D-26…D-33).
**Round 3** shipped the Motion Doctrine and the Icon Pack, imported 2026-09-06.
**Round 4** shipped 2026-09-07 and cleared most of this queue: see
"Answered in round 4" below.

## Open queue (nothing blocks v1 lanes)

11. **Does the Call consider how a kit looks together, and if so, what does
    hue mean then?** Raised by the owner 2026-09-18, for Epic 200.

    The ask is whether a recommended outfit should account for **colour
    combination** — not just whether the layers are warm enough, but whether
    they go together.

    **Framed as quality, not fashion** (owner, 2026-09-18), and the framing
    is the point: *"it would feel stupid for the Call to recommend someone
    wear two pieces of kit that really don't work together colour-wise …
    a lot of people would read a bad combo as an algorithm problem."*
    That is a credibility bug, not a style feature. "Never a fashion app"
    does not license visibly broken output, and the Call is the one surface
    whose entire job is to be believed — the same argument round 7 used to
    kill O3's paste field.

    So it is a **constraint, not an objective**: the Call does not optimise
    for looking good, it avoids combinations a runner would read as the
    algorithm malfunctioning. That distinction keeps the whole thing inside
    the current brand position, and it is what design should be asked
    about.

    **Check the premise first, because half of it is already built.**
    `wardrobe_items.color` exists (`schema-core.ts`), `garmentBase` carries
    `color: z.string().max(30).optional()` (`lib/contracts.ts`), and
    `GarmentForm` collects it behind a "Color" label today. It round-trips
    through `form-schema`, `form-mapping` and `service`. **No migration is
    needed to start collecting colour — we have been collecting it since the
    closet lane shipped.** What no component does is *render* it: it is
    written and never read, the same shape as `fabric_composition` in item 6.

    So the real questions are two, and only the first is design's:

    **For design — the hue problem.** §AB fixed hue as verdict, permanently:
    pink cold, teal dialed, grey warm, and coverage was *moved off* hue onto
    ink density specifically because hue was overloaded. The Brand Brief adds
    "never three accents in one viewport". A screen that draws a runner's
    actual garment colours puts arbitrary hue on a surface where hue already
    means something, and the Call's payoff — brackets open, layers arrive in
    dressing order — is exactly where that collision would land. **If the
    answer is that the Call reasons about colour but never shows it, say so
    plainly** and the question closes cheaply; that is a real option and
    possibly the right one, since the Call's job is an answer rather than a
    lookbook.

    **For the owner — whether colour becomes structured**, which is a schema
    and product call and does not belong in this file. Free text cannot be
    combined: "black", "black/grey", "Obsidian" and "BLK" are one colour
    typed four ways, and mining them is precisely the parser round 5 rejected
    ("no parser; free text is never mined for a type"). Making colour
    combinable means a palette, which means a tap on F — and F's whole
    argument is that identity is the only thing worth one.

    **Colour is not type, and the difference is the whole answer to where
    it lives.** The first draft of this item reached for round 5's
    precedent — *type is a property of the product, not of the garment* —
    and proposed colour follow it down to `products`, deriving free from
    enrichment. **The owner's read (2026-09-18) is that it does not, and the
    reasoning holds:** a product has one type forever, but it comes in many
    colourways and they come and go. `products.color` would be either a lie
    (one of several) or a list that never says which one this runner owns. A
    colourway belongs to the instance, which is exactly where the schema
    already puts it.

    So the cheap route is closed. Structured colour cannot be derived from
    the product record; the runner has to say. That lands it back on F's one
    tap, unresolved — and it is why the owner's half of this question is the
    harder half, not the formality it first looked like.

    **And the quality framing inverts which half is optional.** This item
    first called "reasons about colour but never shows it" the cheap answer.
    It is not: reasoning is exactly the half that needs structured colour,
    and *showing* is the part that can be dropped for free. A Call that
    silently avoids bad combinations needs the data; a Call that displays
    swatches does not need anything the reasoning did not already require.

    **Which makes this an Epic 200 dependency rather than a nice-to-have**,
    and gives it a deadline the epic's own schedule does not: every day we
    collect free-text colour is a day of closet data the Call cannot use.
    Retrofitting means mapping "Obsidian" to black across everyone's
    wardrobe — mining free text for a structured fact, which is precisely
    the parser round 5 rejected, and it fails silently and uncorrectably
    when it is wrong. **If structured colour is coming, the cheapest moment
    to start collecting it is before more closets fill up.**

    Two things design should be asked alongside the hue question, because
    neither is obvious and both are domain-specific:

    - **What rule?** "Don't clash" is culturally loaded and not universal.
      Neutrals-always-fine? Avoid two saturated non-neutrals? Something
      else? The Call needs a rule it can apply, not a sensibility.
    - **Hi-viz is the exception that will break a naive rule.** Runners wear
      deliberately loud colours for visibility, and this product literally
      names a token `--hi-viz` after it. A generic clash rule would suppress
      exactly the combinations a runner chose on purpose. Whatever the rule
      is, safety colour has to be outside it.

    The owner also raised an opt-out — *"maybe some people don't care, that
    could be a preference for them"* — which would fit the existing
    preference patterns (units, share default, thermal level). Recorded as
    an option, not a decision; a preference for something most runners
    probably want by default may be over-engineering.

    Nothing is blocked — Epic 200 is unscheduled (`post-mvp.md`) and the
    column is already there either way.

    **Not in round 10** (sent 2026-09-18 before this was written). Queued for
    round 11, alongside anything else that accumulates.

10. **Round 9 contradicts itself about 9px, and the contract has already
    won.** `Accessibility Contract.dc.html` requires a 44×44 hit area
    "including 9px mono chips — pad the target, not the glyph", while
    `tokens.js` law 3 says "nothing below MONO.xs (10px) exists anywhere, on
    any ground, at any width" and COLLAPSE calls 9px "a board error".
    Precedence resolves it for us — they are 10px chips, padded to 44 — so
    **nothing is blocked and no lane should wait.** The ask is only that the
    next revision agree with itself, so the contradiction does not get
    rediscovered. The hit-area rule itself is right and we are building to
    it.

9. **A band that was wrong both ways equally has no honest one-word
   verdict.** §AB3 gives each band on the profile row one word —
   *Under-dressed*, *Dialed*, *Over-dressed* — derived from whichever
   verdict count wins (`bandVerdict`, `modules/feed/coverage.ts`). When
   cold and warm are exactly tied the code picks *Under-dressed*, on the
   reasoning that underdressing is the failure that ends a run early. The
   owner's review of PR #71 pointed out the reasoning is one-sided:
   overdressing in heat ends a run too, and the Call teaser's own
   tie-break was made symmetric for that reason. A tie is not a direction,
   it is inconsistency — the band is not understood yet, which is exactly
   what the runner and later the call need to know. **The ask is a fourth
   word for that state**, "Mixed" or whatever design prefers, and its
   `VerdictMark` treatment: hue is verdict (pink cold, teal dialed, grey
   warm, per D-48), so a fourth state needs a mark that is none of those.
   Rare in practice, since it needs equal counts. Tracked as **D-60**;
   nothing is blocked, the tie goes cold until design answers.

8. **P2.5's payout counts owners, and a social-proof count may not.**
   §AC3's middle line reads *GAINED 412 runners own this piece*. Ownership
   is closet contents, and CLAUDE.md's product rules say a social-proof
   count derives **only from public entries, never closet contents** — a
   count drawn from closets leaks that someone owns a piece they never
   posted about, which is the thing that rule exists to prevent. So the
   line as drawn cannot be built, and the owner's call (2026-09-12) is to
   derive it from public entries instead; it is also the cheaper query.
   **The wording is design's, not ours**: "own" is what the artboard says,
   and "have logged this" is a guess at what it should say instead. Nothing
   is blocked — the count has no read behind it either way (D-54), and the
   named row says what actually happened until one exists.

7. **O3's artboard still draws a paste field, and the code correctly does
   not.** Design raised this against lane 105 in round 7 rather than
   silently redrawing it: `Onboarding.dc.html`'s O3 shows a
   `brand.com/product…` field with a `SPECS FOUND` result, which has the
   same lane-107 dependency §AC2b ruled out for P2.5. `TapListForm` never
   built one, so the build is right and the artboard is stale. Tracked as
   **D-55** so nobody "fixes" the code to match the drawing.

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

## Answered in round 9 (imported 2026-09-17)

The round that made the system enforceable. Two asks, both answered, plus
three deliveries nobody asked for.

**`design/tokens.js` — the contract the drawings never were.** Seven type
steps and a four-step mono ramp, each step carrying its own tracking, with a
`for:` line naming its job; a 4px `SPACE` step; five radii plus `none`;
`BREAKPOINT` (720 wide, 1040 desk); `MEASURE` (390 panel, 620 column, 1180
page); a paste-ready `CSS_VARS` block; and nine `LINT` rules with reject
patterns.

Its first law is the fix for our single largest source of drift:
**tracking is a function of size, not context.** `Mono` hardcoded 0.08em, so
every site needing another value went around it — 17 of them. The `COLLAPSE`
table names where each stray board value goes, and is explicit that those are
"a design correction we are asking for, not a value we are keeping".

That is what forced the precedence rule at the top of this file. **Read it
before building anything from a board.**

**`Desktop Contract.dc.html` — desktop is v1, and it is small.** The screen-X
note is promoted to the system's position: desktop is a reading and
closet-admin surface; every act of logging is the phone flow unchanged in a
centred panel at phone width. Confirmed across all eight v1 areas, with four
named bends and **none of them a second wide form**:

1. A1/F open a drop zone in the photo well at width — copy and one state,
   layout untouched. Face-blur runs the same WASM path on the dropped file.
2. Desktop onboarding runs O1 → O3 → O4 → O5 in the panel; O2 stays a phone
   act and O5 says so. The ladder loses no rung.
3. **DS2, the verdict backlog — the one wide layout v1 earns.** A row per
   imported run with no outfit, each row A3's three inputs laid flat.
   Keyboard: ↑↓ rows, 1–4 verdict, Enter saves, Tab opens A2 in a panel.
4. Phone ink header blocks collapse into one top bar at width.

**DS1 is the shell**: one top bar from 720px, the four tabs as four text
links in the same order with the same pink-underline active rule, the bell
moved into the bar opening S1 as a centred panel (not a dropdown), the
wordmark linking to Feed, the FAB as a pink pill. Explicitly **not a
sidebar** — "the left rail is the Desk's chrome and is what marks a screen as
operator-only. The product never grows one." X and C were each drawn with a
different bar; DS1 supersedes both.

And the limit, which is worth more than a drawing: **the Call does not go
wide.** "A wide Call would be a dashboard, and a dashboard is the opposite of
an answer."

**Three deliveries nobody asked for.**

- **`Accessibility Contract.dc.html` is v1-binding** — "every lane / WCAG 2.2
  AA / what each lane has to test before a PR is done". Mostly it collects
  rules already scattered across §AB, the Form Contract and the Motion
  Doctrine, but it adds hard requirements we neither meet nor verify: 44×44
  hit areas with 8px between them, a 2px focus outline that is never removed,
  focus order following visual order, one live region per screen, "a screen
  with no heading is a bug". It gets its own lane rather than leaking into
  whichever surface a lane touches next.
- **`Call Epic.dc.html`** (C0–C3, B1/B2) plus `design/docs/epic-200-*.md`.
  Post-v1, Epic 200. Archived, not scheduled.
- **Four new glyphs** in `icons.js`: `call`, `trip`, `home`, `pack`. `call`
  closes round 4's deferral — it waited for Epic 200 and Epic 200 is now
  drawn. `test/ui/icons.test.tsx` pins the manifest, so porting these is a
  code change.

**What the round costs us, recorded so it is a choice and not a surprise:**

- **The boards did not move to the contract.** 397 font sizes on the new
  light boards are outside the seven-step scale — 163 at 14px, 96 at 9px, 52
  at 16px, 29 at 30px — and 9px and 8px violate `tokens.js`'s own third law
  ("nothing below MONO.xs (10px) exists anywhere, on any ground, at any
  width"). Deliberate, per COLLAPSE, and the precedence rule is what makes it
  safe.
- **Three of the four dark boards are byte-identical to round 8** while their
  light twins were revised. This is not a defect to chase: `Theme.dc.html`
  says the dark artboards are *generated* from T1 — "if a screen looks wrong
  in dark the fix is here, not there" — so T1 is the contract and the dark
  boards are renderings of it. Regenerate them when task 111 is scheduled and
  somebody needs something to look at.

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
