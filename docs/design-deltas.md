# dialed.run — Design Deltas (work order for Claude Design)

This file is the queue of revisions to work back through the Claude Design
project ("Runner Wardrobe App Brief"). It is a **work order, not a
changelog** — an item leaves when design has answered it, and the answer
lives in the design bundle from then on.

**The contracts outrank the artboards** (owner's call, 2026-09-17). Where
`design/tokens.js` or `Theme.dc.html`'s T1 table disagrees with a drawing,
the contract wins — **and as of round 10 the drawing is not going to catch
up.** `tokens.js`'s PRECEDENCE block says so outright: _"the artboards will
NOT be redrawn to this scale — a size on a board that isn't here is a
COLLAPSE entry, not a token, and not drift."_

That last word is the one to internalise. The boards carry 397 font sizes
the seven-step scale does not contain — 163 at 14px, 96 at 9px — **and that
gap is permanent by design, not a backlog.** A lane reading the board would
build 14px; the contract says 15px; nobody is coming to make them agree.

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

10. **Dead-lettered work has nowhere a human looks.** Raised on PR #72 as
    "DLQ handling UIs on the desk" — and there is no desk: no admin surface
    is drawn or built anywhere. Today a job that exhausts its retries lands
    on its row (`products.extraction_status = 'failed'`, `runs`'
    `weather_status`, an import's status), in Sentry, and as a line in the
    daily digest, which is a Sentry event that a person reads or does not.
    **The ask is a screen**: the things the system gave up on, one row
    each, with what it was trying to do, why it stopped, and a retry — for
    enrichment that is "re-fetch this page" and "re-run extraction over the
    stored snapshot" (`reextract`), which exist as functions and have no
    button. Admin-only, so it also needs the first notion of an admin in
    the product, which is a question for the owner before it is one for
    design. **Round 8 answered half of it**: there IS an admin surface now —
    The Desk (`Operator Screens.dc.html`, item 11), whose Today page already
    carries the counts. What it does not draw is the dead-letter list
    itself, so the ask stands and now has a place to live.
    Nothing is blocked; the digest carries the count meanwhile.

11. **Call epic screens** (B1/B2, O2, O4, O5) — already drawn; revisit when
    Epic 200 opens, incl. multi-part fabric display on garment/product
    detail (D-34) if composition surfaces there. The Call tab's own glyph
    is deliberately deferred to the same moment (see round 4, item 7).
12. **Motion Doctrine adoption.** **CLOSED 2026-09-20 by task 114.** Nine of
    the map's twelve surfaces are built and two were already satisfied; the
    three that are not are not adoptions anybody skipped. **Recommendation
    reveal** is the Call epic's payoff and there is no Call in v1 — it is
    the only stagger the doctrine permits, which is what makes it tempting,
    and it stays with the epic (item 11). **Offline / error** is satisfied
    by stillness, and now has a test that fails if a later lane animates a
    failure surface. **Toast / banner** is answered, and the answer
    is no. Round 4's §AF ("Feedback with nowhere to land", item 17 below)
    decides it outright: _"no toast, ever. The control that did the thing
    says what happened, in its own place, for a fixed hold."_ Its own move
    is a 90ms opacity swap on the control, which reduced motion leaves
    alone because 90ms opacity is already the floor. **v1 has no control
    that needs it** — nothing copies a link or leaves the device — so the
    map's row stays unbuilt rather than being given a home it does not
    have. `docs/product.md` §Forms & failure says the same from the other
    side ("a toast takes the retry away with it when it leaves"), and D-9
    is closed as "answered by design, not by a toast".

    One thing this delta's own wording got wrong, recorded because it
    changed the work: it said shipped surfaces animate "not at all or ad
    hoc". There was no ad hoc — zero raw ms values and zero cubic-beziers
    anywhere in `src` — so the lane was purely additive. The one exception
    was `Skeleton`, which ran on Tailwind's `animate-pulse`: a 2s loop on a
    foreign curve that kept animating under `prefers-reduced-motion`. It is
    the breathing brackets now, like every other wait.

    RESOLVED 2026-09-06 for demos: they record full motion — the fixture's
    motion-strip and the demo project's reduced-motion emulation were removed,
    because demo videos are a primary review surface and must show the
    doctrine's real behaviour.

13. **Does a garment carry a type?** **Answered: yes**, by the owner on
    2026-09-07. `garmentSchema` now carries an optional per-category `type`,
    named for the pack's glyphs so a garment's icon _is_ its type. The
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

14. **T1 has no role for an accent used as text.** The table's fifteen rows
    cover pink and hi-viz as _surfaces_ (`--action`, `--failure`) and pink
    and teal as _body text_ (`--cold-text`, `--dialed-text`, both darker
    cuts that clear contrast on paper). Two shipped surfaces need neither:
    `NowGoRun`'s section eyebrow is hi-viz _text_ on ink, and
    `EntryDetail`'s matched panel is a teal wash behind a teal border. Both
    now spell the raw palette colour (`text-hi-viz`, `bg-teal/10`), which
    is the placeholder protocol rather than an answer — the wash in
    particular is an opacity, and T1's own note on `--quiet` is "full
    strength, never opacity". **The ask is two rows**: an accent-as-text
    value and an accent-tint value, per ground. Nothing is blocked.

15. **Three values the contract sends somewhere visible, for confirmation.**
    Each is a COLLAPSE the lane applied as written; listing them so design
    sees the result rather than discovering it in a demo.
    - The coverage swatch's `2px` corner became `RADIUS.none`, because
      RADIUS.none's own comment names "coverage cells". It reads squarer.
    - `NowGoRun`'s ink block took T1's dark-column `--hairline` (`#2A2A31`)
      for its two borders, where it had been drawing paper at 30% and 15%.
      That is the value the dark artboards were generated from, and on
      `#0B0B0E` it is much quieter than the drawing.
    - The `[dialed.run]` wordmark's `.run` was a raw `#8B8B93`, which is
      T1's **dark** muted. On paper the role resolves to `#7A7A70`.

16. **§AH's F strip says VISIBILITY and our column cannot.**
    `wardrobe_items.visibility` already exists and means the moderation
    state — `text().notNull().default("ok")`, written by `closet/service.ts`,
    sitting next to `retired`. The attribute ships as `visibility_level`,
    carrying all three of the board's chips (owner, 2026-09-19); the packet
    had described it as a hi-viz flag, and AH1 draws PLAIN / REFLECTIVE
    TRIM / HI-VIZ with rule 04 making only the last one exempt. **The ask
    is the label**: the artboard and the schema should not disagree about a
    word this load-bearing, on a table that now carries both.

17. **"Colour" on the boards, "Color" in the app.** The artboards spell it
    British throughout; the app's one existing user-facing label said
    "Color" and `docs/product.md`'s lexicon does not mention colour at all.
    Shipped American, and the free-text field became "Colorway" so two
    fields on one form do not carry the same word (owner, 2026-09-19).
    Copy is the artboard's domain, so this is a deliberate divergence
    rather than an oversight — flagging it so the next round does not
    "fix" it back.

18. **The Feed's segmented control cannot slide its indicator.** Undesigned
    surface shipped by task 114 under the placeholder protocol. The
    doctrine's "Tab switch" move is "the active indicator slides under the
    label", and the bottom tab bar now does exactly that — five equal
    columns, a pink underline one fifth wide, `instant`/`snap`, on the
    Desktop Contract's rule ("same active rule (pink underline, no
    crossfade — motion.js 'Tab switch' applies unchanged)").

    E1's in-page tabs cannot. "Following" and "Your conditions" are
    different widths, so a sliding rule needs either equal columns — a
    composition change on a drawn screen — or a runtime measurement of each
    label, which is a resize observer for a 90ms move. They ship with the
    label's colour flip and the static rule they already had. **The ask is
    one line**: are E1's two tabs a segmented control across the full width,
    or labels at their natural size? Nothing is blocked.

## Answered in rounds 10–11 (imported 2026-09-18)

Both rounds came back together and cleared **four queue items, the P2.5
wording, and the process question**. The answers live in the artboards and
`tokens.js` from here.

**Items are named, not numbered, below — deliberately.** Prettier normalises
ordered lists, so removing an item renumbers every one after it: closing
four items in this commit shifted the queue from 10/13/14/15 to 10/11/12/13.
An item number is a position, never an identifier. Cite items by name. The answers live in the artboards and `tokens.js` from
here; what follows is what changed.

**The precedence question got a plain answer, in `tokens.js` itself.** A new
PRECEDENCE block states it: _"Composition comes from the artboards; values
come from this file and T1. The artboards will NOT be redrawn to this scale
— a size on a board that isn't here is a COLLAPSE entry, not a token, and
not drift."_ So the 397 off-scale sizes are permanent and deliberate. **Stop
treating a board/contract difference as drift** — it is the system working
as designed.

**The 9px self-contradiction is fixed at the source.** The Accessibility Contract now
reads "including MONO.xs chips (10px, the type floor — nothing is drawn
smaller)", and COLLAPSE gained the detail: the boards carry 9px in ~96
places, and all of them build at 10px padded to a 44px target.

**The tied band — D-60 — is answered as `Split`.** A cold/warm tie fills _both_
outer slots in `--ink`, the knowledge colour, with the centre empty and no
hue at all. Any tie that includes dialed is Dialed. The reasoning is the one
the owner asked for: _"a tie is not a direction"_, so it never defaults to
Under-dressed. Note the mark does not take a fourth hue — hue stays verdict,
and "not a direction" is said in ink.

**P2.5's payout wording is `412 runners have run in this`.**
Design's own phrasing, and better than the "have logged this" this file
guessed at: it derives from public entries by construction, so the wording
and the privacy rule agree without anyone having to remember why.

**Composition — D-34 — is §AG.** Garment detail carries
it and nothing else does: _"the closet is for finding. Four-line
compositions under every card make the grid a spec sheet and bury the range,
which is the number that decides what you wear."_ Labelled rows for
`fabric_parts`, the verbatim line for `fabric_composition`, both null → no
block. Values are the brand's text — **no normalising "elastane" to
"spandex", no reordering by percentage, no summing to check it hits 100.**
Composition never touches the recommendation. A "WRONG? ›" link files a
product correction into the Desk review queue (task 110) rather than editing
the runner's copy, because composition belongs to the product, like type.

### Colour is §AH, and the answer is the conservative one

**"The Call reasons about colour and never shows it."** Colour is a
**tiebreak between kits of equal warmth**: it never changes a thermal call,
never appears as a reason, and never puts a swatch on a verdict surface. The
hue collision this file worried about is avoided by not drawing colour at
all.

- **Thirteen names, locked**, in two classes because the rule keys off the
  class: **Neutral** — black, white, grey, navy, brown, beige; **Colour** —
  red, orange, yellow, green, blue, purple, pink. No "multi", no "other".
  "Pick the nearest. A print is its main colour."
- **Chips are words, not swatches** — _"thirteen swatches is thirteen
  accents in one viewport"_. Design applied the brand's own rule to the
  picker.
- **The rule, at two fidelities**, exactly the constraint we flagged:
  name-level, neutrals pair with anything, same name twice passes, null
  passes (no colour means no test); and **hex-level in OKLCH when both
  pieces carry one**, where two Colours sharing a name pass only within a
  distance band — _"farther is the near-miss, and it fails."_ Thresholds are
  explicitly starting values, to tune on real closets.
- **Hi-viz is invisible to the test** — not Neutral, not Colour, not
  counted. _"It's safety because the runner said so, never because a hex is
  bright. Reflective trim is not exempt; the base colour is what shows."_
- **Scope is top, bottom, outer** — the three layers that show. Hats,
  gloves, buffs, socks, shoes exempt.
- **Where it runs**: after the thermal ranking, among candidates in the same
  band. Prefer a passing kit; if none passes, take the thermal best and say
  nothing. The one place a colour word may appear in Call copy is the "why
  not" sheet — _"Same warmth. Went with the black under the red top."_
  Prose, a name, no swatch.
- **Before the Call**: garment detail carries the name on the identity line,
  the way §AG carries composition. Not the closet grid, not a filter, no
  swatch. Enrichment may propose the name as an editable claim (F2c); **it
  never proposes a hex.**
- **F placement**: colour is the fifth attribute inside the already-collapsed
  group, so F stays identity-first and the happy-path tap count does not
  move. The free-text colourway the runner typed ("Obsidian") stays as the
  row's caption.
- **Level 2 is composed, not drawn**: _"compose it, don't draw it — this is
  the placement reference."_ Sheet, photo, one field, two buttons, all
  existing primitives. The sampler is a tap on the photo reading the pixel
  under the ring — no magnifier, no drag. No photo → no sampler. **Level 2
  without level 1 is not possible**: the sheet is reached from a chosen name.

**What this costs us to build** is a schema addition (the thirteen-name enum
and a nullable hex beside the existing free-text `color`), the F row, the
shade sheet, and the garment-detail identity line. None of it is the Call,
which is unscheduled — so the v1 slice is collection and display only.

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
  says the dark artboards are _generated_ from T1 — "if a screen looks wrong
  in dark the fix is here, not there" — so T1 is the contract and the dark
  boards are renderings of it. Regenerate them when task 111 is scheduled and
  somebody needs something to look at.

## Answered in round 8 (imported 2026-09-16)

Round 8 cleared six items and delivered two things nobody asked for. The
answers live in the artboards from here; what follows is what changed and
what it costs us.

11. **The operator surfaces have an artboard, and it made a decision we
    could not.** `Operator Screens.dc.html` is new: **The Desk**, one route
    at `/desk` behind the existing admin check, with its own shell, always
    dark whatever the operator's own theme ("it's a tool, not the product"),
    hi-viz as its only accent, desktop-first, and **never linked from the
    runner app**. The reasoning is the part lane 106 could not supply on its
    own: _"four surfaces reached by four memorised URLs is four places for
    one to be forgotten, and the daily digest needs somewhere to link."_

    It also **re-cut the four surfaces into three destinations** — Today,
    Review, Duplicates, Runners — because banning is not a destination but
    something you do to a runner, and the digest is not one either: it _is_
    Today, and the email is Today sent to you. That is a better
    decomposition than the one this file asked about.

    **Built as `docs/tasks/110-the-desk.md`, after 106.** 106 satisfies the
    launch gate with plain-but-correct screens; the Desk is the designed
    version and three surfaces that were mechanics with no screen at all.
    Two things in D1 are behaviour changes rather than drawings, and the
    packet says so: decided rows that stay struck-through with **Undo**
    (against `resolveReview`'s refusal of a second decision), and **who
    reported behind a fold, where opening the fold is logged** — which needs
    an audit table that does not exist.

12. **W3's two web states are drawn** as `Remaining Screens` §AD, and the
    loading beat gets the brackets-breathe device rather than a spinner —
    the option this file suggested, and the doctrine's NEVER list forbids
    the alternative. The artboard's FEASIBILITY note now reads _"Decided in
    round 8: the browser keeps the promise and changes the delivery"_ rather
    than the native-only framing lane 106 had to work around.

13. ~~106's admin surfaces have no artboard~~ — see item 11. Superseded
    rather than answered: the question was "draw these four", and the answer
    was "these are three, and here is the section they live in".

14. **P2.5's ownership count** — answered in the artboards.

15. **O3's paste field is gone.** `Onboarding.dc.html` now carries the note
    in so many words: _"The paste-a-product-link field that used to sit here
    is gone: it needed enrichment, which doesn't exist in v1. The build never
    had it; the artboard now agrees."_ Closes D-55, which existed so nobody
    would "fix" the code to match the drawing. O3 is also re-cut as one list
    ordered by climate band (§AA), and coverage is ink rather than hue (§AB).

16. **Onboarding's column question** — answered as §AE.

17. **Transient feedback with nowhere to land** — answered as §AF.

**And two nobody asked for.** `Theme.dc.html` plus dark variants of every
artboard. The app has no dark mode, and this did not arrive through the queue
— so it gets a lane of its own rather than leaking into whichever surface a
future lane touches next: `docs/tasks/111-dark-theme.md`, unscheduled, with
"is a dark theme in v1 at all?" as its first open question. **D-36** (the
form primitives' unwritten ink surface) closes with it.

    **Items 12 and 13 were renumbered on the merge**, from 9 and 10: lanes
    105 and 107 took those numbers for the band-verdict and dead-letter
    items while this lane was using them. Two lanes numbering one shared
    list from separate worktrees is the collision the schema protocol
    prevents for migrations, and this file has no such protocol. Worth one
    if the queue keeps taking entries from more than one lane at a time.

## Answered in round 7 (imported 2026-09-12)

**P2.5 — §AC · Make them real**, answering all six questions lane 105 asked.
The argument design settled on: _a category can't remember._ "Merino base
layer" cannot hold a temperature range, because no two of them are the same
garment; a named product is one object, and naming is how a runner's piece
joins a population.

- **Q1 — every generic row is offered, ranked never filtered**, the same
  doctrine as §AA. Rows worn on an O4-tagged run sort first under their own
  heading; the rest follow, folded past five. No badge claims to know a
  stranger's favourites — _the order_ carries the suggestion.
- **Q2 — two fields, one required.** Brand (seed-list autocomplete) and
  model (optional, suggestions from that brand's products). **No photo:**
  naming is an act of identity, and a photo says nothing about which
  product this is.
- **Q3 — no link field**, agreeing with the recommendation. _"A field that
  swallows a URL and shows nothing is a screen making a promise the build
  can't keep, on the one screen whose entire job is to be believed."_
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
  is out of scope, so rule 02's fallback — _"the first heading is absent —
  not empty. One flat list, closet order"_ — is what every v1 runner sees.

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
hatch, hairline — because coverage is _ordinal_ (none → all) and density
says that natively, while cold/dialed/warm is a _direction around a centre_
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

| Was                                                                                                                         | Answer                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **106-era design**: report flow, blocked-runners list, faces-blurred option                                                 | `Remaining Screens` W1/W2/W3. Faces blurred **at capture, on by default**.                                                                                                                                                                                                                                                                                                                                      |
| **Desktop feed** — unscheduled, and recurring as an argument                                                                | Screen X, 1440 wide, post-v1. Two columns: the phone's feed at a reading measure, plus tomorrow's answer, today's consensus and the verdict backlog. Logging on desktop opens the same flow in a centred phone-width panel rather than a second wide form.                                                                                                                                                      |
| **Shoe mileage as its own object** — unscheduled                                                                            | Screens Y1/Y2 (shoe detail, and shoes in the closet).                                                                                                                                                                                                                                                                                                                                                           |
| **Lane 102's placeholder surfaces** — manual run entry, notifications bell + list, Strava connect/disconnect, import status | R1/R2 (prefilled + failure states), S1/S2 (list, and bell/badge/empty), T1/T2/T3 (not connected, importing, connected & disconnect).                                                                                                                                                                                                                                                                            |
| **Settings/privacy screen** (You tab)                                                                                       | U1/U2.                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Icon Pack nav drift** — four nav glyphs for five tabs, no `call` glyph                                                    | `icons.js` now exports `TAB_BAR`, ported to `ui/icons.tsx` and pinned by `test/ui/icons.test.tsx`. Call borrows `verdictPending`: brackets around three dots is already the pack's idiom for "no verdict yet", which is what an unopened surface is. A dedicated glyph would ship a meaning we have not decided, so it waits for Epic 200. `discover` moved nav → social; it is a browse surface, not a v1 tab. |
| **No form-validation strategy** (`docs/deferred.md` D-17)                                                                   | `Form Contract.dc.html`, the new §Forms & failure in `product.md`, and a reference `design/src/ui/FormField.tsx`. Field failure and form failure are different events with different marks; per-field vs summary is decided by count so every lane lands in the same place; errors are marked, not reddened; nothing animates.                                                                                  |

## Resolved design↔contract nit (no upstream change needed)

Skipping the name in F/P2.5 files the garment as `[GENERIC]`; the contract
requires `name`, so generic saves default it to the category/tap-list label
(taplist rows already work this way). Noted in task 101.
