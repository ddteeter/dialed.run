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
**Round 12** shipped the navigation types, imported 2026-09-20 by task 117.
**Round 13** shipped the accessibility answers, imported 2026-09-20 by task
112 — a new T1 role, a retired teal, and the unavailable-control table. See
"Answered in round 13" below.
**Round 14** shipped the same day, correcting one row of round 13 and
settling two copy questions the build had already answered its own way.
Two files changed and nothing else: `motion.js` gains `NAV_TYPES` (five
types) and `NAV` (26 edges at three widths), two NEVER entries, and one
clause on `REDUCED_MOTION`; `Motion Doctrine.dc.html` gains section 04b to
draw them. The doctrine now covers what happens _between_ screens as well
as on one.

**The `NAV` header carries an ownership rule, and it changes how a lane
behaves.** _"NAV lists every shipped edge, not just the Flow Map's. A lane
meeting a new edge assigns a type by analogy to the nearest row, adds the
row here in the same PR, and flags it."_ So an untyped edge is **not** a
blocker and not a design-delta question — it is a row the lane writes and
design reviews after the fact. The new NEVER entry says the same thing
from the other side: _"never a sixth type."_

## Open queue (nothing blocks v1 lanes)

10. **Dead-lettered work has nowhere a human looks.** **ANSWERED by round 21: drawn as D6 · Gave up; not built.** Raised on PR #72 as
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
    **Still not built (task 125 leftovers, 2026-09-30):** the board's row
    needs a reason, a try count and a time that no dead-letter handler
    records, so the page waits on one additive table (register row R-119).
    **BUILT (design-adoption PR B, 2026-10-06):** `gave_up` records them,
    Today draws round 29 B·2's section with D6's rows, the rail is D-87's,
    and the digest adds its one line. What the build had to say that no
    board draws is item 55.

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
    side ("a toast takes the retry away with it when it leaves"), and R-9
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

14. **T1 has no role for an accent used as text.** **CLOSED by round 21: `--hiviz-text` and `--dialed-tint`, ported and worn.** The table's fifteen rows
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

15. **Three values the contract sends somewhere visible, for confirmation.** **CLOSED by round 21: all three confirmed.**
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

16. **§AH's F strip says VISIBILITY and our column cannot.** **CLOSED by round 21: keep "Visibility"; never use it for a privacy control.**
    `wardrobe_items.visibility` already exists and means the moderation
    state — `text().notNull().default("ok")`, written by `closet/service.ts`,
    sitting next to `retired`. The attribute ships as `visibility_level`,
    carrying all three of the board's chips (owner, 2026-09-19); the packet
    had described it as a hi-viz flag, and AH1 draws PLAIN / REFLECTIVE
    TRIM / HI-VIZ with rule 04 making only the last one exempt. **The ask
    is the label**: the artboard and the schema should not disagree about a
    word this load-bearing, on a table that now carries both.

17. **"Colour" on the boards, "Color" in the app.** **CLOSED by round 21: American stays, on every board.** The artboards spell it
    British throughout; the app's one existing user-facing label said
    "Color" and `docs/product.md`'s lexicon does not mention colour at all.
    Shipped American, and the free-text field became "Colorway" so two
    fields on one form do not carry the same word (owner, 2026-09-19).
    Copy is the artboard's domain, so this is a deliberate divergence
    rather than an oversight — flagging it so the next round does not
    "fix" it back.

18. **Two tab surfaces, one sliding indicator.** Undesigned
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
    label's colour flip and the static rule they already had.

    The tab bar's own composition changed to make the slide possible, and
    that is the second half of this ask: the five tabs were a
    `justify-between` row of natural-width labels and are now five equal
    columns with the label centred in each. No board draws the mobile tab
    bar, so nothing was contradicted — but it is a layout decision a lane
    made for a motion reason, which is exactly the kind the placeholder
    protocol wants seen rather than discovered in a demo.

    **CLOSED 2026-09-20 by round 15.** Both lines answered, and both the
    way the build had already gone. E1's two tabs are _"labels, not a
    segmented control; the active one carries a static underline and only
    the colour moves"_ — so nothing on a drawn screen reflows. The five
    equal columns stand, and `motion.js`'s "Tab switch" row now says so
    itself rather than leaving one sentence to cover two bars: the phone
    bar slides because equal columns make it free, and natural-width
    labels — E1's two and the top bar's four — carry a static underline.
    See "Answered in round 15" below.

    **Half-answered by round 12 (2026-09-20).** `NAV`'s `+ Add (bar
launcher)` row rules that _"+ Add is a launcher, not a tab: the
    indicator never travels to it, and the tab beneath stays selected"_ —
    so the bar carries four tabs at five seats, and the launcher takes
    none of them. The indicator half shipped in task 114; the selected-tab
    half shipped in task 117 with the `rise` it is one behaviour with, and
    R-80 is closed. The two open questions above are untouched by that
    ruling and still stand.

19. **The tab held beneath the log flow is lit, and silent.**
    **ANSWERED 2026-09-20**, in the Accessibility Contract (a new row under
    Tab bar) and mirrored in `motion.js`'s NAV launcher row.

    The held tab is `aria-current="true"` — the current item in the set,
    not the current page, because the runner is not on it. No tab is
    `"page"` during the flow; the flow screen announces itself. The bar's
    own name does not change and there are no new words.

    **It forced a behaviour clause the bar lane has to pick up**: `+ Add`
    is a `<button aria-haspopup="dialog">`, never a link and never
    current — a launcher cannot be where you are. So the row above it,
    "five `<a aria-current="page">`", now reads as four links and one
    button.

    Expected: _"Closet, link, current, 2 of 5"_ · _"Add, button, dialog"_.

    Built by task 117 in the PR that asked; R-81 closes with it. Verified
    in Chromium — the launcher's accessible name is computed from re-nested
    markup, which happy-dom cannot see.

20. **DS2's four verdict slots are superseded by five.** The Desktop
    Contract draws _"1 too cold (pink), 2 dialed (teal), 3 too warm (quiet
    grey), 4 skip-for-now (empty)"_ — three verdicts and a skip, where A3
    offers the full −2..+2 scale. DS2's own rail note says a verdict saved
    here _"counts exactly like a verdict from the phone"_, and the two
    cannot both hold: a coarse key writes into the same column and the
    same future training signal, so "too cold" would have to mean either
    −1 or −2 and the table would be recording something the sheet cannot.

    **Owner's call, 2026-09-21: five keys, `1`–`5`, in the scale's own
    order.** Skip needs no key — leaving a row and pressing `↓` is
    skipping it, which is also what the empty fourth slot was drawing.
    Built that way in task 115; `verdictKeys` derives from `verdictScale`,
    so the table cannot drift from the sheet.

    **CLOSED by round 16, imported 2026-09-21.** Design redrew DS2's
    verdict column as five slots carrying A3's words and only the words —
    no digits, here or on the desk — with `1`–`5` demoted to keyboard
    shortcuts in the legend and skip a key rather than a slot. The Flow
    Map already forbade numeric scores in UI, which is the reason the
    digits could not stay on the face of the control even though the keys
    do. Built; R-91 closed.

21. **Bend 2 is satisfied by construction, and its extra line would be
    false.** **CLOSED by round 21: met; the sentence is retired. R-92 closed.** DS0's second bend says desktop onboarding runs O1 → O3 → O4 →
    O5 and that O5 gains _"Photos come from your phone — we'll remind
    you."_ The built flow is O1 (calibrate) → O3 (tap-list) → O4 (name) →
    **P3** — and P3's own artboard note says it _"replaces O4 and O5"_. So
    there is no O2 to skip: the closet fills from the tap-list on every
    device, and every step already renders in the 390 panel.

    The line was therefore not added, for a second reason as well: once
    bend 1's drop zone lands, "photos come from your phone" is **wrong at
    width**. **The ask is one line**: confirm the bend is met, or say
    where the sentence should live now that O5 does not exist. R-92.

22. **The shell carries two of three controls, one hidden at each width.** **CLOSED by round 21: understood.**
    Undesigned consequence shipped by task 115 under the placeholder
    protocol — no new glyph, colour or word, but a structural decision a
    reviewer should see rather than discover.

    `[data-ground="ink"]` is an attribute and the twelve roles it
    redefines are inherited, so the inverted top bar cannot be the same
    element as the phone's un-inverted header. `Layout` mounts both bars
    and CSS hides one. The bell renders twice, the launcher twice (`+ Add`
    and `Log a run`, which round 15 ruled deliberate), and the `Main`
    landmark twice. Exactly one of each is in the accessibility tree in a
    browser. The **destinations** are not duplicated — one table, read by
    both bars.

    Nothing is blocked and no drawing is contradicted. Flagged because it
    is the kind of thing that looks like a bug in a screen reader
    transcript and is not. R-90.

23. **The landing page wears the product shell, and now wears the top
    bar.** **ANSWERED by round 21 (its own bar, drawn); not built. R-93.** DS5 reserves this screen — _"no footer, no 'about', no pricing
    in the product bar. The logged-out landing page is a separate page
    with a separate brief"_ — so it is outside the Desktop Contract and
    task 115 did not redesign it. But it does wear `Layout`, which means a
    signed-out visitor has always seen the phone's tab bar there, and from
    720 up now sees the full top bar: four destinations they cannot reach,
    a search glyph, a bell and "Log a run".

    **The concrete defect is the wordmark, twice.** The page opens with
    the bracketed lockup as its hero, and the bar adds a second one a few
    pixels above it. On the phone there is only the hero, so this is new
    at width and nowhere else.

    It is not obvious that the shell should simply go: onboarding's "Done
    for now" links here, so a runner who finishes lands on `/`, and the
    bar is their way back into the app. `SessionActions` offers a signed-in
    visitor their email and a sign-out and nothing else.

    **The ask is the brief DS5 already promises.** What does this page look
    like at 720 and 1040 — does it keep the product bar, lose it, or get a
    marketing bar of its own; and if it loses it, what does a signed-in
    visitor use to get back in? Owner's call to send it rather than guess
    (2026-09-21). R-93.

24. **A3b is described, not drawn.** **ANSWERED by round 21: drawn as built; Done and swipe-down both keep.** Round 20 gives it in one sentence —
    _"every kit garment as a Fine / Too much / Not enough triple, plus all
    nine tags"_ — and no board. Built from existing parts only
    (`feed/components/SpecificsSheet.tsx`): the `Sheet`; a heading,
    "Anything specific?"; one `ChoiceList` per garment, legended with its
    name (the groups A3 carried inline before the chips replaced them);
    the nine tags as the same pill toggle as A3's chips; and a **Done**
    button in the outline style `ShadeSheet` uses for its secondary
    action. No new glyph, colour or motion. **The ask is the board.**

    Two things the build had to decide that a board would settle: MORE is
    inert once Noted is showing (everything chosen is already a pressed
    chip, and a receipt is not edited), and a garment chip tapped a second
    time goes back to Fine rather than flipping direction.

25. **Four things the chip rule leaves unsaid, built as assumptions.** **ANSWERED by round 21: all four confirmed, plus ≥2 runs to be "weakest"; nothing-to-note is a receipt. Not built yet.**
    Round 20's chip rule is exact about the shape and silent on four
    inputs; each is one function in `feed/chips.ts` with a test of its own,
    so a ruling that overturns one is a one-line change.
    1. **"Weakest" is the lowest dialed share** in the band (dialed ÷
       runs); ties go to more runs, then kit order.
    2. **A garment never worn in this band is not suggested** — it has no
       record to be weak.
    3. **Dialed suggests one garment**, in the way it has more often been
       off; one never off either way is not suggested.
    4. **No garment chips before a verdict is chosen** — the verdict sets
       their direction. Tags still fill to five.

    **The ask is a yes or a correction on each.** Also open from round 20:
    when saving has nothing to note (no kit, or no band) the screen still
    goes to the entry, since Noted has no sentence to say.

26. **One failure pattern for a control that isn't a form.** **CLOSED by
    round 27 (item 24): confirmed, and written into the Form Contract as
    §02b.** Round 22's
    item 9, which never arrived. A1 upload, A2 attach, run detail's save,
    Strava connect, follow, useful and unblock each fail differently — some
    as pink lines, which the Form Contract forbids, some silently. The ask
    is one pattern (the Form Contract band, an inline mark, or something
    else), drawn once on a representative control. Round 22 ruled two cases
    (A1 stalled uses the form band; DS2's failed row gets a band spanning
    the row), so the pattern may already be "the band, sized to the thing
    that failed" — design to confirm.

    **Still open after round 26**, which was not asked it again. Every new
    failure it draws is that pattern: a §4a band sized to the thing that
    failed (A1's refetch, F's photo, Find, Resend, and E2-lite's and
    search's "Didn't load", confirmed as "the §4a band sized to the block").
    That is strong evidence for the answer, but it is not a ruling.

27. **Two words round 22–23 do not give, built from their rule (task 120).**
    **CLOSED by round 26 (item 8): both confirmed.** The hint stays derived,
    and every "HEIC" on round 22's photo-well frames is now "JPG, PNG or
    WebP". `STILL MARKED` is §4a applied as written. The comments in
    `src/lib/photo-constraints.ts` and its test that say the board draws HEIC
    are now stale.
    - **The photo well's formats.** Round 22 draws "Flat on the floor works
      best. JPG, PNG or HEIC." The server accepts JPEG, PNG and WebP, not
      HEIC, so the hint reads "JPG, PNG or WebP" — derived from
      `lib/photo-constraints`, so it cannot name a type the server refuses.
      **The ask:** keep the derived list, or should HEIC be accepted?
    - **Un-marking Useful.** §4a names `NOT MARKED` for Useful and pairs
      Follow/Unfollow as `NOT FOLLOWING` / `STILL FOLLOWING`. Taking a
      Useful back that fails reads `STILL MARKED`, by the same rule — "the
      kicker names the state still true". **The ask:** confirm.

28. **The breached-password refusal has placeholder copy (PR #104).**
    **ANSWERED by round 26 (item 17): the placeholder is confirmed, and the
    screen fails open. CLOSED by round 27: U1's password sheet (item 11)
    keeps round 26's refusals.** Sign-up
    and a password change now screen the new password against known
    breaches (NIST SP 800-63B §3.1.1.2 — a blocklist, and no composition
    rules). A match lands on Password as "That password has turned up in a
    data breach. Pick another." — the owner's draft, built in the Au3 field
    failure pattern. **The ask:** word it, and say whether Au1 should hint
    at the screen before a runner meets it.

29. **The Google button needs drawing around Google's official "G" (PR
    #104).** **ANSWERED by round 26 (item 13): drawn light and dark; the
    build is lane 126's. CLOSED by round 27 (items 2–3): the label is
    Archivo, and the exemption is in T1 and `icons.js`.** Google's Sign in with Google branding guidelines forbid a
    custom or monochrome mark ("must be the standard color version"), and
    Au1–Au7 draw a ring-and-letter "G". The build now uses Google's own
    full-colour mark, as a sanctioned brand exception outside the icon
    manifest with its own fixed colours. **The ask:** redraw the Au button
    around that mark — size, spacing against the label, and the in-flight
    and failed states.

30. **Two feed words round 26 asks for and does not give (task 129).**
    **CLOSED by round 27 (item 25): "Most"/"Some", plus "Split" on a tied
    lead and "All" alone; the bell's name says "more than 9 new" above 9.
    Not built.** **The bar words are built (design PR D, 2026-10-07); the
    bell's name is not (R-141).**
    - **The consensus bar's word.** Round 26 #9 puts a word on each
      consensus bar so colour is never alone (rule 10). The build reads
      "Most" on the leading bar and "Some" on the rest
      (`feed/components/ConditionsTab.tsx`, `BAR_WORD`) — placeholder copy
      composed from existing type. **The ask:** the words.
    - **The bell with a count it does not draw.** The ruling names two
      accessible names, "Notifications" and "Notifications, {n} new". The
      dot carries no digits; the name uses the unread count as digits and
      the badge stops at `9+`. **The ask:** confirm the name says the
      number while the dot does not.

31. **Four surfaces task 128 built without a drawing (PR #118).** **CLOSED
    by round 27 (items 26, 27, 30): deletes stay at the foot under YOURS
    with no overflow, and the photo delete moves onto the photo; the
    grammar is confirmed and the three bodies worded; the blur cells are
    redrawn as a 3×3 map of 44px squares; the case line stays out. Not
    built.** **The blur cells are built (PR #129, SAF-11), and W3's bullet
    is open again with a new ask for design round 28 (decision D-76).**
    **ANSWERED by round 28 (items 5 and 14): W3 stays open until "Use this
    photo"; the photo button's glyph is `remove`, the cells' tick is
    `check`. Not built.** **W3's confirm is built (design PR A, 2026-10-06;
    round 28 #5 below, R-113 closed).** **The deletes, the glyph and the bodies are
    built (design PR D, 2026-10-07).** Each is
    composed from existing primitives and copy in the system; none adds a
    glyph, colour or motion.
    - **The delete links.** "Delete this entry", "Delete photo {n}" at the
      foot of D (`feed/components/RetractEntry.tsx`, owner only) and
      "Delete this run" at the foot of the run
      (`runs/components/DeleteRun.tsx`): text links in the report link's
      grammar. The packet's asks were "the D/E1 overflow" and "the
      run-detail action". **The ask:** where these live, and whether an
      overflow replaces the links.
    - **ConfirmSheet.** `ui/ConfirmSheet.tsx` generalises round 22's
      drawn garment retire confirm ("Y Retire confirm") to the three
      deletes: heading as the question, the cost as the body, the verb on
      an ink primary, **Keep it** focused, and round 23's control failure
      band under it with the sheet left open. The three bodies — each
      saying what goes and ending "This can't be undone." — are
      placeholder copy. **The ask:** confirm the borrowed grammar for a
      delete, and word the three bodies.
    - **W3's keyboard blur cells, and how long W3 stays open.** The
      cells are answered: round 27 #27 redrew them as a 3×3 map of 44px
      squares, and PR #129 built that (`safety/components/PhotoBlur.tsx`,
      `BlurCells`). What is open is the step's lifetime. W3 closes on its
      first `onReady`, which `PhotoBlur` calls as soon as the detector's
      blur is painted, so tap-to-blur and the cells are on screen for a
      moment rather than until the runner is done (register R-113; it
      pre-dates PR #129). **The ask (design round 28, decision D-76):** a
      "use this photo" confirm that keeps W3 open until the runner says
      so — where it sits, what it says, and what Cancel or a new pick
      does from there.
    - **D4 · AccountClosed.** Built to Operator Screens D4
      (`safety/components/AccountClosed.tsx`) but without the board's
      `CASE [B-0031]` line: bans carry no case number, and inventing one
      would be a reference nobody at the desk could look up. It is also
      mounted nowhere yet — lane 126's sign-in form puts it on screen on
      `ACCOUNT_CLOSED` — and a refused Google sign-in reaches that form as
      a redirect carrying the reason but not the date D4 prints. **The
      ask:** drop the case line or say what it names; and what D4 says
      when it has the reason but no date.

32. **Two sizes the contracts do not give, found in the owner's UI review
    (PR "UI polish: fields beside buttons, the closet's rows, A2/A3 at
    width").** Both were measured in the running app, not on a board.
    **CLOSED by round 27 (item 31): 50px, now in the Form Contract §02b;
    the tile photo is 4:5. Not built; two of the values disagree with
    `tokens.js` (see round 27).** **The disagreement is CLOSED by round 28
    (item 1): `tokens.js` now carries `HEIGHT.field` 50, `RADIUS.field` 10,
    `RADIUS.tile` 10 and `TYPE.field` 16. Not ported.**
    - **How tall is a field?** The owner asked whether fields are too
      tall. The Form Contract gives the field's anatomy (1px rule → 2px
      ink, padding that never resizes the box) and tokens.js gives
      "hit targets are ≥ 44px tall", but neither gives a field height.
      The built box is **50px**: the ported padding (`px-4 py-3`, the
      design prototype's 12px) plus TYPE.body's 24px line plus two 1px
      rules. Its `min-h-12` (48) never binds. The pill buttons beside a
      field (Find) are 48.5px on their own, and now stretch to the box.
      **The ask:** is 50 right, or should the contract name a field
      height? A 48px field is 11px of padding, which SPACE has no step
      for, so a smaller field is a contract change, not a build fix.
    - **The closet tile has no photo well.** Board C's tile is a photo
      well (the photo, or the hatch) over the name and two mono lines,
      and its dashed Add tile is drawn at a full tile's height. The
      built tile (`closet/components/ClosetGrid.tsx`) is the text half
      only, so a full-height Add tile ran its row to 160px against 85px
      for every other row. The row is fixed — the Add tile now takes its
      row's height, and keeps the minimum only as the only cell — but
      the tile itself is still short of C. **The ask:** the photo well's
      height as a token (nothing in tokens.js gives one), or a ruling
      that v1's tile is text-only.
33. **Two surfaces task 129's follow-up built without a drawing.**
    **ANSWERED by round 28 (items 6 and 11): a hi-viz `UNDER REVIEW` tag on
    the card and a §4a band on D, without brackets (see the D-67 conflict);
    `/@old` is confirmed as the sentence alone. The marker is not built.**
    Both are composed from existing primitives; neither adds a glyph,
    colour or motion.
    - **The under-review marker (register row R-62, not decision D-62),
      on the card and on D** (FEED-6,
      `feed/components/PostCard.tsx`, `feed/components/EntryDetail.tsx`).
      The author of an entry hidden pending review still sees it in their
      own Following feed and on D (D-67), marked `[UNDER REVIEW]` —
      bracket notation in `--muted` — and nobody else ever reaches it.
      **The ask:** the marker's placement on the card and on D, and
      whether it needs a line saying why ("Only you can see this while we
      look at it" or similar — no sentence is shipped, because it is
      user-facing wording).
    - **`/@old` — "This runner changed their name."** (FEED-10,
      `feed/components/RunnerAtHandle.tsx`). The ruling gives the sentence;
      the page around it is H's column and back link with the sentence set
      as H's empty-state lead, and nothing else — no avatar, no Follow, no
      report. **The ask:** confirm the page is the sentence alone.

34. **ACC-8 asks for the current password (PR #119 review).** **CLOSED
    by round 27 (items 9 and 11): the field is drawn in "U1 Change email",
    a wrong one reads "That's not your current password." (built, for
    Change password too), and reset no longer waits (D-63 stands). The U1
    list-and-sheets composition is not built.** One placeholder remains
    from the same field. **ANSWERED by round 28 (item 10): "That's 5 wrong
    tries. You can try again at 7:42 PM." Not built.**
    - **Too many tries at the current password.** The server now limits
      tries at it to 5 per 15 minutes per runner (Better Auth's HTTP
      limiter never sees a server-side check). Past the limit the field
      reads "Too many tries. You can try again at {time}." — Au's "Too
      many tries." plus the send limit's clock (`currentPasswordLimited`
      in `lib/contracts.ts`), placeholder copy. **The ask:** word it.

35. **The unsubscribe landing asks before it unsubscribes (D-64).**
    **CLOSED by round 27 (item 8), and built:** "Stop run reminder
    emails?" with the address masked, one ink Unsubscribe button, the
    `STILL SUBSCRIBED` band, the done state on any later visit, and "Turn
    them back on" returning to the question. The build drops the board's
    push sentences (no push, D-44): the ask body reads "We'll stop
    emailing {masked} when a run lands on Strava. Account emails don't
    change." and the done body "You won't get another one. Strava stays
    connected." "Turn them back on" is the inline link grammar in ink:
    the board's `#C21A6B` is not a T1 role.

36. **Task 128 PR 2a's Desk and notice placeholders.** Built from existing
    `ui/` primitives, bracket text and no new glyph; each wants a drawing.
    **ANSWERED by round 28 (items 2 and 8), except the content-removed
    email, which round 28 was not asked: the review row's decision bar,
    the takedown form, D8's search states, Reopen and the notice band are
    drawn, and the ban email's foot is D-73's. Not built.** **Design PR A
    (2026-10-06) built three of them: the row opens itself ("Decide this
    one" is gone), the CSAM second press with round 29 #3's line, and the
    notice band's takedown sentence. See round 28 #8 for what is left.**
    - **Review queue decisions.** Each row picks a reason from the removal
      list (the sentence the author is sent, round 27 #20) and offers
      Approve · Remove · Remove as suspected CSAM. Only one row carries the
      decision at a time — the oldest, or the one picked with "Decide this
      one" — because `ChoiceField` takes its name as its id. The CSAM
      button's name and the reason list's wording are the owner's too.
    - **The takedown form** (SAF-6), under the review queue: what it is
      (photo or entry), its id, and the notice.
    - **D8's search** is a plain search box with the "Handle or email"
      label, and the filters are three text links; D8's board draws both
      but not their states. JOINED is `YYYY-MM-DD` mono.
    - **Reopen account** on a closed runner's column: D3 draws Close, not
      its undo.
    - **The notice band** (round 27 #20, #21) is the §4a band's shape
      without its retry. #20's "See the community rules" link is left out
      until the rules page exists.
    - **"Email content removed" and "Email ban"** (round 27 #15) are
      built from round 26's template. Content removed says "one of your
      runs" rather than the run's date, and its button is Log in, since
      the board's "See the community rules" has no page yet. The ban email
      names no handle ("We closed your account…") and drops the board's
      "No case number." from its foot; it has no button, as drawn.
37. **Eight placeholders task 126 built into the invite stage (PR 2b-1).**
    **ANSWERED by round 28 (item 9): all eight, with new copy for most of
    them, and one sentence for every refused code. Not built.**
    Round 26 #20 drew Au2's code, Au5, its receipt and D7; these are the
    states it did not draw, each built from existing primitives and copy
    in the register:
    - **Au2 · an empty code** reads "Enter your invite code." on the field.
    - **Au2 · Google with a refused code.** The band belongs to the button
      that failed (Au6), so a refused code on Google is said in Google's
      band — "Not signed in" and the code's own drawn sentence — not on the
      field. A Turnstile refusal on either is `NOT SENT` (round 27 #12).
    - **Au2 · a used code reads as an invalid one** (PR #127 review): the
      drawn "That code has already been used…" told a prober which codes
      exist, so every code that will not work says "That code doesn't
      work. Check it against the email or message it came in." Design is
      asked to confirm, or to draw one sentence that serves both.
    - **Au2 · Google with the code field empty.** An existing account
      signs in (it needs no code); a new one comes back from Google to
      Au2 with Google's band saying the field's "Enter your invite code."
    - **Au1 · Google for an address with no account.** Google can make an
      account only from Au2, so Au1 says in its band "No account uses that
      Google address. Create one first."
    - **Au5 · the limit** (five an hour per visitor on a real deployment):
      `NOT SENT` · "Too many requests from here. Try again at {time}."
    - **Au5's note is one line**, a `TextField` with the drawn label and
      hint; the board's box looks taller. And the way back reads
      "‹ Create an account" — the board's ← is not a glyph the product has.
    - **D7's small states**: a row action that fails is a band opening
      `NOT CHANGED`; Revoke's undo is "Revoked DIAL-XXXX. Undo" in the
      status line for 10 s; Copy link that the browser refuses says "Link
      not copied. Your browser refused."; a new code says "Created
      DIAL-XXXX." Ages are mono `5h` / `3d` (the board's `5H`, in the
      contract's lowercase mono).

38. **Task 128 PR 2b's deltas and undesigned surfaces (PR #129), for
    design round 28.** **ANSWERED by round 28 (item 13), except F's rail
    card by category, which round 28 was not asked: ink for the merge
    words, "RETIRED MAR 2026", "middle", the hatch, and both Edit failures
    reuse a band. The hi-viz kicker conflicts with the Form Contract and is
    sent back to design (D-91, item 40). Not built.** **Built in design PR
    C (2026-10-07), except the kicker:** the ink words, the month-and-year
    date, the hatch and `PHOTO STILL ON`; F's rail card is titled and
    matched by type now that F asks one (R-112). Six the PR shipped, and two its review added. The
    first three ship as built by the owner's decision (D-77); each is the
    build's reading of a board against a contract or an existing pattern,
    and nothing waits on the answers.
    - **Hues on the delete sheet and F.** GOES and SAME NAME are in
      `cold-text`, STAYS and SAVED TO CLOSET in `dialed-text`, as round 26
      draws them. `ink.css` says hue means verdict. **The ask:** confirm
      these words may wear verdict hues, or give them ink.
    - **The PHOTO NOT ADDED band** (`closet/components/PhotoRefused.tsx`)
      keeps `ui/FailureBand`'s grammar: a mono kicker with no hi-viz
      ground. Round 26 draws the kicker on hi-viz. **The ask:** which.
    - **The rail's retired date** reads "Retired Mar 12", the closet's own
      format; the board has "RETIRED MAR 2026". **The ask:** which.
    - **F's rail card by category alone.** "Already in your closet · Top",
      not "· TOP · HALF-ZIP", with "No tops yet." when empty, because F
      asks no type yet (D-75, register R-112) and its category is a select
      that always holds one, so the "no card before a category" state
      never occurs. Expected to resolve itself once the TYPE picker lands.
    - **W3's cell caption.** "Blur by area. Ink = blurred. The focused cell
      outlines its ninth of the photo." is rendered as drawn and the group
      is named "Blur by area"; the middle cell's name keeps "middle" where
      the board's data says "centre". **The ask:** confirm "middle".
    - **A rail thumbnail with no photo** uses the photo ground, not the
      board's hatch. **The ask:** which.
    - **Edit's saved-photo-refused state** (register R-115). Round 26 #4
      draws "F Photo failed" for adding; Edit uses the same state when a
      replacement photo is refused. **The ask:** confirm, or draw Edit's.
    - **A failed photo removal on Edit** (PR #129 review). Not the
      PHOTO NOT ADDED state, which offers a photo nobody was adding: the
      fields stay, and round 23's control failure band sits under the
      well with Y's own Remove kicker, "Photo kept", the cause line and
      Try again. **The ask:** confirm the borrowed band here.

39. **What task 126 PR 2b-2 built beside or without a drawing.**
    **Partly ANSWERED by round 28:** Settings › About (item 7), the reading
    page (item 16), "Keep your account?" (item 12), the deleted handle and
    its `/@handle` (items 4 and 11), and the export states PR #132 adds to
    this item (item 15). The delete sheet's Google flow and the five emails
    below were not asked, and stay open. Legal
    pages, export, deletion and the email hookups, from existing
    primitives and the register's copy:
    - **The legal footer** on the signed-out shell reads only "Privacy":
      Terms and Copyright join (round 27 #12's order) when the owner's
      texts exist. The links show while `/privacy` is still a 404 (D-81).
    - **Settings › About, for design round 28** (decision D-80: it stays).
      U1 draws no About group; the build has one, with one row, "Privacy
      policy · What we keep, and who sees it" (the sub-line is ours), after
      Strava and before Log out. The settings conformance spec leaves it
      out by name until design draws it. **The ask:** draw Settings ›
      About — its place in U1, its rows (Privacy, and Terms and Copyright
      when they exist), and their sub-lines.
    - **Au2's lines** are round 26 #14's privacy line and round 27 #12's
      age line; round 27's "you agree to the Terms" waits for the terms.
    - **The reading page** takes round 26 #14's composition with the
      contract's type (round 27 #5). Two choices of ours: the contents'
      title is mono `CONTENTS`, and "↑ Contents" is a small muted link at
      each section's foot. The page draws no "LAST UPDATED" line of its
      own — the owner's text says its date.
    - **Export** is round 27 #13's emailed ZIP since PR 2b-3 (D-79,
      register R-116): the row's idle and `[ Preparing ]` states and the
      "Email export" are the board's. Undrawn, and ours:
      - **Ready**, on the day a copy was asked for (one a day): the
        sub-line "Emailed. The link works until {day}." (UTC) and the
        action "Download", the row's own link to the ZIP. After the day
        the row is idle again. **Owner kept it (decision D-84), for
        design round 28.**
      - **Failed**, once the queue gives up (law 6): the sub-line "Your
        export didn't work. Try again." with Get a copy.
      - **The press failing** uses round 23's control failure band with
        the kicker "Not started".
      - **A link opened signed out** goes to log in and then to Settings ›
        Account, where the row offers the download; **an expired or
        someone else's link** goes to the row with no message.
      - **The ZIP holds two files the board does not list**: `kit.csv`
        (each garment in each kit, with its flag and note) and
        `profile.csv` (the account and settings, one row), both named in
        the README. **Owner kept both (decision D-83), for design round 28.**

      **The ask (design round 28):** draw Ready and Failed, say whether
      an expired link deserves a line of its own, and add the two extra
      CSVs to the ZIP's list.

    - **Delete account's sheet** follows round 27 #14. For an account made
      with Google, the sheet asks nothing; if the Google sign-in is more
      than ten minutes old, the sheet treats it as a refused field, as it
      does a wrong password: the status says "Nothing saved. One field
      needs a fix.", and "Sign in with Google again to confirm it's you."
      is the field's hi-viz message above the Google button, which takes
      focus. The way back reopens the sheet. "Keep my account" pressed
      after the purge has begun says "Your account is already being
      deleted." Both pages wear the signed-out panel, with the kicker
      `DELETION SCHEDULED` in the cold text cut.
    - **"Keep your account?" says Keep does not restore Strava**: under
      the drawn line, "Strava is disconnected, and stays that way until
      you connect it again." in the quiet body cut — built from the
      Strava email's "Strava is disconnected". The request revoked the
      grant; nothing reconnects it.
    - **A deleted account's old `/@handle`** says "This runner isn't
      here." (decision D-82's words) in the shape of "This runner changed
      their name.": H's column, the back link, the sentence as H's
      empty-state lead. Signing in while the purge runs answers log-in's
      own "wrong email or password".
    - **The handle is not released** at day 7 (D-56, D-72(6); round 27
      #14 said it would be).
    - **The deletion email** is round 27's "Email delete scheduled"; its
      date is the day the week ends, in UTC.
    - **The invite email**'s foot is ours: "You asked for an invite.
      Didn't? Ignore this and nothing happens."
    - **The Strava disconnected email** opens with 127's neutral line —
      "Strava says dialed.run was disconnected…" — because the event can
      be forged; its foot is S1's "Runs you already added stay."
    - **The digest email** (D5) is sent from `hello@dialed.run`, not the
      board's `desk@`, and D5's three rows read as three sentences in the
      one-paragraph template. Its third number is Today's "bans this week",
      not D5's "since yesterday", so the email and the Desk agree.

40. **Do §4a failure kickers sit on hi-viz? (round 28 #13, sent back by
    the owner, D-91).** **CLOSED by round 29 (item 1): the contract is
    right, and a §4a kicker takes no fill. Neither the Form Contract nor
    `docs/product.md` §4 is amended, and round 28 #13b is reversed. Nothing
    to build. The kicker's face (Archivo Black 11 or `MONO.xs`) is
    open item 44.** As raised: not decided, and nothing
    was built differently while it was open.
    - **What the board draws.** Round 28 #13 rules on PR #129's PHOTO NOT
      ADDED band: _"Every §4a kicker sits on the hi-viz ground. Put round
      26's back."_ The round's own failure bands are drawn the same way:
      `STILL CLOSED`, `STILL ACTIVE`, `NOT COPIED`, `NOT CREATED`,
      `NOT SENT` and `NOT STARTED`.
    - **What the contract says.** The Form Contract's failure band: _"No
      fill, no yellow, values untouched."_ `docs/product.md` §4: _"No fill.
      No yellow — yellow means 'the fix is here' and it isn't."_ §4a is
      "the same band", and `ui/FailureBand` builds it with no hi-viz. The
      contract stays in force (D-91).
    - **The ask:** does round 28 mean to amend the Form Contract, so that
      every failure band in the product gains the hi-viz ground, and if so,
      what replaces §4's reason that yellow means "the fix is here"? Or does
      it mean only notice bands (`PHOTO REMOVED`, `BEING CHECKED`, `HIDDEN
WHILE WE CHECK`), which offer no fix and are a different case? Either
      answer arrives as an amended Form Contract, not a board.

41. **The unconfirmed runner's band and sheet, as wired (FEED-11, SAF-15;
    round 26 #11, round 27 #7 and #17).** **ANSWERED by round 29 (items
    10–12), except the last part, which round 29 was not asked: the band
    is not a region and its Resend reports into the screen's region, each
    trigger leads with its own sentence (Share is added, and the email
    change gets one), and the sheet's Resend is an outline pill. Not
    built.** Built to the words; five composition calls no frame makes.
    - **Where the band sits.** Round 26 says "a hairline band at the top
      of Feed and You" and draws no Feed or You with it. It is the first
      thing in each screen's column, above the "Feed" heading and above
      G's identity line, at the column's width. U1 Account keeps it where
      126 put it.
    - **The sheet's lead sentence for the other triggers.** Round 27 #17:
      _"'Sharing…', 'Marking runs Useful…', 'Reporting…' leads, the rest
      stays."_ Read as the trigger's phrase first and the other two after
      it in the drawn order: "Marking runs Useful, sharing and reporting
      need a confirmed address." and "Reporting, sharing and marking runs
      Useful need a confirmed address." An email change (U1's Email page,
      also a WAITS item) has no drawn lead, so its sheet keeps the address
      sentence alone.
    - **Resend link is the shared text link, not an ink pill.** #17 draws
      Resend as the sheet's ink primary. The sheet uses the one Resend
      link Au4, the band and the email change share (round 26's three
      states), so all four read the same; drawing the sheet's as a pill is
      a variant nobody has asked the link for yet.
    - **One status region.** The band's Resend link carries its own
      status line (it was built for Au4, which has no other), so an
      unconfirmed Feed has two regions, the cards' and the band's. Rule
      08 says one. Ask: may the band's Resend report into the screen's
      region, or does a band count as its own?
    - **When the sheet opens, and over what.** The server decides, not the
      page (a page's answer is as old as its loader), so a press always
      asks it and the sheet opens on its refusal. Useful's sheet comes up
      a beat after the press, behind `[ Noting ]`. Report's link opens W1
      for anyone, and the sheet comes up over W1 after Send, leaving W1 as
      it was. One sheet per screen: D's Useful and report open the same
      one, and the control picks its lead sentence.

42. **The terms prompt, and what task 126 PR A built beside a drawing
    (ACC-6, ACC-13; round 28 PR A).** **ANSWERED by round 29 (items 6, 16
    and 17): the prompt is a page with two leads and the owner's WHAT
    CHANGED summary; "Back to contents" and the footer labels are
    confirmed; and `terms.csv` is on the board, with a `how` column. Two
    parts of the prompt are not adopted, because D-95 and D-96 stand.
    Round 30 #4 redraws both parts to D-95 and D-96. Built in design PR E:
    the prompt to rounds 29–30, `terms.csv`'s `how`, and the read-only
    `/account`; what it built beside the drawings is item 50.** Built from
    existing primitives.
    - **The terms prompt (`/account/terms`) is undrawn.** Once the terms
      are published (D-93; nothing is asked until then), a signed-in
      runner whose latest acceptance is below the current version sees it
      before any page, as a leaving runner sees "Keep your account?" — and
      so does a tab left open across the change, whose next refused call
      opens it with no band and no new copy, returning the runner where
      they were after Accept (D-96). Built
      as that page is: the signed-out panel, a `MONO.xs` notice "Terms
      updated" in `cold-text`, the heading "Accept the terms", "The Terms
      have changed. Read them, then accept to carry on." (Terms links
      `/terms`), "Rather not? Log out, or delete your account in Settings."
      (links Settings › Account), and **Accept** / **Log out** in the
      leaving page's two pill styles. Failure bands are §4a's: `NOT
ACCEPTED`, `STILL LOGGED IN`. If the terms change again while the
      page is open, Accept records nothing and says "The terms changed
      again while this page was open. Read them once more." **The ask:**
      draw the prompt — its copy for an account that never accepted any
      version (every account made before ACC-6) as well as for a bump,
      whether it shows what changed, and whether it is a page or a sheet.
    - **"Back to contents" at wide.** Round 28 #16 shows it "only where the
      contents sit above the text (phone and wide)". The build's contents
      are a sticky column from desk up, so the link shows below desk only.
      **The ask:** confirm, or draw wide's contents above the text.
    - **The email footer's Terms and Copyright** read "Terms" and
      "Copyright", after "Privacy policy" (round 27 #12's order; no email
      board draws the three together). **The ask:** confirm the labels.
    - **The export ZIP holds `terms.csv`** (D-95), beyond round 27 #13's
      list and D-83's: every version of the terms the runner accepted,
      with when (`version`, `accepted_at`), named in the README like every
      other file. **The ask:** add it to the board's list, as D-83's two
      were.

43. **What task 126 PR B built beside round 28's drawings (round 28 #9,
    #10, #15, D-89; round 27 #16).** **ANSWERED by round 29 (items 5, 7,
    8, 13, 14 and 15), and built in PR B (#142):** Google's fault band
    sits under the button with the refusals, which keep no Try again;
    the reopen email names the handle ("We reopened @maya_runs.", a new
    optional `handle` on `account_reopened`); Au5's counter goes ink and
    semibold past 140, is the field's description, and is announced only
    at 120 and 141; D7's revoked code is struck through in `--quiet` with
    `REVOKED` in `--quiet` and Undo in ink, Used is `--quiet`, and Send
    invite, Decline and Undo fail on their own rows (`NOT SENT`, `STILL
WAITING`, `STILL REVOKED`), leaving `NOT CHANGED`'s page band to New
    code alone; the made line and `NEW` stay as built; O0's `NOT KEPT` and
    `[ Keeping ]` are confirmed. No ruling here conflicts with a D-row.
    **Not built:** the Au1 frame's own words for the fault ("Not logged
    in" · "Google didn't answer. Try again?") — #13's Build moves the band
    and nothing else, so it keeps round 22 Au6's "Not signed in" and
    sentence, and Au6's redraw is item 44's; and D7's STATE column as
    words (UNUSED, USED, REVOKED), where the build shows uses as a count.
    Built from existing primitives.
    - **Google's two band positions.** Round 22's Au6 draws the fault band
      ("Google didn't answer", with Try again) _above_ the button; round 28
      #9 draws the refusal bands (`NOT CREATED`, `NOT LOGGED IN`) _under_
      it. Each is built where its board puts it. **The ask:** one place
      for both, or confirm the two.
    - **The refusal bands carry no Try again**, only the link the board
      draws (Request access, Create an account), or nothing for "Enter
      your invite code above". The frame is the failure band's (1px ink,
      no fill). **The ask:** confirm.
    - **Au5's counter** reads `128 / 140` in `MONO.xs`, muted, under the
      note's field, from 120 characters; past 140 it keeps counting and
      the schema's "Keep the note under 140 characters." refuses on send.
      Round 28 #9 asks for a counter from 120 and draws none. **The ask:**
      draw it.
    - **D7's `NEW` tag** is `MONO.xs` on hi-viz with `accent-ink`, the
      board's look; the made line `DIAL-7QX2 MADE · LINK COPIED` is
      `MONO.xs` in ink, not the board's teal (no T1 role names teal for
      text on the Desk). The `NOT COPIED` band shows the link in a
      read-only, selected field. A copy at the moment of making can fail
      where a press would not (browsers want the press itself), which is
      exactly when the band shows. **The ask:** confirm the made line's
      colour.
    - **D7's other row actions** (Send invite, Decline, Undo) keep the
      page-level `NOT CHANGED` band; only Revoke's failure is drawn, as
      `STILL ACTIVE` on its row. **The ask:** confirm, or draw the others.
    - **The reopen email (D-89)** says the board's sentence, then "You can
      log in, and your runs are back as you shared them.", a Log in
      button, and the foot "Your handle is still yours." No email board
      draws it. **The ask:** draw "Email reopen".
    - **O0's re-pick (round 27 #16)** is built as drawn, plus two states
      the board does not draw: Keep failing (§4a's `NOT KEPT`, Try again)
      and Keep in flight (`[ Keeping ]`). Save username's failures are the
      field's own. **The ask:** confirm.
    - **#10's lockout on Change password.** The sentence is built where a
      per-runner count exists (Change email and Delete account). Change
      password goes through Better Auth's own endpoint, whose limiter is
      per request, so it still answers with the band's "Too many tries.
      Wait a minute, then try again." (register R-124).
44. **The failure-band kicker's face: two contracts disagree (round 29
    #1).** **ANSWERED by rounds 30 and 31–32. Nothing to build. Round 30
    (items 1–3): the kicker is `MONO.xs`, ink, caps, and `tokens.js`
    COLLAPSE now says so, with no new step; Operator Screens D0 and D6 are
    redrawn to D-87's rail. Au6 lives on `Auth.dc.html`, not on
    `Round 22 Coverage.dc.html` as this item said, and rounds 31–32 redraw
    it with Google's band under the button, as round 29 #13 ruled.** Round 29 settled the fill (none) and restated
    the face, and that face is not one `tokens.js` has. No owner call is
    needed: it is design's to reconcile, in the contracts. Nothing is built
    differently while it is open, and `FailureBand` keeps `MONO.xs`.
    - **One side.** Round 29 #1: _"Archivo Black, 11px, capitals, ink,
      inside the 1px ink band."_ The Form Contract's 02b samples draw the
      kicker that way (Archivo Black, 11px, 0.12em, uppercase), and
      `docs/product.md` §4 says _"Kicker in Archivo Black, uppercase, 11px:
      `NOTHING SAVED`."_
    - **The other side.** `tokens.js` has no 11px step in the display
      family (TYPE.display is 32px, and the smallest display step,
      TYPE.heading, is 19). Its uppercase rule rejects _"text-transform:
      uppercase on any --type-\* step except display"_ and allows it on
      _"MONO.xs / MONO.sm / TYPE.display only"_. Its COLLAPSE maps
      _"'0.12em' board eyebrows"_ to _"MONO.xs → 0.10em (0.12 was the
      document-board eyebrow, not the product)"_. `ui/form.tsx`'s
      `FailureBand` draws the kicker as `<Mono step="xs">`.
    - **The ask:** reconcile them in `tokens.js`. Either name the kicker's
      step there (and the build ports it, as round 28's field tokens were
      ported), or say the kicker is `MONO.xs` and amend the Form Contract's
      samples and `docs/product.md` §4 to match.
    - **Two boards round 29 says it redrew did not change.** Round 29 #2
      says _"Operator Screens D0 and Round 28 #14a are redrawn to this
      order"_, and #13 says _"Round 22's above-button frame is redrawn"_.
      `Operator Screens.dc.html` and `Round 22 Coverage.dc.html` are
      byte-identical to round 28's bundle, so D0 still draws the old rail
      and Au6 still draws Google's fault band above the button. **The ask:**
      redraw both, D0 in D-87's order.

45. **A flagged handle's review row: Keep and Rename (decision D-97;
    task 126 PR B, in lane 128's Review queue).** Undesigned; built from
    the review row's own parts. A row about a runner whose handle the
    hourly re-ask flagged (`username_screen = 'flagged'`) offers **Keep**
    (a text button, as Approve is) and **Rename** (the row's submit),
    with D8's "Why the name has to go" picker and its four reasons, and
    no Approve, Remove or Remove as suspected CSAM. A placeholder that is
    taken keeps the row and says D8's "That placeholder is taken. Press
    Rename again." The row's header and `[classifier]` tag are the queue's
    own. **The ask:** draw the flagged-handle row, and say whether it
    should name why it is there (it reads as any classifier row today).

46. **The onboarding close still says "you never type it" (round 34
    import).** Round 34 qualified that claim on the marketing site, because
    R2b lets a runner set conditions when the archive has no record for the
    hour, and kept A1's "Never typed by hand." because it sits on a fetched
    block. `V1 Screens.dc.html`'s onboarding close ("What happens as you
    log", built as `onboarding/components/NowGoRun.tsx`) still reads
    "Weather attaches itself from your GPS and the time — you never type
    it." It sits on no fetched block, so the reasoning that kept A1's line
    does not cover it. The build matches the board, which is authoritative
    for a built screen, so nothing changes until design rules. **The ask:**
    keep the line as written, or qualify it as M1 step 01 was ("fetched for
    when and where you ran").

47. **Two "was" values in T1's new notes are the new value (round 34
    import, erratum).** Theme's Muted row says it "was #6E6E64 at 3.9:1"
    and the Placeholder row says it "was #6E6E64 / #8B8B93, under 3:1 /
    3.7:1". The old values were #7A7A70 (Muted, paper) and #9A9A90 /
    #6E6E74 (Placeholder), as round 33's T1 and `design/docs/product.md`'s
    "Round 33 · Contrast and lint fixes" both say. The board-wide
    `#7A7A70 → #6E6E64` replacement looks to have reached the history in
    the notes too. Nothing reads the notes column, so the port is
    unaffected. **The ask:** correct the two notes.

48. **M5's optional note: placement, label and hint (decision D-112).**
    The owner gave M5 Au5's optional note. The marketing site built it to
    match Au5: "Note · optional", the hint "Where you run, or who sent you.
    One line.", 140 characters with a counter from 120. M5 draws one
    field. **The ask:** draw the note on M5, or confirm Au5's placement.

49. **"Confirm your email first" from Follow, and before the address
    arrives (design 133, decision D-113).** Follow now waits for a
    confirmed address, as Useful and report do: a follower count is
    something other runners see. Round 27 #17 gives the sheet a lead
    sentence per trigger ("Sharing…", "Marking runs Useful…",
    "Reporting…") and none for Follow, so a refused Follow opens the sheet
    with the address alone, as the email change does. The sheet now opens
    from the root, which asks for the address as it opens; for the moment
    before it arrives, or if it cannot be read, the body is the lead
    sentence alone, with no address line and no Resend. **The ask:** a
    lead for Follow ("Following runners…"?), and whether the
    no-address-yet state needs drawing or the brackets should breathe in
    the address's place. **Round 29 #11 answered the email change** ("Confirm
    this address before you change it.", built in design PR E) and struck
    round 27's list, so each lead names only the refused control; Follow
    is still undrawn.

50. **What design PR E built beside rounds 29–30's drawings (round 29 #6,
    #11–13, #17; round 30 #4; D-95, D-102).** Built from existing
    primitives. Each is a reading of a drawing or a contract, not a
    question that blocks anything.
    - **Au6's band is not a second `role="status"`.** Round 33's Au6 and
      round 29's Google frames mark the control failure `role="status"`.
      The Accessibility Contract's rule 08 allows one status region per
      screen, and the page's own already speaks the band's words, so the
      build keeps one and the band is announced through it (the contract
      outranks the board). Google's refusals are the same `control-failure`
      region, as round 29 draws them. **The ask:** drop the role from the
      frames, or say when a band should be its own region.
    - **D-102's line names every form page, two of them in words of the
      build's choosing.** Any refused save gets the line: every form's,
      and Attach's (a control that holds the runner's picks). A route may
      name itself in the runner's words (`staticData.savedPage`: "Log a
      run", "Add a piece", as round 30 #4b gives them); any other page is
      named by its heading, so the edit page is "Edit Harrier". A2's and
      A3's headings are questions ("What did you wear?", "Did it work?"),
      so the build names them "Attach the kit" and "The verdict", after
      product.md's screen names. A refused control or loader gets no line.
      **The ask:** confirm those two names, or give them.
    - **Log out in the escape line is a button with a 44px target.** Rule
      03's inline exception is for links, and Log out is an action, so it
      keeps `target` and the line is a little taller than the board's.
      **The ask:** none unless design wants the inline target for buttons.
    - **The read-only `/account`'s Strava row says "Connected", not
      "Connected as Maya R."** The athlete's name is Strava data, which
      the app never stores, so the row says what T3a's status line says:
      "Connected", or "Not connected". It comes last, after Email,
      Username and Password (the ordinary page edits all three), where
      round 30 puts Strava in Settings › Account. The board draws no
      tokens row, so there is none. **The ask:** confirm the value.
    - **WHAT CHANGED's kicker is `MONO.xs` in `--muted`** on `--tint`, a
      plain list with a `·` before each line, under the lead and above
      "Read the full Terms". The owner writes the lines in the terms' front
      matter (`changed:` beside `published: true`), and v1 has none, so the
      block does not show yet. **The ask:** none.

51. **What design PR A built beside round 28's W3 and Review drawings
    (round 28 #5 and #8).** Composed from existing primitives and copy; no
    new glyph, colour or motion.
    - **W3 with blur off also waits for Use this photo.** The board draws
      W3 with blur on. With blur off the step shows the toggle and its
      line and still holds the redrawn photo until Use this photo, so the
      runner can turn blur on before anything is attached.
    - **Use this photo before the bytes exist** (while checking, or after
      a redraw that failed): `aria-disabled` and `aria-busy`, with no look
      of its own; the line above says "Checking this photo…".
    - **The lines the board does not draw** keep their words: after a tap
      ("We blurred 2 faces. You blurred 1 more spot. Tap one to undo.")
      and with no detector ("We couldn't check this photo. Tap anything you
      want blurred."). The first now sits beside round 28's "Auto-blur
      covered 2 areas." vocabulary. **The ask:** reword both in Auto-blur's
      grammar, or confirm them.
    - **W3 is inline, not a sheet.** The head draws "Check the blur" and
      Cancel, but the step renders where its host puts it; the sheet is
      the hosts' work (design PRs C and D).
    - **An entry, not a photo.** The CSAM question and the takedown
      sentence take the subject's own noun: "Remove this entry everywhere
      and keep the evidence for the report?" and "We removed this entry
      from the feed after a copyright notice." The board draws a photo.
    - **The review row's opener** is the row's name as a button with
      `aria-expanded`, and the CSAM question carries the kicker "Remove as
      suspected CSAM" above it.
    - **A photo W3 cannot prepare** — the file will not decode, or the
      blurred canvas makes no file — is the round 23 control-failure band:
      "PHOTO NOT ADDED · This photo couldn't be prepared. Pick another
      photo, or cancel." Use this photo is not drawn while it shows (there
      is nothing behind it); Try again decodes again. A detector that
      throws is not this band: it is the "couldn't check" line, because the
      photo can still be blurred by hand. **The ask:** confirm the words,
      and whether Use this photo should go or stay disabled.
    - **Pick another refuses what the well refuses** (type and size, the
      same `photoProblem` sentences), as the field message under it; the
      photo already checked stays.
    - **Focus on close.** W3's Cancel, Esc and Use this photo return focus
      to the photo well's input (Replace, once the well is filled); Cancel
      in the CSAM question returns it to "Remove as suspected CSAM";
      deciding a row opens the row that takes its place (the next, or the
      one before when it was the last), and deciding the last row focuses
      the "Nothing waiting" line.

52. **What design PR C built beside rounds 26 and 28's closet drawings
    (round 26 #4 and #10, round 28 #5 and #13; D-75, R-112, R-114).**
    Composed from existing primitives and T1; no new glyph, colour or
    motion.
    - **The type names.** Round 26 names four, for tops: Singlet, Tee,
      L/S crew, Half-zip. The contract has nineteen
      (`garmentTypesByCategory`), so the build names the rest after the
      pack's glyphs: Jacket, Vest, Sports bra; Shorts, Half tights,
      Tights; Cap, Beanie, Headband; Neck gaiter; Gloves; Socks; Shoes;
      Sunglasses, Arm sleeves. The rail's empty line takes a plural of
      each ("No half-zips yet.", "No L/S crews yet.", "No shorts yet.").
      `closet/type-labels.ts` holds both. **The ask:** confirm or give
      the names.
    - **No TYPE where a category has one type.** Gloves, socks, shoes and
      neckwear have a single type each, so F asks nothing there and the
      rail stays the category's. **The ask:** none unless design wants a
      one-chip group.
    - **TYPE sits under CATEGORY**, as drawn, but F still leads with
      Brand and Name (D-27's identity-first order), where round 26's desk
      frame puts Category and Type first. CATEGORY is still the build's
      select, so "before a category: no card" still never happens. A
      picked chip can be changed but not cleared, which is the radio
      group's grammar; a new category clears it. **The ask:** the order.
    - **The product's type yields to the runner's.** A product match used
      to set the type outright (Z3's "it was never a question"); now it
      fills in only where TYPE was left unanswered. Y's kicker names the
      type too, as Z2a draws it (`TOP · HALF-ZIP · M`). **The ask:** none.
    - **The hatch** is `ink.css`'s `.photo-hatch`: T1's photo fill with
      `--hairline`, the next step darker on paper and lighter on ink, as
      Theme's "Photo fill" row says, drawn by the same rule as the ink
      channel's partial mark — its 135° angle and 2-on, 3-off rhythm,
      the only hatch the system has, because no contract gives a photo
      hatch's rhythm. **The ask:** a rhythm, if not that one.
    - **`PHOTO STILL ON`'s sentence** is the control band's cause line
      ("Our end failed.", or the connection's), as every control band's
      is, rather than 02b's "That didn't go through. Try again?"; the
      band's Try again says the rest. **The ask:** none unless design wants
      the fixed sentence.
    - **W3's sheet is named "Check the blur"**, its own head, for the
      moment before focus lands on the heading. **The ask:** none.

53. **What design PR D built beside the Feed board and rounds 27–29's feed
    rulings (task 129, 2026-10-07).** Composed from existing primitives,
    T1 roles and the icon manifest; no new glyph, colour or motion.
    - **The photo delete button's ground.** Round 27 #26 draws "a 44×44
      icon button, top-right of each photo" and round 28 #14 names the
      `remove` glyph; neither draws what it sits on. It is a `--ground`
      pill with the glyph in ink at 20px, as D's `1 / 2` counter already
      sits on `--ground`. **The ask:** the fill and inset, if not that.
    - **The tag's accessible name inside the card's link.** The brackets
      are hidden from assistive tech and the sentence ("Under review, only
      you can see this") is said in their place, so the card link reads
      "@handle, …, Under review, only you can see this". **The ask:** none
      unless design wants the sentence elsewhere.
    - **`[UNDER REVIEW]` on G's Recent entries** sits after the entry's
      label, inside its link — round 28 #6 says G uses the tag but G's row
      is not drawn with one. **The ask:** its place on the row.
    - **The card's `1 / N` on a lone photo** reads `1 / 1`, as D's pager
      does; the board draws only a two-photo card. **The ask:** none
      unless a lone photo should carry no counter.

54. **The consensus words when groups overlap (round 27 #25, design PR D
    review).** The ruling reads "Leading bar \"Most\", the rest \"Some\". A
    tie for the lead reads \"Split\" on each tied bar. A single bar reads
    \"All\"." — written as if each runner sat in one bar. They do not: a
    runner counts in every group they wore, and rows under 2 runners drop,
    so the bars do not sum to the runners and a lone bar can be 3 of 14.
    The build follows the ruling as written (`feed/bar-share.ts`): the one
    leading bar is "Most" whatever its share (5 of 14 included), a tie for
    the lead is "Split", every other bar is "Some" (11 and 9 of 14 read
    "Most" and "Some"), and a lone bar is "All" — including 3 of 14, which
    reads as every runner wearing it when most matched runners did not.
    **The ask:** confirm the words rank the bars rather than claim a share;
    and say what a lone bar short of every runner reads ("Most"? "Some"?),
    and whether a bar every runner wore reads "All" beside other bars.

55. **Gave up's words and one control no board draws (design-adoption PR
    B; R-119).** Built from D6 and round 29 B·2 with existing primitives
    only, and each is the build's guess:
    - **The reasons.** D6 draws "The shop returned 403 three times. It may
      be blocking us." A dead letter is handed the job and not its error
      (each try's error went to Sentry), so its row reads "It failed every
      try the queue gives a job, so the queue stopped. Each error is in
      Sentry." Enrichment's refusal reads "The shop returned 403. It may be
      blocking us." (401 and 403), "The shop returned 404." (any other
      status), or "The shop's page couldn't be read."; weather's cap "No
      weather came back for this run in five hours of hourly tries.", and
      for a run failed again after a Retry (or entered past its window),
      which had one try, "No weather came back for this run on its latest
      try, made after its five-hour window had closed." An enrichment row
      appears only once the hourly sweep stops re-driving the product (its
      first day), so its tries are that day's.
    - **What each row was doing**, for the two jobs D6 does not draw: "Read
      @sam's run file" (an import) and "Remind @sam about a new run on
      Strava" (a dead-lettered reminder); a subject since deleted reads
      "Read the page for a product that is gone" and the like. The kind
      captions are Enrichment, Conditions, Import, Reminder.
    - **The raw error's "one click away"** is a native disclosure labelled
      "Raw error" (MONO.xs, muted), the error under it at MONO.md.
    - **Re-run extraction with no stored page** is the pill at `--hairline`
      with `--muted` text, `aria-disabled`.
    - **A retry or a drop that fails** says "Still here" plus the cause in
      the row's control band (round 23 #9).
    - **The digest's line**: "N jobs the system gave up on. They're on the
      Desk's Today." after the three, and the subject adds ", N gave up"
      when above zero (a zero day's "Nothing failed." would be false).
    - **Ages and times** are UTC, like Today's date: "2d ago", "last 04:12",
      "last Sep 15 22:40".
      **The ask:** confirm or redraw each.

## Answered in round 34 (imported 2026-10-04)

Design sent round 34 with `Theme.dc.html` as the primary file. It carries
two things. **"Round 33 · Contrast and lint fixes"**, new to
`design/docs/product.md` in this bundle although it is titled round 33,
folds two greys into `--label` and rewrites one `tokens.js` lint rule.
**"Round 34 · M4 copy review"** answers the marketing-site agent's Phase 1
copy questions (`dialed.run-site`, D-105). No board was added and no
screen's composition or words changed: apart from the Marketing Site's two
copy lines, every board diff is the grey replacement below. No open-queue
item is answered; the round raises two (items 46 and 47).

Design changed 35 files:

- `Theme.dc.html`: T1's Muted and Placeholder rows, and the board's own
  greys.
- `tokens.js`: the `no-raw-spacing` lint rule, and a new `LINT_FIXTURES`.
- `Accessibility Contract.dc.html`: 02 · Contrast floors.
- `Marketing Site.dc.html` and `- Dark`: M1 step 01 and the weather FAQ.
- `Round 21 Rulings.dc.html`: #6's `.run` value now names `#6E6E64`.
- `design/docs/product.md`: anonymous totals' Scope line, "Round 33 ·
  Contrast and lint fixes" and "Round 34 · M4 copy review".
- Every other board (Auth, Brand Brief, Call Epic, Desktop and Form
  contracts, Feed, Flow Map, Icon Pack, Logo Directions, Motion Doctrine,
  Onboarding, Operator, Product, Remaining and V1 Screens, both themes,
  Round 22 Coverage and Round 25–32 Rulings): `#7A7A70` and `#9A9A90` become `#6E6E64`
  on paper, and `#6E6E74` becomes `#8B8B93` on dark. A script that applies
  those three replacements to round 33's files and diffs the result
  against round 34's finds no other change in any of them.

### The contracts

1. **Theme, T1. Code port required (R-133).** `--muted` on paper goes from
   `#7A7A70` (3.9:1, which failed AA for the MONO captions round 31 gave
   it) to `#6E6E64`, the same as `--label`; dark stays `#8B8B93`. The
   name stays, so caption code keeps reading `--muted`. `--placeholder`
   goes from `#9A9A90` / `#6E6E74` to `#6E6E64` / `#8B8B93`, also
   `--label`'s values ("axe doesn't check placeholders"). A value still
   reads apart from a placeholder because a value is `--ink`, and disabled
   labels take the same grey. T1 gains and loses no roles; two now share
   `--label`'s values in both columns. The notes column records the old
   values wrongly (item 47).

   **This import fails `test/ui/contrast.dom.test.tsx` until R-133
   lands.** That test reads T1 from `design/Theme.dc.html` and pins
   `src/ui/tokens.css` to it. Measured against the imported files, three
   cases fail: `--muted` light (`#7a7a70`, expected `#6e6e64`), and
   `--placeholder` light (`#9a9a90`) and dark (`#6e6e74`, expected
   `#8b8b93`). `test/ui/tokens.dom.test.tsx` passes unchanged. The port is
   `tokens.css`' two light values and the ink block's `--placeholder`
   (which can read `var(--muted)`, as `--label` already does), then
   `email/palette.ts`'s `muted`, which `test/email/palette.dom.test.tsx`
   pins to `tokens.css`, and the three `#7a7a70` strings in
   `test/email/render.test.ts`. `ops/og/palette.ts` is drawn on ink and
   its `#8b8b93` is unchanged.

   **A side effect on e2e conformance.** `e2e/support/conformance.ts` maps
   a hex back to a T1 role, and the last row for a hex wins. `#6E6E64` and
   `#8B8B93` now belong to three rows each, so a caption, a label and a
   placeholder all report as `--placeholder`. Comparisons stay correct,
   because the board and the app go through the same map, but a diff can
   no longer tell `--muted` from `--label`. No conformance spec asserts a
   grey by name: the colour checks in `a1-upload`, `a2-attach`,
   `a3-verdict`, `r-run` and `auth-parts` read fills and borders. Text
   signatures carry no colour, and no app board's text changed, so no
   conformance spec should move.

2. **`tokens.js`. No code change.** `LINT`'s `no-raw-spacing` now checks
   the whole value: shorthands (`0 20px`), mixed values (`var(--space-4)
20px`), negatives, longhands, camelCase JSX properties and unitless JSX
   numbers. It no longer misreads `border-top: 1px` as `top:`.
   `LINT_FIXTURES` gives the cases a plugin's test must reject and pass.
   The app ports `LINT`'s intent, not its CSS patterns (proposal 113), and
   that port is R-76, still waiting on the owner because `eslint.config.js`
   is a forbidden zone. When R-76 lands, two places write raw spacing on
   purpose and need an exemption: `email/EmailLayout.tsx`, because an
   email client reads no custom property, and `ops/og/cards.tsx`, because
   Satori lays out from inline numbers. The app's `@theme` port reads no
   `LINT`.
3. **Accessibility Contract, 02 · Contrast floors.** It restates T1:
   `#6E6E64` is the lightest grey that carries text on paper, and lighter
   greys are hairlines only. No separate code change beyond R-133.
4. **Form and Desktop contracts.** Only the grey replacement. The Form
   Contract's placeholders become `#6E6E64`, which is R-133's
   `--placeholder`.
5. **`motion.js`, `icons.js`.** Unchanged. `Motion Doctrine.dc.html` and
   `Icon Pack.dc.html` changed only their greys, and the icon manifest
   needs nothing.

`test/architecture/annotations-are-not-copy.test.ts` reads every board's
annotations. No annotation markup changed in this round, only colours and
two marketing lines, so it should pass unchanged; CI runs it with the rest
of the worker suite.

### Built screens

Every built screen that wears `--muted` or `--placeholder` on paper changes
colour with R-133, since the boards for all of them now draw `#6E6E64`.
That is one token port, not a per-screen gap. No board for a built screen
changed composition, words or states.

One sentence on a built screen is now inconsistent with the round's own
reasoning: the onboarding close still says "you never type it" (item 46).
The build matches the board, so it waits for design.

### Round 34 · M4 copy review: marketing site only

Each of these is for `dialed.run-site`, and none needs app work:

- **a · Weather.** M1 step 01 now reads "From Strava or a file. Weather
  comes with it, fetched for when and where you ran." The FAQ answer to
  "Where does the weather come from?" now reads "Visual Crossing, for the
  time and place your run started. If there's no record for that hour,
  you set it yourself, and that run stays out of the guides." Brand
  principle 02 stands, because those runs never reach the totals. In-app
  A1's "Never typed by hand." is unchanged, because it sits on a fetched
  block.
- **1 · The loop** (TYPE.lead) is rewritten: "Log the run from Strava or a
  file, and the weather comes with it, fetched for when and where you ran.
  Then say how it went, from way cold to way warm, and which piece was off
  if one was. That takes ten seconds, and every run you log adds to your
  record."
- **2 · The call** is confirmed as written.
- **3 · #totals** (TYPE.body, bold lead-ins, second person) gives three
  paragraphs: _What's counted_, _When a figure shows_ and _Who counts_.
  They state D-108's A, B and C in public words.
- **b · Region.** Keep the region line. It is disclosure, not a feature
  claim: D-108 A says the job reads region, so the page says so before
  region slices ship.
- **c · No shared-only fallback copy.** Before public launch Phase 1 is
  Home and Invite only, so M4, the FAQ and #totals publish with the app.
  If launch goes shared-only, M4 waits for a copy pass then.
- **d · "Brand and model"** in public copy; "catalogue" stays internal.

### Against the owner's decisions

Nothing contradicts a recorded decision, so no `docs/decisions.md` row
changes.

- **D-108 C** excludes "manual-temperature runs". Product's Scope line now
  says "runs whose conditions the runner set in R2b (SET BY YOU)", and
  notes the old word named the form round 22 removed. In the build these
  are the same runs: an R2b band is a `manual_conditions` row, the only
  manual weather there is (`db/schema-weather.ts`). This restates D-108;
  it does not change it.
- **D-108 A and B** are what #totals says, in public words: feels-like,
  sky, month, type, brand and model, verdict and region; never name,
  handle, notes, photos, start location or time of day; 5 runners, or 20
  for a brand. D-108 makes the Terms and Privacy wording the owner's legal
  text. #totals is marketing copy, not that text, but it describes the
  same rule, so the owner may want it read beside the privacy policy
  before M4 publishes.
- **D-24 and CLAUDE.md** ("Weather is never typed by a human as the
  default path"). The qualified marketing copy agrees with both, and is
  more exact than "You never type it" was.
- **D-105** puts the site in its own repo; every copy item above is that
  repo's.

## Answered in round 33 (imported 2026-10-03)

Design sent round 33 at 23:14. It adds one board, `Day 2 Groups.dc.html`,
and a section at the end of `design/docs/product.md`, "Pre-launch: audience
model". No contract file changed, and nothing needs a code port.

**The pre-launch half is decided (D-109).** Visibility becomes an audience:
`'private' | 'groups' | 'runners'`, plus the groups an entry goes to, which
is empty at launch. Launch uses only the two ends, and the copy does not
change. Every audience check reads the audience, never a boolean, so groups
can ship later without rewriting existing rows. The export's `visibility`
column becomes `audience`, and the read API's `visibility` word gains
`groups` additively under `/v1`. Both write the UI's words (`shared`,
`private`); `runners` stays internal. The board's `group_ids[]` lands with
groups, as a join table. The build is R-129, scheduled next.

**The groups half is parked, not scheduled.** The board is direction only.
It covers:

- the model: auto-share per membership, with no per-run group picker;
  three join types (open, request, invite); follows unchanged; group-only
  runs counted in anonymous totals under D-108;
- two sketches: A3's audience as three choices, shown only once the runner
  is in a group, and a group page with "This morning", what the club wore in
  today's weather;
- seven open questions, each with a lean: who creates groups, leaving,
  admin powers, reports inside a group, where groups live in the feed, size
  and count limits, and group pages on the marketing site.

Those questions need the owner's decisions before design starts, so none
of them is recorded here as decided.

## Answered in rounds 31–32 (imported 2026-10-03)

Design sent both rounds at 22:42, after round 30's rulings. **Round 31** is
six contract edits for marketing-site Phase 1, on `Round 31 Rulings.dc.html`.
**Round 32** answers the question round 30 left open, anonymous totals, on
`Round 32 Rulings.dc.html`. `design/docs/product.md` mirrors both, plus a
"Round 33 · Sync after round 30" section that restates the owner's round 30
rulings (D-99 to D-107) and redraws Au6.

**One contract file changed, and nothing needs a code port.** `tokens.js`
gains `MARKETING.hero`, a step outside the eight for the marketing site's
two cover pages: `clamp(44px, calc(28px + 4.05vw), 76px)`, line-height 0.95,
tracking −0.035em, caps, Archivo Black. It is "the only fluid size in the
system" and "never appears in-app". `CSS_VARS` exports it as `--type-hero` /
`--track-hero`, and COLLAPSE maps "44–76px marketing hero" to it, the
48–64px marketing page h1s (M2, M3, M4, M6, M7) to TYPE.display, and the
19px marketing lead to TYPE.lead. The app's port reads only TYPE, MONO,
SPACE, HEIGHT, RADIUS, BREAKPOINT and MEASURE, so `src/styles.css` gains
nothing. `test/ui/tokens.dom.test.tsx` and
`test/architecture/annotations-are-not-copy.test.ts` pass against the new
files unchanged. The hero step is the marketing repo's to port.

Design changed six files and added two:

- `Round 31 Rulings.dc.html` and `Round 32 Rulings.dc.html` (new).
- `tokens.js`: `MARKETING.hero`, its CSS vars and three COLLAPSE entries.
- `Marketing Site.dc.html` and `- Dark`: the `[dialed.run]` wordmark, M5b's
  copy, the dark ink blocks, round 32's copy, and M7's changelog drafted by
  Claude.
- `Auth.dc.html`: Au6's Google band moves under the button.
- `Integration Opportunities.dc.html`: 02 redrawn as a general read API, and
  04 records the owner's rulings.
- `Round 30 Rulings.dc.html`: frame 6f, the token-created email.
- `design/docs/product.md`: "Round 31", "Round 32" and "Round 33 · Sync".

**Round 31 · Marketing site, Phase 1.** "The contracts win. One new step,
and it's only for covers." T1 gains no roles. Every item is **new:
marketing site** work, in the separate `dialed.run-site` repo (D-105),
unless it says otherwise.

1. **Hero size.** `MARKETING.hero` (above), on the M1 and M8 h1s only. M2,
   M3, M4, M6, M7 and the 404 use TYPE.display (32), because "a guide's h1
   is a long sentence, and at 76 it would wrap to four lines". The board's
   19px leads are TYPE.lead. _Build:_ marketing site, S.
2. **The Call card surface.** _Light confirmed, dark corrected._ Light is
   `data-ground="ink"`, which takes T1's dark column. Dark is `--panel` with
   a 1px `--hairline`, T2 04's fallback for an ink block, not `--tint`
   ("for recessed notes"). The guide strip, the M3 invite card and the M8
   data card follow the same rule; in dark the strip is a full-bleed
   `--panel` band with hairlines top and bottom. _Build:_ marketing site, S.
3. **Off-table hexes.** _Mapped to roles, not hexes._ `#2A2A26` → `--ink`.
   `#24242B` → `--hairline` in the ink scope. `#A0A0A6` was a drawing
   error: it is the dark side of `#4E4E44`, which is `--quiet`, whose dark
   value is `#B9B8AE`. Prose on paper (FAQ answers, footer, sub-lines) is
   `--quiet`; MONO captions and eyebrows are `--muted`. `#DEDDD6` →
   `--ink`. `#E9E8DE` (bar tracks) → `--tint`. _Build:_ marketing site, S.
4. **M4's verdict scale.** _The real component, Dialed selected._ A3's
   `verdict-row`, static and not interactive (`role="img"`, label "Verdict
   scale: way cold to way warm, Dialed selected"): the teal slot with ink
   text, and four hairline slots with MONO.xs ink words. "The page shows
   the one state that has no cold hue, and the only pink stays the CTA."
   _Build:_ marketing site, S. It imports A3's component, so it needs the
   markup and the two-line words, not a redraw.
5. **The changelog, the 404 and app paths.**
   - **5a · Zero entries:** no page, no footer link and no feed until entry
     1 exists; before that `/changelog` is the 404, and there is no
     empty-state copy.
   - **5b · The 404:** the legal layout, status 404, `noindex`, the same nav
     and footer. MONO.xs "404" · "Nothing at this address" · "The link may
     be mistyped, or the page has moved." · Home › / What to wear › (only
     once a band is published) / How it works ›. "No search and no invite
     CTA: a 404 is a wrong turn, not a sales moment." Title "Not found ·
     dialed.run".
   - **App paths:** before any 404, `/feed`, `/login`, `/join`, `/account`,
     `/reset`, `/confirm` and their children answer 301 to
     `app.dialed.run` with the path and query intact.
   - **5c · M5b:** "When your code is ready we'll email you." No address
     echo. The "nearest guide" link is the coldest published band, chosen
     at build time, or left out.

   _Build:_ marketing site, S.

6. **The favicon, the OG card and the wordmark.** _Direction 08, already
   ruled._ Icons stand as round 26 #22: `[d]` on an ink tile, favicon.svg,
   .ico at 16 (brackets only) and 32, apple-touch 180, manifest 192 and 512
   plus a 512 maskable, `theme_color` `#0B0B0E`. "The SVG is shared with
   the app." **The default OG card** is a 600×315 layout rendered at 2×
   (1200×630): ground `#0B0B0E`, padding SPACE[8], the wordmark in
   TYPE.title top left, "Wear what worked." in TYPE.display bottom left,
   MONO.sm "DIALED.RUN" in `--muted` bottom right. It is one card for every
   URL on both hosts, with a per-page og:title on the marketing host and
   "dialed.run" on the app host, built once and static. **"Wear what
   worked." replaces round 27's "Log runs, see what worked."** Marketing
   adopts the full wordmark, `[dialed.run]` with `--action` brackets and
   `.run` in `--muted`; the boards' bare `[dialed]` is corrected, which
   closes round 30's wordmark erratum. _Build:_ marketing site, S, plus
   **two app-side items, lane 125:** the icon set, since the favicon SVG
   is shared with the app; and the default OG card, `ops/og/cards.tsx`'s
   default with round 31's layout and line, served by the app host too
   (D-107).

**An app-side task for the marketing site: a public request-access
endpoint.** _Build:_ 126, M, needed for public launch.
`POST https://app.dialed.run/api/access-requests`, form-encoded (`email`,
`note`, `cf-turnstile-response`). It verifies Turnstile server-side and
applies the existing same-answer rule and rate limits. On success it answers
303 to `https://dialed.run/invite/sent`, and otherwise 303 to
`/invite?error=turnstile|invalid_email|rate_limited`. The Turnstile site
key's allowed hostnames gain `dialed.run`. Once the marketing site is live,
the app's request page (Au5) redirects to `https://dialed.run/invite`. M5
draws one field (email), so whether the site sends `note` is the marketing
repo's call; the endpoint accepts it.

**Round 32 · Anonymous totals.** "Private means nobody sees it. It doesn't
have to mean it never counts." _Ruling: the middle path, with five
conditions._ "The bias argument decides it, more than volume does. A guide
built only from shared runs is a guide built from the runs people were
proud of, so it would overstate 'dialed' exactly where runners need the
truth." What would break it is "a runner finding out from a screenshot
instead of from us, and a figure small enough to point at one person",
which are A and B. **"If either one can't be met at launch, ship
shared-only and revisit."**

- **A · Counted fields only:** the feels-like band, sky, month, garment
  type and catalogue model, and the verdict, plus region if the runner set
  it. Never the note, photo, route, start time, start place, handle or any
  free text, "so the aggregate job must not have read access to the rest".
- **B · Thresholds per figure:** every number needs 5 or more distinct
  runners, or 20 for a brand, including every row, sky section, split
  sentence and region slice. A cell below the line is left out, never
  shown as "fewer than 5".
- **C · Who counts:** confirmed-email accounts only. Excluded: removed or
  quarantined entries, banned accounts, accounts pending deletion, and
  manual-temperature runs.
- **D · What opting out undoes:** guides are rebuilt nightly, so an
  opted-out runner is gone by morning; published reports stay as they are;
  opting back in counts from the next build; deleting an account is an
  opt-out.
- **E · Told at the moment of choice:** under A3's PRIVATE state, in
  Settings and in Au2's legal line, each linking to the setting. In-app
  social proof ("worn by N runners") stays shared-only, and closet pieces
  count only when worn on a counted run.

**The screens:**

- **Settings › Sharing,** one SHARING group beside "Share new runs":
  "Count my runs in anonymous totals". On (the default): "Shared and
  private runs add their temperature, kit and verdict to the guides and
  reports. Never your name, notes, photos, or where and when you ran." ·
  How the guides are made (`dialed.run/how-it-works#totals`). Off: "Off.
  Your runs leave the guides at tonight's update. Reports already published
  stay as they are." It saves on toggle with a §4a `NOT CHANGED` band if
  that fails, and has no confirm.
- **A3's PRIVATE sub-line:** "Only you see this run. Its kit and verdict
  still count, anonymously, in the guides. Change". Change opens Settings ›
  Sharing as a sheet and returns to the form with its values kept. Opted
  out, the line is just "Only you see this run." Round 27's unverified line
  takes precedence.
- **Au2's legal line** gains one sentence and no checkbox: "Your runs
  count, without your name, in totals like the guides. You can turn that
  off in Settings." No onboarding step.

**Owner decision: D-108.** The owner adopted the middle path (2026-10-03,
with design's round 32 conditions). **It closes the D-29 question**:
closet pieces count only when worn on a counted run, and in-app social
proof stays shared-only. _Build:_ 126, with feed and onboarding, M,
pre-launch:

- the Settings › Sharing switch and its on and off sub-lines
  (`onboarding/components/Settings.tsx`);
- A3's PRIVATE sub-line and its Change sheet (127 owns A3's form, so the
  sub-line touches its share switch);
- Au2's legal sentence;
- the opt-out stored per account, an additive nullable column under the
  schema protocol, written by the switch, in `profile.csv`, and honoured by
  the guide-artifact cron (D-105);
- the cron reading only condition A's fields, which means a query with no
  path to notes, photos, routes, start times or handles.

The marketing boards' copy changes (M1's "FROM 1,240 RUNS", M2's and M8's
leads, M3's footer line, M4's answer, new FAQ and "How the guides are made"
section, M8's METHOD) are marketing-site work.

**The Terms and Privacy wording is for the owner's legal review.** The
board calls both "drafts in the product's voice, not legal text", to go
into the first published version of each document. They are quoted here,
and `docs/legal/*` is not edited:

> **Terms · anonymous totals.** When you log a run, you let us combine its
> feels-like temperature, sky, month, the kit you wore and your verdict
> with other runners' runs, and publish the totals. This covers runs you
> share and runs you keep private. We use these totals for the What to
> wear guides, seasonal reports and similar pages, and we may publish the
> totals as data that others can reuse. A total never includes your name,
> handle, notes, photos, route, or when or where you started. We only
> publish a figure when at least 5 runners are behind it, or 20 if it's
> about a brand. You can stop your runs counting at any time in Settings.
> That takes effect for anything we build after you change it. Totals
> we've already published stay as they are.

> **Privacy policy · anonymous totals.** We add up some details of every
> run (feels-like temperature band, sky, month, kit and verdict) across
> many runners to make public guides and reports. Private runs are
> included: "private" means no other person can see the run, not that it's
> never counted. We never read your notes, photos, route, start time or
> start place for this. No figure is published unless at least 5 runners
> are behind it, or 20 for a brand, so a total can't point to you. If
> you've chosen to add your region, we use it only to group totals, such
> as "runners in Minnesota", and only when at least 5 runners share that
> region. Your region is never shown on your profile or your runs. To opt
> out, turn off "Count my runs in anonymous totals" in Settings. Your runs
> are removed from the guides at the next nightly update and left out of
> future reports. Deleting your account opts you out too.

This is round 30's data requirement (a), and it must land before the terms
are published (D-93).

**Wording the owner may want to align:** CLAUDE.md's sharing rule says
"Private entries never appear in feeds or consensus aggregates", and
`docs/product.md` says "Public entries feed E1/E2 and the consensus
aggregates". Both read as in-app consensus, which D-108 keeps shared-only,
but a reader could take them to cover published totals. This import edits
neither.

**Au6: answered.** `Auth.dc.html`'s Au6 now draws the band under the
Google button (labelled round 33 in `design/docs/product.md`): "the band
sits under the Google button (round 29: every Google band goes under it).
The button keeps Google's own spec and label, and Try again in the band is
the retry. The kicker is MONO.xs (round 31)." **This closes the Au6 part
of open item 44**, and round 30's Au6 erratum. _Build:_ none beyond round
29 #13's (126, `auth/google-button.tsx`).

**The token-created email (round 30 frame 6f, D-104).** From
`hello@dialed.run`, subject "A new API token was created on your account":
"A token called biglongrun build was created on @maya_runs.", then
`CAN READ · SHARED ENTRIES ONLY` (or `SHARED AND PRIVATE ENTRIES`) and the
creation time in the runner's zone, "If that was you, there's nothing to
do.", and **This wasn't me** · "That revokes the token straight away. Then
change your password." The secret is never in it. **This refines round 30
#6:** "This wasn't me" is a state-changing link, so it lands on a page with
a button ("Revoke biglongrun build?" · Revoke), per round 27's email rule,
then shows Account with "Revoked. Change your password next." _Build:_ new:
read API (task 130), with 126's email.

**Integration Opportunities, redrawn.** 02 is now "a general read API on
api.dialed.run. It returns runs and pieces, and callers aggregate for
themselves." `GET /v1/pieces`, `/v1/pieces/:id`,
`/v1/pieces/:id/runs?asOf=&since=&cursor=`, `/v1/runs?asOf=&since=&cursor=`
and `/v1/bands`. Each run carries its start, distance, duration, temperature
and feels-like in °F and °C, wind, sky, the verdict as a word, the piece's
flag and note, the kit, `visibility` and `entry_url` when shared; the body
is `data` plus `next`. A revoked or unknown token is 401, and someone
else's piece is 404. 04 marks the Strava kit line "NOT ADOPTED" (D-106) and
other runners' sites "ADOPTED · ANY RUNNER". This closes round 30's
`published.csv` erratum and most of the differences with design 130 listed
under round 30 below. The ones that remain:

- **Field names:** the board writes snake case (`duration_s`,
  `entry_url`, `added_at`, `retired_at`, `guide_published`, `guide_url`,
  `start`); the doc writes camel case (`durationS`, `entryUrl`, `addedAt`,
  `retiredAt`, `guidePublished`, `guideUrl`, `startedAt`).
- **Units and nesting:** the board has `distance: { mi, km }` and top-level
  `temp`, `feels` and `wind` objects in both units. The doc has
  `distanceM`, and a nullable `conditions` object with `source`,
  `tempC`/`tempF`, `feelsLikeC`/`feelsLikeF`, `windKph`/`windMph` and
  `sky`.
- **Pieces:** the board lists `model`, which the doc doesn't have, and
  `retired_at`; the doc has `retired` plus `retiredAt`.
- **Kit and worn-with:** the board puts `kit` on piece runs. The doc's piece
  runs carry `wornWith` (the other pieces), and `kit` is on `/v1/runs` only.
- **`/v1/runs` parameters:** the board has `asOf`, `since` and `cursor`;
  the doc has `from`, `to`, `cursor` and `limit`.
- **Envelope:** the board has `data` and `next`. The doc has
  `includesPrivate` on every body, and doesn't name the list or cursor
  fields.
- **Run fields only in the doc:** `timeZone`, `title`, `indoor`, `effort`,
  and the 401 split between `invalid_token` and `token_revoked` (the board
  says only "401").

They agree on the verdict words (`way_cold … way_warm`), dual units, the
bands endpoint with guide state, start instants, a shared-only scope by
token, and any runner creating tokens.

**Conflicts for the owner: none.** Round 31 edits contracts design owns and
follows D-99, D-105 and D-107. Round 32 was decided by the owner as D-108.

**For design's next round:** none from these rounds. Round 30's errata
that rounds 31–32 close: Au6, the marketing wordmark, and Integrations'
`published.csv`. Still open from round 30: the Form Contract's 02b kicker
samples, the Feed gutter's T1 role, "The two typefaces", and the ZIP's
`run-files/` wording.

## Answered in round 30 (imported 2026-10-03)

Six asks in two parts: reconcile what round 29 left open (1–4), and draw
two surfaces for the personal read API, which is built after the friends
stage (5–6). **All six are answered.** They are on a new board,
`Round 30 Rulings.dc.html`.

**One contract file changed, and nothing needs a code port.** `tokens.js`
gains one COLLAPSE entry: _"'11px Archivo Black kicker (§4a band)': 'MONO.xs,
ink, caps. Round 30 #1: the build is right.'"_ No TYPE, MONO, SPACE, HEIGHT,
RADIUS, BREAKPOINT or MEASURE value moved, and `test/ui/tokens.dom.test.tsx`
passes against the new file unchanged. The Form Contract, T1, `motion.js`,
`icons.js` and the other contracts are byte-identical to round 29's.

Design amended four files in place and added one ruling board:

- `tokens.js`: the COLLAPSE entry above (item 1).
- `Operator Screens.dc.html`: D0 and D6 take D-87's rail (Today, Review,
  Access, Duplicates, Runners), and D6's note now reads "Gave up · a section
  of Today" (items 2 and 3).
- `Round 29 Rulings.dc.html`: the three Desk frames move Access to third
  (item 3), and #6's prose is amended to D-95 and D-96 (item 4).
- `design/docs/product.md`: the §4 kicker line, round 29's kicker and rail
  lines, and a "Round 30" section that mirrors the board.

This import also amends `docs/product.md` §4's kicker line to `MONO.xs`, as
the ruling says, and changes nothing else under `docs/` beyond this file.

Three boards nobody asked for are new design areas, recorded below:
`Marketing Site.dc.html` (with `Marketing Site - Dark.dc.html`),
`Integration Opportunities.dc.html` and `Logo Directions.dc.html`. The
first three are new to `design/`. **`Logo Directions.dc.html` is not:** it
has been in `design/` since the initial commit, and the bundle's copy is
byte-identical, so there was nothing to copy. The archive leaves out
`screenshots/` and `.thumbnail`, as earlier imports did, and nothing was
removed from `design/`.

**The owner's 22:13 update** re-exported three of these files:
`Marketing Site.dc.html` and `- Dark` add M8 · Reports, and
`design/docs/product.md` adds "Pre-launch data requirements". Both are
recorded below, and nothing else in the bundle changed.

Lanes are the launch plan's: 125 ops/platform and the Desk shell, 126
accounts/auth/email/legal/export, 127 runs/Strava, 128 safety, closet and
moderation, 129 feed. "New: read API" is task 130 (design doc on
`docs/read-api-design`, not merged). "New: marketing site" has no task.

**A · Reconcile what round 29 left open**

1. **The kicker's type (item 44).** _Ruling: `MONO.xs`, ink, caps. "The
   build is right, and no step is added."_ A kicker is a status caption,
   which is MONO.xs's job, and the display family has no step below 19
   (TYPE.heading), so adding an 11px one would break law 2. `tokens.js`
   COLLAPSE maps "11px Archivo Black kicker (§4a band)" to MONO.xs. Boards
   drawn in Archivo Black are not redrawn (round 10 precedence). Round 29
   #1's fill ruling still holds: no fill, and Try again is the only filled
   thing. The board's sample is "10px Plex Mono, 0.10em, ink", which is
   MONO.xs exactly. **This closes the kicker part of open item 44.**
   _Build:_ none. `ui/form.tsx`'s `FailureBand` already draws
   `<Mono step="xs">`, and `docs/product.md` §4 is amended in this PR.
   **One loose end:** the Form Contract's 02b samples still draw Archivo
   Black 11px with 0.12em. Round 30 treats them like any other drawing (the
   COLLAPSE entry is how a reader resolves them), so nothing waits on it,
   but the two contracts still read differently on their face.
2. **The two boards round 29 said it redrew (item 44).** _Operator Screens:
   redrawn now._ D0 and D6 still had the round 27 rail, with Gave up as a
   destination. Both now use D-87's rail, and on D6 Today is the current
   item, because Gave up is Today's section. _Round 22 Coverage: "the note
   was wrong."_ It draws neither the rail nor the kicker's type, its §4a
   copy rules (9.1–9.4) stand as written, and there is nothing to
   re-export. _Build:_ none. **That answers the ask as we wrote it, and our
   ask named the wrong board.** Round 29 #13's "Round 22's above-button
   frame" is Au6, which lives on `Auth.dc.html` (round 22), not on
   `Round 22 Coverage.dc.html`. Au6 still reads "The band belongs to the
   button that failed, so it sits above Google". Round 29 #13's ruling
   (every Google band directly under its button) stands and is what lane
   126 builds, so only the drawing is behind. It goes to design's next
   round, below.
3. **The Desk rail in D-87's order.** _Redrawn:_ Today, Review, Access,
   Duplicates, Runners, on Operator Screens and on all three round 29 Desk
   frames (Today, D7 Codes and Requests). The board now agrees with D-87.
   _Build:_ 125, M, which is round 29 #2's work unchanged:
   `ops/components/DeskShell.tsx`'s `DESK_PAGES` goes from Today, Review,
   Duplicates, Gave up, Runners, Access to D-87's order and drops
   `gave-up`, and `ops/components/Today.tsx` gains the Gave up section and
   its count. The rows still wait on register R-119.
4. **The terms gate, redrawn to D-95 and D-96.**
   - **4a · What the gate lets through (D-95).** `/account` read-only,
     export and delete. On `/account` every editing control (email,
     password, Strava, tokens) shows the field hint "Accept the Terms to
     change this." with a link back to the prompt, and the controls leave
     the tab order. Values show as text, not fields. The hint is
     TYPE.small in `--muted` with no band, "because nothing failed". There
     is no tab bar, and the back link "‹ Terms" returns to the gate. Sign
     out everywhere stays live, "because it's a safety action" (it is
     Better Auth's own endpoint and never passes the gate today). Export
     and Delete run their normal U1 flows and come back here.
   - **4b · After Accept (D-96).** "Route, not values." This replaces round
     29's r6f. Accept goes back to the refused save's route as a fresh form,
     and the page warns first: "After you accept, you'll go back to Log a
     run. What you typed wasn't kept." The line appears only when a
     refused save brought the runner here, and names the route in the
     runner's words (Log a run, Add a piece). Arriving at login skips it.
   - **The escape line** names all three ways out: "Rather not? Log out, or
     go to your account to export or delete it." Round 29's standalone Log
     out pill is gone, because the escape line carries both exits. The
     never-accepted and changed-again frames get the same escape line and
     nothing else changes on them.

   _Build:_ 126, M, on or after PR B. `account/components/TermsPrompt.tsx`:
   the new escape line (today "Rather not? Log out, or delete your account
   in Settings."), the Log out pill removed from `ActionCard`'s use here,
   and the "go back to" line, which needs a route-to-words map for the
   paths `ui/terms-refusal.tsx` carries in `from`. The read-only `/account`
   is new: `routes/account/$section.tsx` and the Settings › Account
   components render values as text with the hint while the runner is
   behind, which the page already knows because its two reads are exempt
   (D-95). The Strava row's hint touches 127's connect control. **The
   warning line is new copy on the prompt, which D-96 says has none;** see
   Conflicts.

**B · Drawn for the read API**

5. **A shared link, signed out (D-58).** _Same URL, two states._
   `/feed/entry/{id}` signed in is D. Signed out it is a landing that
   carries nothing of the entry: no handle, date, kit, photo or
   conditions. The response is identical for a real, private, deleted or
   made-up id, so the page cannot be used to probe which entries exist.
   It is `noindex`, and its OG card is the default one, never the entry's.
   - **5a · First visit:** "Log in to see this run", "Runs on dialed.run
     are shared with runners who have an account.", **Log in** (filled),
     **Request an invite** (outline), "Have a code? Join", then the pitch:
     `WHAT DIALED.RUN IS` · "Wear what worked." · "It remembers what you
     wore, the weather you ran in, and whether you got it right. The night
     before your next run, it makes the call." · How it works. The actions
     come first, "because the visitor came for a run".
   - **5b · This browser has signed in before:** a first-party flag with
     no identity in it. Log in is the only button, the lead is "You're
     signed out on this browser.", the invite drops to one line ("New to
     dialed.run? Request an invite") and the pitch goes. The page never
     asks who you are.
   - **5c · Desk:** the pitch on the left and the panel on the right (the
     Desktop Contract's centred panel, offset). The returning-browser state
     at desk is the panel alone, centred.
   - **After signing in** the runner lands on the entry: Log in carries
     `?next=/feed/entry/{id}`, and so do Google, the invite-code path and
     email confirmation. If the runner can't see the entry, it is the Feed
     board's removed-entry state, with no reason given.
   - "Request an invite" matches the marketing site and becomes "Create an
     account" at public launch. It opens `dialed.run/invite` (marketing
     M5), and How it works opens marketing M4. The landing **withdraws the
     read-only public `/r/{id}` view** the Integrations board first drew.

   _Build:_ 129 and 126, M. Today `feed/redirect.ts`'s `requireSignedIn`
   sends a signed-out `/feed/entry/$entryId` to `/auth/login` with no
   `next`, and round 27 #7's "Log in to see this run" was never built, so
   this supersedes it. 129 owns the entry route's signed-out branch (a
   landing instead of the redirect, built on `ui/SignedOutPanel.tsx`); 126
   owns `next` through Au1's password and Google paths, the invite code
   and email confirmation, and the device flag (`lib/browser/`). Until a
   marketing site exists, Request an invite goes to the app's own
   `/account/request-access` (Au5) and How it works has nowhere to go, so
   it is left out. The landing reads the same on today's single host as on
   the board's `app.dialed.run`. Lane 129 can build it before the read API
   if the owner wants shared links to land well at the friends stage.

6. **Settings › Account › API tokens.** _A section below Strava._ Tokens
   are read-only, cover only the runner's own account, and never expire:
   revoking is the only way to end one. **The token decides scope, so the
   per-piece publish toggle the Integrations board first drew is dropped.**
   - **6a · Empty:** "API tokens" · "A token lets your own tools read your
     dialed.run data. For example, a blog can show how a jacket did." ·
     **Create a token**, an outline pill ("a secondary action on a settings
     page", like round 29's Resend). No docs link until docs exist.
   - **6b · Two tokens:** each row is the name, Revoke, the scope label and
     `MADE SEP 12 · USED OCT 2` (or `NEVER USED`). Newest first; dates are
     date only, in the runner's zone; last used updates at most hourly. The
     scope label is `SHARED ONLY` in `--muted`, or `[INCLUDES PRIVATE]` in
     ink, bracketed like `[UNDER REVIEW]` "because it's the one you should
     notice". No hue for either. A row leaves on a successful revoke, never
     on the press, and a failed revoke gets round 29's row band,
     `NOT REVOKED`, inside the row.
   - **6c · Create sheet:** NAME ("So you can tell your tokens apart.",
     required, up to 40 characters, not unique; its error is "Name the token
     so you can tell it apart."), then WHAT IT CAN READ: **Shared entries
     only** (preselected) · "Runs you've shared with runners on dialed.run."
     or **Include my private entries** · "Whatever uses this token can read
     runs only you can see. If it publishes them, they're public." No extra
     confirm for private. **Create token.**
   - **6d · Shown once:** "Copy your token" · "You won't see this again. If
     you lose it, revoke it and make another." The token is shown whole
     (`drn_…`), never masked, and selectable. Copy becomes `[ Copied ]` for
     2s with a polite announcement; if copying fails, the label reads
     "Select it and copy" and the text is pre-selected. Under it, the name
     and scope (`BIGLONGRUN BUILD · SHARED ONLY`). The sheet doesn't close
     on scrim tap or swipe: Done is the only way out. After this the server
     keeps only a hash.
   - **6e · Revoke confirm:** `Revoke "biglongrun build"?` · "Anything
     using it stops working straight away. This can't be undone." ·
     `LAST USED OCT 2` · **Revoke** (filled ink, not pink: "pink is 'go',
     and this is a stop that you asked for") / Keep it. In flight it reads
     `[ Revoking ]`. On success the sheet closes, the row leaves, and the
     status region says "Revoked biglongrun build." A request with a
     revoked token gets a 401 with the body "This token was revoked."
   - **Rules:** at most 10 per account; at 10, Create is replaced by the
     hint "You have 10 tokens, the most there can be. Revoke one to make
     another." Scope is fixed after creation, so to change it, create a new
     token and revoke the old one. Creating one emails "A token called
     {name} was created on your account.", with the scope and a "This
     wasn't me" link that revokes that token and lands on Account; revoking
     sends nothing. The export adds `tokens.csv` (name, scope, created_at,
     last_used_at), never the secret. Behind on the terms, the list shows
     and Revoke works, Create shows #4's hint, and **tokens keep working,
     "because reading your own data isn't using the service."**

   _Build:_ new: read API (task 130), L, with 126 for the email and the
   export. Per the design doc: `auth/api-tokens.ts` and
   `auth/components/ApiTokens.tsx`, wired by `routes/account/$section.tsx`;
   a new email kind in `email/content.ts`; `tokens.csv` in
   `account/export-sheets.ts`; and the additive `add_api_tokens` migration.
   The board settles three of the design doc's open questions (no expiry;
   export the tokens without the secret; the show-once, empty-state and
   revoke copy) and differs from it in several places, listed under "The
   read API design doc" below. Two rulings amend owner decisions (D-95 and
   D-43); see Conflicts.

**New design areas, not built and not scheduled**

None of these was asked for, and none is in any lane. Recorded so the next
reader knows what the boards hold.

- **Marketing site** (`Marketing Site.dc.html`, and `- Dark`, which is the
  T1 swap following the visitor's system setting, with no toggle). "The app
  makes the call. The site shows the record." Drawn at desk 1180 unless
  marked 390.
  - **M0 · Two hosts.** `dialed.run` is the marketing site, indexed and
    followed: `/`, `/what-to-wear`, `/what-to-wear/{band}`,
    `/how-it-works`, `/invite`, `/changelog` (and `/changelog.xml`),
    `/privacy`, `/terms`, `/open-source` and `/copyright`, static and built
    nightly from the guide data; `www.` 301s here. `app.dialed.run` is the
    app, never indexed: robots.txt disallows the whole host, every response
    sends `X-Robots-Tag: noindex`, and cookies are scoped to it. It holds
    everything signed in, `/login`, `/join?code=`, reset and confirm links,
    and `/feed/entry/{id}` (item 5's landing when signed out).
    `api.dialed.run` is the published-record feed and whatever the guide
    build reads. Until public launch, only Home and Invite are linked; the
    nav links What to wear once one band is published. "This amends Round
    27."
  - **M1 · Home.** "Wear what worked." One promise, one proof, three steps,
    one ask. The proof is a real Call card, static markup filled at build
    time from the owner's own published piece. Request an invite (pink) and
    "Have a code? Join" sit together. A guide strip ("What to wear · from
    1,240 shared runs") appears once a band is published. Structured data:
    WebApplication.
  - **M2 · What to wear.** Published bands only, coldest first; an
    unpublished band is absent, not greyed. Each tile is the band, its
    most-dialed kit in one line (the most-dialed type per category at ≥50%
    dialed share), and runs and runners. A °F/°C client switch rewrites
    labels; the URL stays in °F.
  - **M3 · Per-band guide** (`/what-to-wear/32-41f`). One page per band,
    with sky as sections (Dry, Damp, Rain), each needing 5 runners. A
    generated lead sentence answers first ("Most runners were dialed in a
    long sleeve, tights and light gloves…"), then a table of garment types
    (never brands) by part with dialed share, and "When it went wrong".
    An invite card ("This is everyone's record. Yours would be about
    you."), then "Reviewed at this temperature" cards linking published
    pieces to their biglongrun reviews. Structured data: FAQPage.
  - **M4 · How it works.** The legal layout (620 measure, sticky contents)
    for the loop, the verdict's five steps, the call and a FAQ. "Owner to
    confirm 'Why invite-only?'". No pricing until the owner decides it.
  - **M5 · Invite.** One field, email, with Turnstile; every address gets
    the same answer ("You're on the list"), as Au4 does. "Have a code?"
    hands over to `app.dialed.run/join?code=`, so Au2 stays the only place
    an account is made. It has no note field, unlike Au5.
  - **M6 · Gear (after launch, not in v1).** One page per model, pooled
    across runners by band, needing one catalogue entry per model. The
    board flags its own bar colours as placeholders: pink can't mean warm.
  - **M7 · Changelog.** One owner-written Markdown file per entry, newest
    first, tags NEW, BETTER and FIXED (`MONO.xs` ink in a 1px box), an
    Atom feed, dated anchors. **M7b** adds a "What's new" row in U that
    opens it in a new tab, with `NEW · OCT 3` until opened; the board asks
    whether hi-viz there needs a ruling against §AH.
  - **M8 · Reports (after launch, not in v1).** Added by the owner's
    22:13 update. A seasonal report at `/reports/{season}-{year}`, with a
    yearly roll-up at `/reports/{year}`, each keeping its URL for good.
    Three to six findings per report, each a headline, a chart (its own
    1200×630 OG image and `#finding-01` anchor) and links through to the
    guide or gear page it comes from. A METHOD block (shared entries only;
    20 runners for a brand figure, 5 for a band; matched catalogue models
    only; opted-in region only; "early, enthusiastic runners, not all
    runners"), and THE DATA: every figure as CSV under CC BY 4.0, with a
    citation line. Structured data: Dataset, with the CSV as its
    distribution. Brand findings are worded neutrally, and no brand sees a
    report before it is published. It depends on the pre-launch data
    requirements below. Not built and not scheduled.
- **Integration Opportunities** (`Integration Opportunities.dc.html`). "Your
  blog says how it fits. dialed.run says how it did."
  - **01 · The biglongrun block.** "Real-World Conditions", a sibling under
    the existing Strava block on biglongrun's apparel reviews, rendered by
    Astro at build time in the blog's own styling, credited in its footer.
    At Review and Lifetime tabs (`?asOf=` the post's date); runs worn,
    feels-like range, dialed count, worn period; a by-conditions table
    whose bands link to `dialed.run/what-to-wear/{band}` (plain text when
    unpublished); sky counts; "most often worn with"; and a run list whose
    dates link to the entry on dialed.run, landing signed-out readers on
    item 5. Every temperature comes in °F and °C.
  - **02 · The published-record endpoint.**
    `GET https://api.dialed.run/v1/pieces/{piece_id}/record?asOf=…` with
    a `drn_` bearer: totals, bands, sky, wornWith and runs, dates only, no
    time or place. Shared-only by default (the token decides, item 6);
    unpublished, deleted or revoked is 404 and the block renders nothing;
    a retired piece keeps its record with `"retired"`.
  - **03 · Tokens.** The token from item 6 is the only switch. The blog
    names a piece by its id in the review's frontmatter
    (`dialedPiece: pc_…`), and revoking removes the block on the next build.
  - **04 · Other openings, none committed:** shoe reviews with the same
    block; a kit line appended to the Strava activity; biglongrun
    `/compare`; other runners' sites ("in v1 only the owner makes tokens");
    and guides linking back to reviews.
- **Logo Directions** (`Logo Directions.dc.html`, in `design/` since the
  initial commit and unchanged). Eleven direction studies in a system font,
  "NAME LOCKED: dialed.run". Round 1 draws dialed as a dial (01 flat
  wordmark, 02 indicator dot, 03 the dial, 04 the band, 05 bib tiles, 06
  the tick). Round 2, the live one, draws it as "lined up" (07 in register,
  08 within tolerance, 09 interlocked, 10 flush left, 11 dead centre), and
  recommends **08's brackets as the system and 07's registration mark as
  the icon**. The shipped wordmark `[dialed.run]` and round 26 #22's `[d]`
  favicon are 08's grammar already. Next steps it names: a type designer
  for real vectors, a trademark search on 03 and 04, and a home-screen
  test.

**Pre-launch data requirements (for seasonal and annual reports).** The
owner's 22:13 update adds this section to `design/docs/product.md`: _"cheap
to add before launch and expensive after."_ M8 depends on it. Each item's
status was checked against `main`:

- **(a) Terms and Privacy: aggregate publication. Missing.** The section
  asks for a clause saying dialed.run may publish anonymous aggregates of
  shared entries and closet pieces, at 20 or more runners for a brand
  figure and 5 or more for a band, never naming or linking a runner. It
  must ship in the launch Terms version (v1) so it doesn't trigger a second
  acceptance prompt. Neither `docs/legal/terms.md` nor
  `docs/legal/privacy-policy.md` mentions aggregates today. _Build:_ the
  owner's legal text, before the terms are published (D-93). No lane
  writes it.
- **(b) One catalogue entry per brand and model. Already true.**
  `wardrobe_items.product_id` resolves to `products`, an item with no brand
  is "unmatched", and Desk Duplicates is the merge tool. _Build:_ none.
- **(c) Closet `added_at`. Already true,** as `wardrobe_items.created_at`.
  First-worn derives from the piece's earliest entry, so it needs no
  column. _Build:_ none.
- **(d) Region, optional and opt-in. Missing.** Settings › Profile ›
  Region: country, plus state or province where it applies. Off by
  default, used only in aggregates, never shown on a profile or entry, and
  included in `profile.csv`. Hint: "Used only in anonymous totals, like
  what runners in your state wear. Never shown to anyone." _Build:_ 126
  (onboarding's Settings › Profile), S to M, pre-launch: an additive
  migration (nullable country and region columns) under the schema
  protocol, the Settings row, and the `profile.csv` columns in
  `account/export-sheets.ts`.

Counting closet pieces in published aggregates amends D-29; see Conflicts.

**Conflicts for the owner.** None of these was adopted by the import. Each
quotes both sides and ends with a recommendation. **The owner ruled on eight
of the nine on 2026-10-03 (D-99 to D-104, D-106 and D-107)**, and each
one's resolution follows it. The ninth, closet pieces in reports (D-29), is
closed by D-108 after round 32.

- **Reports count closet pieces (M8 and the data requirements) vs D-29.**
  D-29: _"Social-proof ownership counts derive only from public entries …
  never from closet contents."_ The requirements publish "anonymous
  aggregates of shared entries and closet pieces", M8 headlines "2,940
  PIECES", and (c) exists for "growing brands", which reads closet
  additions. _Recommendation:_ an owner call alongside the D-58 one below.
  Reports built from shared entries alone keep D-29. Counting closets needs
  D-29 amended and clause (a) to say so. **Open (owner, 2026-10-03).** The
  owner is checking with design whether published totals count private
  entries (with an opt-out) and whether closet pieces count only when worn.
  D-29 stands until then. **Closed by D-108 (owner, 2026-10-03):** the
  middle path with round 32's conditions. Closet pieces count only when
  worn on a counted run, and in-app social proof stays shared-only. See
  "Answered in rounds 31–32" above.
- **Two hosts (Marketing M0) vs D-53 and the deployment plan.** D-53: _"The
  whole site is `noindex` until the public launch … at the stage 2 gate the
  landing page and other public marketing pages flip to index by their own
  route meta, and profiles and entries stay `noindex`."_ The deployment
  plan routes one Worker to `dialed.run` and recommends one origin for
  cookies (§1). M0 splits the product across `dialed.run` (indexed),
  `app.dialed.run` (never) and `api.dialed.run`, says "This amends Round
  27", and does not say the marketing host waits for stage 2 to be
  indexed. Profiles and entries staying out of the index agrees with D-53.
  _Recommendation:_ keep D-53 and the single host until the owner decides
  to build a marketing site at all. If one is built, the split is a
  deployment-plan change (Better Auth's URL, the Strava callback, Google's
  origins, every email link) and the marketing host still ships `noindex`
  until stage 2. **Resolved: adopted, D-99, amending D-53.** `dialed.run`
  is the marketing site, indexable once its `SITE_INDEXABLE` flag is turned
  on at public launch; `app.dialed.run` is never indexed and scopes its
  cookies to itself; `api.dialed.run` is the read API. The deployment sweep
  moves `BETTER_AUTH_URL`, the OAuth redirect URIs, the Strava callback
  domain, cookies, email links and the CSP.
- **Legal pages on the marketing host (M0) vs D-81 and D-93.** M0 puts
  `/privacy`, `/terms`, `/open-source` and `/copyright` on the static
  `dialed.run`, indexed. D-81 fixes the links where they are, with
  `/privacy` answering X1 until the app reads the published mark; D-93's
  "no published terms" state is read by the app worker
  (`account/terms-acceptance.ts`). Round 27 kept them `noindex`.
  _Recommendation:_ keep them in the app until a marketing site is
  scheduled; moving them is part of that decision, not this import.
  **Resolved: adopted, D-100, amending D-81 and D-93 only as to host.**
  They move to the marketing host once it exists, sourced from this repo's
  `docs/legal`; until then the app keeps serving them.
- **Guides and reports publish shared-run data to the open web (M1–M3,
  M8) vs D-58.**
  D-58: _"nothing is served to a signed-out visitor or a search index by
  being public."_ The guides aggregate shared runs (five runners per band,
  types not brands, no names) for signed-out visitors and search; M1's
  Call card and M3's review cards publish the owner's own piece record;
  M8 publishes findings and their CSV under CC BY 4.0.
  _Recommendation:_ an owner call before any guide or report is built. If the
  answer is yes, D-58 gains an aggregate exception and the privacy
  policy's "What other runners see" section needs a line. **Resolved:
  adopted, D-101.** Guides and reports are anonymous totals, not entries;
  D-58 still governs entries and profiles, and nothing of an entry is ever
  public. The privacy line is data requirement (a).
- **The terms prompt's "go back to" line (4b) vs D-96.** D-96: a refused
  call opens the prompt _"instead of a failure band, with no new copy,
  never saying the refused write was saved."_ Round 30 adds "After you
  accept, you'll go back to Log a run. What you typed wasn't kept."
  _Recommendation:_ adopt it. It never says the write was saved, and it
  tells the runner the one thing D-96 leaves them to discover. It needs
  D-96 amended. **Resolved: adopted, D-102, amending D-96,** whose point
  was no failure band, not no words.
- **Tokens and the terms gate (6) vs D-95.** D-95 names the exemptions:
  _"Get a copy … beside Delete account, Keep, Accept and sign-out …
  Settings › Account's two reads are exempt with it."_ Round 30 adds the
  token list, Revoke, and the API itself ("tokens keep working, because
  reading your own data isn't using the service"). The read API design doc
  refuses a token while its owner is behind (403 `terms_not_accepted`).
  _Recommendation:_ adopt it, on D-95's own reasoning (portability, and
  Revoke is a safety action like sign-out), amend D-95, and change the
  design doc before task 130 is built. **Resolved: adopted, D-103.**
  Tokens keep reading while a runner is behind, consistent with D-95's
  export exemption, and Revoke stays allowed. Task 130's design doc changes
  to match.
- **The token-created email (6) vs D-43.** D-43 lists the emails that
  exist; D-89 amended it for the reopen email. Round 30 adds "A token
  called {name} was created on your account." with a "This wasn't me"
  revoke link. _Recommendation:_ adopt it with task 130 as a transactional
  kind, and amend D-43 then, as D-89 did. **Resolved: adopted, D-104,
  amending D-43:** a security email with no opt-out, built with the read
  API.
- **The default OG card (5) vs D-51**, still unresolved from round 27.
  D-51: _"Per-entry OG share cards are generated now."_ Round 30: "The OG
  card is the default one, never the entry's", as round 27 #7 ruled.
  _Recommendation:_ supersede D-51, as round 27's import already asked.
  **Resolved: default card only, D-107, superseding D-51,** per the owner's
  earlier "generic card only" call.
- **A kit line on the Strava activity (Integrations 04) vs D-14 and D-54.**
  D-54: Strava keeps _"only the athlete id and a refresh token, used solely
  to revoke"_; D-14: _"No activity data stored, ever."_ The board's
  "41°F damp · Dialed · kit via dialed.run" needs Strava's write scope and
  writes to an activity. It is marked "not committed". _Recommendation:_
  not adopted; it would reverse two owner decisions and Strava's review.
  **Resolved: not adopted, D-106.** D-14 and D-54 stand.

**One more ruling, not a conflict: D-105.** The marketing site is a
separate public repo built with Astro (`~/dev/projects/dialed.run-site`),
deployed to the same Cloudflare account with a scoped token. Guide data
reaches it as a nightly aggregate JSON that an app cron writes to R2 (bands
with 5 or more runners only), and changelog entries are drafted by Claude
from merged PRs and approved by the owner. It is a public-launch item, so
"new: marketing site" in the build work above is that repo, plus the app's
cron.

**The read API design doc (`docs/read-api-design`, open).** The
Integrations board's endpoint and the design doc describe different shapes.
None is an owner decision yet, so these go to task 130's review rather than
to the owner here:

- **Path and host:** `GET https://api.dialed.run/v1/pieces/{piece_id}/record`
  on its own host, one endpoint, against `GET /api/v1/garments/:id/runs` on
  the app's host, plus `/api/v1/garments`, `/api/v1/runs` and
  `/api/v1/runs/:id`.
- **"Pieces":** `piece` with a `pc_` id and `{ id, name, category, type }`,
  frontmatter `dialedPiece`, against garments with plain ids, brand as its
  own field and frontmatter `dialedGarmentId`.
- **Bands:** server-side feels-like bands (`"0-5c"`, labels in °F and °C,
  counts and a guide URL) against no bands: min/max ranges for temperature,
  feels-like, wind and precipitation, with the blog doing any binning.
- **Sky:** `{ dry, damp, rain, snow }` totals and a sky word per run,
  against no sky aggregate and, per run, Visual Crossing's `condition`
  string and `precipMm` (a sky value only on manual runs).
- **`wornWith`:** on the board, absent from the doc's garment endpoint (kit
  is only on `/runs`).
- **Verdict keys:** five strings (`way_cold … way_warm`) on rows, folded to
  `dialed`, `warm` and `cold` in totals, against the integer `verdictSchema`
  with `byValue` counts and a `none` bucket for runs with no verdict.
- **`asOf`:** `?asOf=YYYY-MM-DD` returns the record to that date and echoes
  `"asOf"`, so At Review and Lifetime are two fetches; the doc's `?until=`
  returns both `stats.lifetime` and `stats.atReview` in one response, with
  `atReview` on each run.
- **Also:** dual °F/°C values against SI only; dates only against ISO
  instants with a time zone; no distance, pace or duration (the board keeps
  the Strava block) against stats meant to replace it; `"version": 1` in
  the body against path-only versioning; empty links for private rows
  against `visibility` and `includesPrivate`; owner-only tokens in v1
  (board 04) against any runner; a distinct "This token was revoked." 401
  against one `invalid_token` answer for four cases; `tokens.csv` (four
  columns) against `api_tokens.csv` (six, with prefix and revoked); and
  the doc's displayed `drn_` prefix per row, which item 6's rows do not
  show.

**For design's next round.** No owner call is needed for these:

- Au6 on `Auth.dc.html` still draws Google's band above the button; round
  29 #13 puts it under. Our round 30 ask named the wrong board.
- The Form Contract's 02b samples still draw the kicker in Archivo Black
  11px; tokens.js now maps them, but the contract's own samples could
  match.
- Integrations 02 still lists `published.csv` (piece, published_at, key
  last used) in the export, which item 6's `tokens.csv` replaces now that
  the per-piece toggle is gone.
- The marketing nav draws the wordmark as `[dialed]`; `docs/product.md`
  §Brand says `[dialed.run]`, lowercase always.
- Round 29's errata still stand: the Feed gutter needs a T1 role, "The two
  typefaces" should be three, and the ZIP list should read `run-files/`
  without "unblurred".

**Not asked in round 30, and still open in the queue:** item 10's Gave up
rows (waiting on R-119); item 36's content-removed email; item 38's F rail
card by category alone; item 39's delete-sheet Google flow and its emails;
and item 43, which is held for PR B.

## Answered in round 29 (imported 2026-10-03)

Seventeen asks in four parts: reconcile round 28's hi-viz kickers with the
contract (1), bring the boards into line with the owner's round 28 rulings
(2–5), draw what task 126 built without a frame (6–9), and confirm or redraw
the placeholders (10–17). **All seventeen are answered.** They are on a new
board, `Round 29 Rulings.dc.html`.

**No contract file changed.** `tokens.js`, the Form Contract, T1 and the
other contracts are byte-identical to round 28's, and the board says so: "No
contract text changes this round." Nothing here needs a code port, and
`test/ui/tokens.dom.test.tsx` is unaffected.

Design amended four files in place and added one:

- `Round 26 Rulings.dc.html`: the PHOTO NOT ADDED and rate-limited NOT SENT
  kickers lose the hi-viz fill (item 1).
- `Round 27 Rulings.dc.html`: the control-failure, notice and HIDDEN WHILE
  WE CHECK kickers lose the fill, and the author's tag is `[UNDER REVIEW]`
  (items 1 and 4).
- `Round 28 Rulings.dc.html`: #6's tag is bracketed, #8's CSAM confirm reads
  as item 3, #9's revoked row is struck through in `--quiet`, #13b reads
  REVERSED, #14a and the Desk rail take item 2's order, and #15's ZIP list
  adds terms.csv.
- `design/docs/product.md`: a "Round 29" section that mirrors the board, as
  round 27's import had one.
- **`Feed.dc.html`, new and not asked for.** See "A new board" below.

The board says two other files were redrawn, but neither changed:
`Operator Screens.dc.html` ("Operator Screens D0 and Round 28 #14a are
redrawn to this order") and `Round 22 Coverage.dc.html` ("Round 22's
above-button frame is redrawn"). Both are byte-identical to round 28's
bundle. The rulings are on round 29's board, so nothing waits on this, but
those older frames still draw the old rail and the band above Google's
button. Open item 44 asks for both.

**Item 43 is not on `main` yet.** PR B (`feat/126-round28-accounts`, task 126) adds it on its branch for the reopen email, the Au5 counter, D7's small
states, O0's re-pick and Google's bands, and it was not open when this was
imported. Those answers (items 5, 7, 8, 13, 14 and 15) are recorded here, and
PR B marks its item 43 answered against them.

Lanes are the launch plan's: 125 ops/platform and the Desk shell, 126
accounts/auth/email/legal/export, 127 runs/Strava, 128 safety, closet and
moderation, 129 feed.

**A · Reconcile a ruling with the contract**

1. **§4a kickers.** _Ruling: the contract is right._ A §4a kicker takes no
   fill: "Archivo Black, 11px, capitals, ink, inside the 1px ink band." Round
   28 #13b is reversed. Yellow means "the fix is here". A field error points
   at something the runner can fix, so its message keeps hi-viz. A failed
   control or a refused save leaves nothing to fix on the screen, so it gets
   ink. Against "pink is action, never failure" the two agree: a failure band
   uses neither pink nor yellow, and its only filled element is the ink Try
   again. Notices (`PHOTO REMOVED`, `BEING CHECKED`, `HIDDEN WHILE WE CHECK`)
   follow the same rule, because none of them is the runner's to fix. On the
   Desk, hi-viz stays the accent for "needs a person" (the active rail item,
   counts and `NEW`), but a Desk §4a band has no fill either. Neither the
   Form Contract nor `docs/product.md` §4 is amended, because neither needs
   to be. Every band on rounds 26–28 and the Feed board is redrawn without
   the fill. **This closes open item 40, and settles D-91 the way the
   contract already reads.** _Build:_ none. `ui/FailureBand` and
   `safety/components/NoticeBand.tsx` already draw no hi-viz. **The kicker's
   face is open item 44:** the board, the Form Contract's samples and
   `docs/product.md` §4 say Archivo Black 11px capitals, while `tokens.js`
   has no such step and `FailureBand` draws the kicker in `MONO.xs`. The two
   contracts disagree with each other, so design reconciles them in
   `tokens.js`, and no owner call is needed.

**B · The owner's round 28 rulings, on the boards**

2. **Five Desk destinations (D-87).** _Drawn:_ "Desk · Today · Gave up as its
   section", with the rail **Today, Review, Duplicates, Runners, Access**.
   Gave up is a section on Today, under the three numbers: `Gave up` · `[3
JOBS · OLDEST 2D]`. It shows the two newest jobs, then "+ N MORE · SHOW
   ALL", which expands in place with no route of its own. D6's row grammar
   and retries are unchanged. Today's rail count is the Gave up count, in
   hi-viz because it needs a person. At zero the count goes away and the
   section reads "Nothing gave up." on one line. The digest email keeps its
   one Gave up line. **The board's order is not adopted (owner,
   2026-10-03).** It came from our round 29 ask, which misquoted D-87, and
   the board drew what it was told. D-87 stands: **Today, Review, Access,
   Duplicates, Runners.** _Build:_ 125, M. `ops/components/DeskShell.tsx`'s
   rail goes to D-87's order (today it is Today, Review, Duplicates, Gave
   up, Runners, Access) and drops `gave-up`, and `ops/components/Today.tsx`
   gains the Gave up section and the count. The rows still wait on the
   reason, try count and time that no dead-letter handler records (item 10,
   register R-119).
3. **The CSAM second press says only what happens (D-88).** _Redrawn:_
   "Remove this photo everywhere and keep the evidence for the report?" A
   quiet line under it reads "@n8's account stays open. Closing it is a
   separate action on their Runners page.", followed by Remove and report /
   Cancel. The quiet line is there so the operator doesn't assume the account
   was closed. _Build:_ 128, S (`safety/components/ReviewQueue.tsx`, with
   the rest of round 28 #8's Review work). **Built in design PR A
   (2026-10-06)**, with the line said only when the author has a handle.
4. **`[UNDER REVIEW]` stays bracketed (D-90).** _Redrawn:_ the tag is
   `[UNDER REVIEW]` in MONO.xs ink with no fill, where SHARED would sit on
   the card. It doesn't breathe, because only a pending press breathes, and
   because it is ink rather than pink it doesn't read as one. Its accessible
   name is "Under review, only you can see this". Round 28 #6, round 27 #28
   and the Feed board are redrawn. D's `HIDDEN WHILE WE CHECK` band is
   unchanged apart from item 1's kicker. _Build:_ 129, S.
   `feed/components/UnderReview.tsx` moves from muted to ink, into the
   SHARED slot, and takes that accessible name. D's band is still round 28
   #6's unbuilt work, and the closet's run list is 128's. **Built in design PR D
   (2026-10-07):** the tag sits in the author row before the badge, ink
   MONO.xs, its brackets hidden from assistive tech and the sentence said
   instead (`feed/components/UnderReview.tsx`, `PostCard.tsx`); G's
   Recent entries carry it too.
5. **D7's revoked row, from T1 roles (D-92).** _Redrawn without opacity._
   The code is in `--quiet` with a line-through, `REVOKED` is in `--quiet`
   MONO.xs, and "Undo" is ink, semibold and underlined. After 10 seconds
   Undo goes and the row sorts to the foot unchanged. A failed Undo gets
   `STILL REVOKED` (item 14). The strike-through carries the meaning without
   colour. On the always-dark Desk, `--quiet` is T1's dark value, `#B9B8AE`,
   so it holds Accessibility 02. _Build:_ 126, S
   (`account/components/DeskAccess.tsx`, on PR B).

**C · Drawn**

6. **The terms prompt (`/account/terms`, item 42).** _Ruling: a page, not a
   sheet,_ on the panel "Keep your account?" uses. The prompt gates every
   route, so a sheet would have nothing real behind it, and a page has a URL
   for D-96's redirect. Four frames:
   - **Never accepted** (every account so far): the kicker `TERMS` in
     `cold-text`, "Accept the terms", "dialed.run has Terms now. Read them,
     then accept to carry on.", the link "Read the Terms", Accept / Log out,
     and "Rather not? Log out, or delete your account." There is no WHAT
     CHANGED block, because nothing changed for this runner.
   - **A version bump:** the kicker `TERMS UPDATED`, then "The Terms have
     changed. Read them, then accept to carry on." Under it is the owner's
     **WHAT CHANGED** summary: one to three lines, written when the version
     is published, as a plain list on `--tint`. Then "Read the full Terms".
     With no summary the block is left out. It never shows a diff, because a
     diff of legal text is unreadable on a phone.
   - **Changed again while open:** `NOT ACCEPTED` · "The terms changed again
     while this page was open. Read them once more.", directly above Accept.
     WHAT CHANGED refreshes to the newest version, and the next Accept
     records that one.
   - **Accept in flight, then failed:** `[ Accepting ]`, then `NOT ACCEPTED`
     · "Your connection dropped. Nothing was recorded." · Try again. A failed
     Log out gets `STILL LOGGED IN` under Log out.

   "Read the Terms" opens `/terms`, and that page's back link returns here.
   Accept is the only filled button, and the kicker carries no date. "delete
   your account" opens U1's delete confirm directly. A tab left open across
   the change lands here from its refused save, "carrying its payload (§4's
   session rule). After Accept the runner goes back to the filled form and
   saves again. Nothing is resubmitted for them." _Build:_ 126, M
   (`account/components/TermsPrompt.tsx`). The work is the two kickers and
   leads, chosen by whether the runner has any acceptance; the WHAT CHANGED
   block, which needs a per-version summary the owner writes beside
   `docs/legal/terms.md` and its published mark; the read link on its own
   line; the in-flight and failed copy; and the delete link going straight
   to the confirm. **Two parts are not adopted (owner, 2026-10-03).** The
   board calls the delete confirm "the one route the gate lets through";
   D-95 stands, so Get a copy and Settings › Account's reads stay allowed
   while a runner is behind on the terms. And the board returns the runner
   to the _filled_ form; D-96 stands, so Accept returns them where they were
   (`from`), or home, without restoring the form's values.

7. **Email reopen (D-89).** _Drawn as built, with one change:_ the account is
   named by its handle. It is from `hello@dialed.run`, with the subject "Your
   dialed.run account is open again". The body reads "We reopened
   @maya_runs. You can log in, and your runs are back as you shared them.",
   then **Log in** (a plain link to Au1, not a magic link) and the foot "Your
   handle is still yours." The footer is Privacy policy · Terms · Copyright.
   There is no reason line and no apology, since the operator's note stays on
   the Desk. If Strava was disconnected at the ban, it stays disconnected,
   and S1 says so, so the email doesn't. _Build:_ 126, S (`email/content.ts`'s
   reopen kind, on PR B; 128 sends it). The board names the handle "the way
   the ban email names it", but the ban email as built names none ("We
   closed your account…", item 36). The reopen email takes the handle anyway,
   and the ban email is not changed by this.
8. **Au5's note counter.** _Drawn as built._ Under 120 characters nothing
   shows. From 120, `128 / 140` sits right-aligned under the field in
   `--muted` MONO.xs. It takes no hue, because getting near the limit isn't a
   failure. Past 140 the count goes ink and semibold while typing. On send,
   the schema's "Keep the note under 140 characters." is the field message
   (the 2px border and the hi-viz message, because the fix is in that field),
   focus moves to the field, and the text is kept. The field never stops the
   typing and never truncates. The counter is the field's `aria-describedby`
   and is announced only at 120 and 141. _Build:_ 126, S
   (`account/components/RequestAccess.tsx`, on PR B): the right alignment,
   the ink and semibold state past 140, and the two announcements.
9. **`/open-source`.** _Ruling: grouped by licence and searchable, with each
   licence text printed once per group and each group collapsed to its first
   three packages._ Type comes first, "because it's the part the runner
   actually sees".
   - **The thank-you** is the kicker `OPEN SOURCE`, the heading "Built with
     thanks", the lead "dialed.run runs on code and type that people chose to
     give away. Here are all {N} pieces, grouped by licence, with a link to
     each project.", and the type group first, with "The two typefaces you
     read everything in." There is no mascot and there are no hearts. The
     page thanks people by naming them, and the copyright line is that name.
   - **A group** is headed by its licence and count. "Read the MIT licence"
     expands the full text once, inline, above the group's rows, and "Show
     all {N}" ends the group. Each row has the name, the shipped version, the
     copyright line and "Project", plus "Notice" where a licence needs its
     own (Apache NOTICE files). The smallest groups share one line: "ISC · 14
     · BSD-3-CLAUSE · 9 · …".
   - **Search** is a FormField, "FIND A PACKAGE", with the placeholder "Name,
     e.g. date-fns". It filters every group as you type, on the package name
     only. Empty groups hide, an expanded group stays expanded, and no match
     reads "Nothing we ship is called "xyz"." Clearing the field resets it.
   - **It's generated, not written,** from the lockfile and the font and icon
     manifests at release. There are no hand-kept rows.
   - **The layout** is the legal reading page: `MEASURE.column` (620), the
     lead step, a sticky contents column at desk listing the licence groups
     with counts, and "Back to contents" below desk.
   - **It's linked** from the signed-out footer and from Settings › About,
     after Copyright, as "Open source" · "What dialed.run is built on". It
     isn't in the email footer.

   _Build:_ 126, L. The work is a release-time generator for what the bundles
   and fonts ship, the page on `account/components/LegalPage.tsx`'s layout,
   the footer link (`ui/Layout.tsx`) and the About row
   (`onboarding/components/Settings.tsx`). The board's 214 entries and their
   versions are placeholders. **The type group has three families, not
   two:** `ui/fonts.css` ships Archivo, Archivo Black and IBM Plex Mono, so
   "The two typefaces" needs design's word once the generated list says
   three.

**D · Placeholders confirmed or redrawn**

10. **The confirm-email band (item 41).** _Ruling: it is not a region._ The
    band is static content, present on load, and it changes only on a
    reload. It has no `role="status"` and no live region, so it isn't a
    second region and rule 08 holds. It comes first in the column, above
    the first post, and scrolls with the feed. It has no dismiss and leaves
    on confirm. Resend's sending, sent and rate-limited states are announced
    through Feed's one visually hidden status region, and the band's text
    doesn't change. _Build:_ 126 and 129, S.
    `account/components/ResendLink.tsx` stops carrying its own status line
    in the band and reports into the host screen's region (Feed and You),
    which is 129's. `ConfirmEmailBand.tsx` is already an `aside` with no
    live region. Au4, which has no other region, keeps the link's own.
11. **The sheet's lead, per trigger.** _Two confirmed, one added and one
    given._ Useful: "Marking runs Useful needs a confirmed email." Report:
    "Reporting needs a confirmed email." **A3's share switch** (added, as
    round 27 #4's third trigger): "Sharing needs a confirmed email. This run
    saves private." **The email change** (its own): "Confirm this address
    before you change it." Then, for every trigger: "We sent a link to
    {email}." Round 27's list of all three things is struck, because the
    sheet names only the one that was refused. The Useful count doesn't
    change and gets no band, because nothing failed. The email-change sheet
    opens from U1's Email row "Change" while the account is unverified, and
    after confirming the runner goes back to U1 to change it. _Build:_ 126,
    S (`account/components/ConfirmEmailSheet.tsx`'s `WAITS_FOR`, the address
    line, and the email change's sentence in `ChangeEmail.tsx`). The share
    trigger is 127's if A3's switch opens the sheet: today only Useful,
    Report and the email change do.
12. **Resend on the sheet.** _A pill, outline._ It's the sheet's only real
    action, so it stays a 48px pill (`HEIGHT.control`), but outline, as Au4
    draws it, instead of ink, because Not now is focused and is the default.
    The band keeps the text link, because a pill in a hairline band would
    weigh more than the feed. Both run round 26's three states. _Build:_
    126, S (`ConfirmEmailSheet.tsx`; the band is unchanged).
13. **Google's bands (item 43).** _One place, under the button._ All of
    Google's bands go directly under its button, the fault ("Google didn't
    answer") and the refusals (`NOT CREATED`, `NOT LOGGED IN`), because §4a
    puts a band under the control it belongs to. The Au1 frame reads `NOT
LOGGED IN` · "Google didn't answer. Try again?" · Try again, under the
    button. _Confirmed:_ the refusals carry no Try again, because pressing
    again won't change them. They get the board's link or nothing, and only
    the fault gets Try again. _Build:_ 126, S (`auth/google-button.tsx`, on
    PR B): the fault band moves below the button. Round 22's Au6 still draws
    it above (see above).
14. **D7's small states (item 43).**
    - **`NEW`:** _confirmed,_ MONO.xs on hi-viz with ink. On the Desk,
      hi-viz is the accent for "look here" (D0). In the runner app item 1
      would forbid it.
    - **The made line:** _confirmed in ink,_ because no T1 role gives teal
      text on the Desk. The STATE column follows: UNUSED in ink, USED and
      REVOKED in `--quiet`. The board's teal and pink states are struck.
    - **Other row actions:** _No, on the row._ Every row action fails under
      its own row and names the state that's still true. Send invite: `NOT
SENT` · "Send invite didn't go through. No email went out. Try
      again?" Decline: `STILL WAITING` · "Decline didn't go through. The
      request is still here. Try again?" Undo: `STILL REVOKED` · "Undo
      didn't go through. Try again?" Revoke: `STILL ACTIVE` · "Revoke didn't
      go through. Try again?" Focus stays on the control that failed, the
      band is announced through the page's single status region, Try again
      repeats the same action, and nothing changes optimistically. The
      page-level `NOT CHANGED` band stays only for New code, which has no
      row yet.

    _Build:_ 126, M (`account/components/DeskAccess.tsx`, on PR B).

15. **O0's re-pick (round 27 #16).** _Confirmed:_ `NOT KEPT` with Try again,
    and `[ Keeping ]` in flight, per §4a and §5. Pick a new username stays
    the primary throughout. _Build:_ none (PR B).
16. **The legal pages (item 42).** _Both confirmed._ "Back to contents"
    shows below desk only. From desk up the contents column stays in view,
    and at wide (720–1039) the contents sit above the text, so the link
    shows there. The email footer reads "Privacy policy", "Terms",
    "Copyright", the same labels as Settings › About, and Open source isn't
    in it. _Build:_ none.
17. **`terms.csv` (D-95).** _Done on the board._ Round 28 #15's list adds
    `terms.csv` after `profile.csv`, with one row per accepted version:
    `version`, `accepted_at` (ISO 8601, UTC) and **`how`** (page or
    sign-up). _Build:_ 126, S, plus an additive migration.
    `terms_acceptances` holds `user_id`, `version` and `accepted_at` only, so
    `how` needs a nullable column that sign-up and the prompt write, with
    existing rows left empty. `account/export-sheets.ts` already writes the
    other two columns. **Two labels in the board's contents list are not
    adopted,** though it calls the list "as shipped". It names `runs/` where
    the build writes `run-files/`. And it describes `photos/` as "as
    uploaded, unblurred", which the product can't do: W3's promise is that
    "the unblurred frame never leaves the device" (`safety/blur/detect.ts`),
    so the ZIP holds the photo after the blur. The README in the ZIP stays
    the source for what it holds.

**A new board, not asked for: `Feed.dc.html`.** "Every shipping Feed state
in one place, redrawn with every ruling up to round 27: phone and desk,
light and dark." It takes over from the scattered E frames, and lists as
superseded the E1 card with kit chips and display names, the full Your
conditions screen (post-MVP), and the desktop feed's three-card rail. Most
of its "rules in force" restate earlier rulings and cite them: the card's
order, the badge in the author row, `@handle` in Archivo 600, Useful never
optimistic and failing with `NOT MARKED`, the five-runner floor, only SHARED
entries, and one 620 column under DS1 at desk, with no rail until Epic 200.
One rule cites only this board: **posts are divided by a 10px gutter of
darker ground, never a line**, running the full window width at desk. Its
colours are not T1 roles. `#E3E2D8` is `--photo`'s light value, whose job is
"Where a photo will be", and the dark `#1E1E24` matches no role (`--tint` is
`#1C1C22` and `--photo` is `#24242B`). The contract wins, so the gutter is
built from a T1 role or waits for design to name one. The desk match block's
12px radius is `RADIUS.card`. _Build:_ 129, S to M: audit the feed against
this board, which is now its composition truth. **Audited in design PR D
(2026-10-07):** built to it — the own card's `· YOU` and `[UNDER REVIEW]`,
the card photo's `1 / N`, Split and All, and RADIUS.card on the desk match
block; the rest already matched. Not built: the 10px gutter, which waits
for design to name a T1 role (posts keep their hairline meanwhile).
`e2e/conformance/feed-board.conformance.spec.ts` compares the own card
against the board.

**Conflicts for the owner.** None of these was adopted by the import. Each
quotes both sides and ends with a recommendation. **All four are resolved
(owner, 2026-10-03):** the three against owner decisions keep the decision,
and the kicker's face goes to design as open item 44. Each one's resolution
follows it.

- **The Desk rail's order (2) vs D-87.** D-87: _"Today, Review, Access,
  Duplicates and Runners."_ Round 29: _"Today, Review, Duplicates, Runners,
  Access"_, and round 28 #14a is amended to say D-87 reads that way. Round
  28's reason for its order was _"the queues that need a person first, then
  upkeep, then lookup. Access is a destination because it has its own
  queue."_ The round 29 ask quoted D-87 in the wrong order, and the board
  drew what it was told. The build's rail today is Today, Review,
  Duplicates, Gave up, Runners, Access. _Recommendation:_ keep D-87's order,
  which has a reason behind it, and ask design to redraw the rail. Or amend
  D-87 to the board's order, which is the build's minus Gave up. Either way
  Gave up leaves the rail. **Resolved: D-87 stands, and the board's order is
  not adopted.** The order came from our misquote, not from design. Lane 125
  builds Today, Review, Access, Duplicates, Runners (item 2).
- **The kicker's face (1) vs `tokens.js`.** Round 29: _"Archivo Black,
  11px, capitals, ink."_ The Form Contract's 02b samples draw it that way,
  and `docs/product.md` §4 says _"Kicker in Archivo Black, uppercase, 11px"_.
  `tokens.js` has no 11px step in the display family (TYPE.display is 32),
  its uppercase rule allows `text-transform: uppercase` on _"MONO.xs /
  MONO.sm / TYPE.display only"_, and its COLLAPSE maps _"'0.12em' board
  eyebrows"_ to MONO.xs. `ui/form.tsx`'s `FailureBand` draws the kicker as
  `MONO.xs`. Two contracts disagree, and round 29 amended neither.
  _Recommendation:_ keep MONO.xs, which is the type contract and what ships,
  and ask design to amend the Form Contract's samples and `docs/product.md`
  §4 to match. The other way, design adds the step to `tokens.js`, and that
  is a token port. **Resolved: no owner call is needed.** The two contracts
  disagree with each other, so it goes to design to reconcile in
  `tokens.js` as open item 44, with both sides quoted. `FailureBand` keeps
  `MONO.xs` meanwhile.
- **"The one route the gate lets through" (6) vs D-95.** Round 29: _"'Delete
  your account' opens U1's delete confirm directly, the one route the gate
  lets through."_ D-95: _"Get a copy is exempt from the terms gate, beside
  Delete account, Keep, Accept and sign-out … Settings › Account's two reads
  are exempt with it."_ _Recommendation:_ build the link straight to the
  delete confirm, which D-95 already allows, keep D-95's exemptions, and
  tell design the gate lets more than one route through. **Resolved: D-95
  stands, and "the one route" is not adopted.** Get a copy and Settings ›
  Account's reads stay allowed while a runner is behind on the terms. The
  link straight to the delete confirm is built (item 6).
- **Back to the filled form (6) vs D-96.** Round 29: _"The refused save
  lands here carrying its payload (§4's session rule). After Accept the
  runner goes back to the filled form and saves again."_ D-96: _"After
  Accept the runner returns where they were (`from`), or home"_, and
  `ui/terms-refusal.tsx` carries the path, not the form's values. The
  precedent the board cites is `docs/product.md` §4: session expiry _"routes
  to sign-in carrying the pending payload, and returns to the filled
  form."_ _Recommendation:_ treat it as a follow-up for the owner to
  schedule, not part of the prompt's build. The form's values have to
  survive a navigation to another route and back, and that is worth
  building once, for session expiry and the terms refusal together. D-96
  stands until then. **Resolved: D-96 stands, and the filled-form return is
  not adopted.** Accept returns the runner where they were (`from`), or
  home, and the form's values are not restored.

**For design's next round.** Open item 44 carries the kicker's face and the
two boards that were not redrawn. The rest are errata in the bundle, not
owner calls: the Feed gutter needs a T1 role; "The two typefaces" should be
three; the ZIP's list should read `run-files/`, without "unblurred"; and the
boards should match the three rulings not adopted above (D-87's rail order,
D-95's exemptions and D-96's return).

**Not asked in round 29, and still open in the queue:** item 36's
content-removed email; item 38's F rail card by category alone; and item
39's delete-sheet Google flow and its deletion, invite, Strava-disconnected
and digest emails. Item 41's last part (when the sheet opens, and over what)
was not asked either, and stands as built.

## Answered in round 28 (imported 2026-09-30)

Sixteen asks in three parts: amend the contracts and boards to match the
owner's decisions (1–4), draw what the launch sweep needs (5–9), and confirm
or redraw what it built as placeholders (10–16). **All sixteen are
answered.** They are on a new board, `Round 28 Rulings.dc.html`. Unlike
round 27, nothing is mirrored into `design/docs/product.md`, which is
unchanged. Design amended three other files in place: `Operator
Screens.dc.html` (D4's appeal line), `Round 27 Rulings.dc.html` (#11–#15,
#21 and #28, listed under the items below) and the Form Contract.

**Two contract files changed, and this time values moved.** Round 27's
contract changes were all additive text. Round 28 changes `tokens.js`'s
values and the number of steps in its type scale:

- **`tokens.js`** (item 1):
  - TYPE gains an eighth step, `field`: family `text`, 16px, line-height
    1.4, tracking 0, no transform. Its job: _"What the runner types and its
    placeholder, inside a FormField, textarea or the Desk search. Nothing
    else. Labels stay MONO.sm, hints TYPE.small."_ Was: no step; inputs
    were `body` (15 / 1.5).
  - Law 2 now reads "THE SCALE IS EIGHT STEPS (SEVEN TO READ, ONE TO TYPE
    INTO) AND A FOUR-STEP MONO RAMP", and the TYPE header says "eight
    steps".
  - COLLAPSE `'16px text'`: was `'TYPE.body'`, now `'TYPE.field inside a
field, TYPE.body everywhere else'`.
  - A new export, `HEIGHT`: `target: 44` (the hit-area floor,
    Accessibility 03), `control: 48` (filled and outline buttons, and the
    Google and Strava buttons), `field: 50` (FormField min-height). Was:
    none. 44 lived only in Accessibility 03 and `SPACE_RULES`, and 48 and
    50 lived nowhere. `CSS_VARS` emits `--height-*`, and the CONTRACT FOR
    AGENTS import list adds HEIGHT.
  - `RADIUS.field`: was `8` ("boards: 9 → 8"), now `10` ("inputs,
    textareas, selects, the Desk search … boards: 8/9 → 10").
  - `RADIUS.tile`: new, `10` ("the closet tile and its photo's top
    corners"). Was: missing.

  Two lines were not updated with the rest and now say otherwise: TYPE.body's
  `for` still lists "inputs", and the RADIUS header still says "five, plus
  none" (there are six). Both read as oversights. The new entries are
  explicit, and they win.

- **Form Contract**: 02a's four field samples are redrawn at radius 10 and
  min-height 50 (were 8 and 48). 02b's FormField paragraph now ends
  "carried in tokens.js as TYPE.field, HEIGHT.field and RADIUS.field (round
  28)". No rule changed.

**The import made one test fail, by that test's design, and the same PR
ports the values.** `test/ui/tokens.dom.test.tsx` pins `design/tokens.js`
against `src/styles.css`'s `@theme` block, and its doc comment says "Import
a new design round and this says which step moved". It expected 7 TYPE
steps (now 8), 6 RADIUS entries (now 7), `--radius-field` at 8 (now 10) and
11 named text steps (now 12), and found no `--radius-tile` or
`--text-field`. PR #134 ports item 1 (below) and the test pins HEIGHT too.
CLAUDE.md's "seven TYPE steps … five radii" is stale, and that file is the
owner's.

Lanes are the launch plan's: 125 ops/platform and the Desk shell, 126
accounts/auth/email/legal/export, 127 runs/Strava, 128 safety, closet and
moderation, 129 feed. "ui/shared" means `src/ui`, which 125 holds.

**A · Amendments to match owner decisions**

1. **Field type, radius and height.** _Done on the contracts:_ the Form
   Contract's 16 / 10 / 50 wins on all three (above). The field is 50 tall
   and buttons stay 48. _Build:_ ui/shared (125). Port TYPE.field,
   RADIUS.field 10, RADIUS.tile and HEIGHT into `src/styles.css`'s `@theme`
   and `src/ui/tokens.css`, and update `test/ui/tokens.dom.test.tsx`. In
   `ui/form.tsx` the field box moves from `text-body` to the field step, and
   from `min-h-12` (48, which never binds) to 50. `ClosetGrid`'s tile and
   photo take `RADIUS.tile` (128). Audit `rounded-field` before the value
   moves: it is also on things that are not fields (`FailureBand`'s Try again
   button, `AlreadyInCloset`'s thumbnail), and those would go to 10 with it.
   **Ported in PR #134:** `@theme` gains `--text-field` (16 / 1.4 / 0em),
   `--height-target` / `--height-control` / `--height-field` (44 / 48 / 50,
   with `--height-*` cleared) and `--radius-tile` (10), and `--radius-field`
   moves to 10; `tokens.css` declares no type or radius values, so it is
   unchanged. The field box draws `min-h-field text-field rounded-field`, the
   Desk search `text-field`, and `ClosetGrid`'s tile and Add tile
   `rounded-tile` (it has no photo yet). Every other `rounded-field` moves to
   10 with the value, since RADIUS has no 8 left: the buttons in
   `FailureBand`, `PhotoRefused`, `StravaConnect`, `SetConditionsSheet` and
   `StravaCallbackResult`, `KitPicker`'s kit tiles, `form.tsx`'s stacked
   option rows, `NamePieces`' group, `AlreadyInCloset`'s thumbnail,
   `ShadeSheet`'s photo and `FileWell`'s photo well. Moving those to the step
   their contract names (`pill` for buttons) is their lanes' work.
   `HEIGHT.control` and `HEIGHT.target` are ported and not yet worn; `feed`'s
   `RunnerSearch` keeps its `min-h-12` box, which the contract does not name.
2. **Appeals.** _Done on the boards:_ round 27's "Email ban" foot reads
   "Think we got it wrong? Reply to this email to appeal and we'll look
   again." Operator Screens D4 reads "If you think this is wrong, write to
   desk@dialed.run. A person reads every message." The same rule strikes
   "usually within a day" from round 27 #21 and #28, so no copy promises a
   time. This is D-73 exactly. _Build:_ 128. The ban email already matches
   (`email/content.ts`). `safety/components/AccountClosed.tsx` still says
   "answers within a week", and `safety/components/NoticeBand.tsx`'s `BEING
CHECKED` band still says "usually within a day". #28's line is item 6.
3. **Minimum age 16.** _Confirmed:_ Au2 draws "dialed.run is for runners 16
   and over." exactly. _Build:_ none. D-71, built in PR #130.
4. **A deleted handle is never released.** _Done on the board:_ round 27
   #14's note now reads "At day 7 everything else is deleted … The handle is
   never released: it stays in username_history for good, as after a rename
   (round 28 #4)." No runner-facing copy mentioned a release, so the copy
   stands. `/@handle` for a deleted runner shows #11's "This runner isn't
   here." _Build:_ none. D-56, D-72(6) and D-82, built in PR #130.

**B · Drawn**

5. **W3 waits for "Use this photo".** _Drawn:_ "W3 confirm" and "W3 confirm
   nothing". W3 stays open once auto-blur paints. The sheet head is "Check
   the blur", with Cancel on the right. The line under it reads "Auto-blur
   covered 2 areas. Tap the photo or a cell to change it." or "Auto-blur
   found nothing to cover. Tap the photo or a cell to blur an area." Under
   the cells sit **Use this photo** (ink) and **Pick another** (outline).
   Nothing is attached until Use this photo.
   - **Cancel** closes W3 and adds nothing. The form stays as it was, and a
     photo already on it stays.
   - **Pick another** opens the picker. A new photo replaces this one in W3
     and auto-blur runs again. Dismissing the picker returns to W3
     unchanged.
   - **Focus** lands on the heading, so Tab reaches the cells before the
     primary. Esc is Cancel.
   - After Use this photo, W3 closes and the upload runs in the form, with
     round 26's states.

   _Build:_ 128. `safety/components/PhotoBlur.tsx` stops closing on the
   first `onReady` (D-76, register R-113), along with the closet form that
   hosts it (`closet/components/GarmentForm.tsx`, `photo-pick.ts`).
   AttachKit (`feed/components/AttachKit.tsx`) is 129's, and takes the same
   sheet.
   **Built in design PR A (2026-10-06).** `PhotoBlur` draws the head
   ("Check the blur", Cancel), the drawn line, the photo and cells, and the
   foot (Use this photo, Pick another); focus lands on the heading and Esc
   is Cancel. It calls `onReady` only on Use this photo, which waits behind
   `aria-disabled` while the bytes are made; Pick another is its own hidden
   picker, and a new photo starts the check over. `ui/PhotoStep` gains a
   fourth argument, `cancel`: closet's `usePhotoPick` and feed's
   `AttachKit` close the step on it and keep nothing, which is the whole of
   their change. **Left for the hosts (design PRs C and D):** W3 still
   renders inline where the host puts it, not in a sheet. The undrawn
   states this needed are item 51.
   **The closet's host, built in design PR C (2026-10-07):** F, Edit and
   Y show W3 in `ui/Sheet` ("the closet form and AttachKit use the same
   sheet"), named "Check the blur", over whichever view picked the photo
   (`closet/components/photo-pick.tsx`). The sheet closing, by Esc or
   otherwise, is Cancel; Use this photo and Cancel close it and return
   focus to the well. `PhotoBlur` is unchanged.
   **AttachKit's host, built in design PR D (2026-10-07):** W3 in
   `ui/Sheet`, named "Check the blur", over A2 (`feed/components/AttachKit.tsx`).
   Any close of the sheet, Esc included, is Cancel; Use this photo and
   Cancel return focus to the well. `PhotoBlur` is unchanged. Once C had
   merged, the two hosts became one: the closet's hook moved to
   `ui/use-photo-pick.tsx` and AttachKit uses it, so A2's step now leaves
   with its sheet as the closet's does, and the sheet's name is one
   constant (R-141).

6. **Under review, as the author sees it.** _Drawn:_ "Feed own under
   review" and "D own under review". The card carries a hi-viz `UNDER
REVIEW` tag where its SHARED label would be, with no sentence. D carries a
   §4a band at the top: `HIDDEN WHILE WE CHECK` · "Only you can see this
   while we look at it." · "You can still edit or delete it." **There are
   no brackets**, because brackets mean a press is running. Profile and the
   closet's run list use the same tag. Other runners see nothing. If the
   entry is removed, #20's band replaces this one; if it is approved, the
   band and the tag go with no message. Nothing says who reported it, why,
   or how long it takes. Round 27 #28's band copy is amended to the same
   line. _Build:_ 129. `feed/components/UnderReview.tsx` (today
   `[UNDER REVIEW]` in muted bracket notation) becomes the tag on `PostCard`
   and the profile, and the band on `EntryDetail`. The closet's run list is
   128's. **The bracket form is D-67's wording, and it stays (D-90)**: the
   tag is `[UNDER REVIEW]`, not the board's plain tag. **Built in design PR D
   (2026-10-07):** the tag on the card and on G (round 29 #4's ink form),
   and `HIDDEN WHILE WE CHECK` at the top of D in safety's `NoticeBand`,
   which the route hands to `EntryDetail`; D no longer shows the tag.
7. **Settings › About.** _Drawn:_ "U1 About launch" and "U1 About full". An
   ABOUT group sits after Strava and before Log out, with one row per page
   that exists. **Privacy policy** · "What we keep, and who sees it" ships
   now (the build's sub-line, confirmed). **Terms** · "The rules for using
   dialed.run" and **Copyright** · "Report something of yours posted here"
   join when their pages do, in the footer's order. There are no disabled
   rows. Rows open the page in place, and Log out stays last, below its 2px
   rule. _Build:_ 126. Add the Terms and Copyright rows behind the same
   published mark as their pages (`onboarding/components/Settings.tsx`).
   `e2e/conformance/system-settings.conformance.spec.ts` can stop excluding
   the group by name once its comparison can read this board. D-80 stands.
8. **The Desk: review, takedown, runners, notice.** _Drawn:_ the Review
   page, four D8 states, Reopen, the CSAM second press and two notice bands.
   - **Review.** "Review · 4 WAITING · OLDEST FIRST", with the columns
     ITEM, BY, WHY IT'S HERE and AGE. One row opens at a time into a
     decision bar. The bar holds the item as posted, a context line
     ("Reported by 2 runners. On @n8's Sat, Aug 29 run, shared. Hidden from
     everyone but @n8 since the first report."), then **Approve**,
     **Remove**, and **Remove as suspected CSAM** set apart. A remove-reason
     select ("SHOWS WHERE SOMEONE LIVES ▾ · SENT AS #20'S NOTICE") goes with
     Remove. Approve puts the item back for everyone and tells the author
     nothing. Remove hides it and sends #20's band and email. After either,
     focus moves to the next row, which opens.
   - **CSAM** asks again in the row, with Cancel focused: "Remove it
     everywhere, close @n8's account and keep the evidence for the report?"
     · Remove and report / Cancel. There is no undo afterwards. The
     procedure behind it is the owner's.
   - **Takedown** is a form under the queue: "TAKEDOWN · FROM A NOTICE";
     WHAT (Photo / Entry); its ID; and THE NOTICE, with the hint "Paste it
     whole: who sent it, what they own, where it is." **Take it down** hides
     the item at once and records the notice against it. An unknown ID gets
     the field message "No photo has that ID."
   - **D8 search.** The placeholder is "Handle or email". Filters are text
     links with whole-table counts (All 412 · Reported 9 · Closed 6); the
     current one is ink, semibold and underlined, with `aria-current`.
     Results update as you type, matching the start of a handle or any part
     of an email, combined with the filter ("2 MATCH IN REPORTED"). No match
     reads "No runner matches "qz9"." · "Search by handle without the @, or
     by the whole email.", where the first row would be. Clearing the field
     is the reset.
   - **Reopen account** takes D3's place on a closed runner: "Lets them log
     in again and puts their runs back with the share state they had. They
     get one email saying so." It is one press, with no confirm. A failure
     is 02b's band, `STILL CLOSED` · "That didn't go through. Try again?".
     The email reads "Your dialed.run account is open again." The handle
     stays reserved.
   - **The notice band** is §4a without the retry. After a takedown it reads
     `PHOTO REMOVED` · "We removed this photo after a copyright notice." ·
     "Your run and verdict stay." "See the community rules" appears only
     once that page exists.

   _Build:_ 128, the largest item this round. `safety/components/ReviewQueue.tsx`
   drops "Decide this one" for the open row and gains the CSAM second press.
   The takedown form gets the unknown-ID message.
   `safety/components/DeskRunners.tsx` gets the live search, the filter
   states, the no-match state, and the Reopen panel on `bans.ts`'
   `unbanUser`. The notice band gets the takedown sentence. The reopen email
   is a new kind (128, sent through 125's outbox). **The CSAM confirm's
   "close @n8's account" and the new email were owner calls:** a CSAM
   removal does not close the account, so the confirm says only what
   happens (D-88), and the reopen email is added (D-89, 126 and 128).
   **Built in design PR A (2026-10-06):** "Decide this one" is gone and a
   row's name is the button that opens it, one row at a time, with focus
   moving to the next row after a decision; Remove as suspected CSAM asks
   again in the row, Cancel focused, in round 29 #3's words (the queue's
   subject read now carries the author's handle for its quiet line); and
   `ContentRemoved` says "We removed this photo after a copyright notice."
   for a takedown, from the audit row's action. **Not built here:** the
   Review page's table (ITEM, BY, WHY IT'S HERE, AGE), the decision bar's
   item-as-posted and context line, the takedown form's labels and its
   unknown-ID field message, D8's search states, Reopen, and mounting the
   notice band on the author's run (feed's). The bell row and email for a
   takedown still say the moderator's copyright reason
   (`feed/moderation.ts`'s `notice`, 129's); `takedownSentence` is there
   for it (R-140).

9. **Invite stage.** _Ruling:_ every refused code gets one sentence, whether
   it was used, never existed or was revoked: "That code doesn't work. Check
   it, or request access." Google gives the same messages in a band under
   its button.
   - **Au2, no code:** the field message "Enter the code from your invite."
     (built: "Enter your invite code.").
   - **Au2, Google with no code:** the band `NOT CREATED` · "Enter your
     invite code above, then continue with Google."
   - **Au2, Google with a refused code:** the band `NOT CREATED` · the
     sentence above · Request access (built: "Not signed in").
   - **Au1, Google with no account:** confirmed. The band reads `NOT LOGGED
IN` · "No account uses that Google address. Create one first." · Create
     an account.
   - **Au5:** the band `NOT SENT` · "Too many requests from here. You can
     send another at 7:42 PM." (#11's grammar, in local time). The note is a
     one-line FormField of 140 characters, with a counter from 120 and the
     hint "Where you run, or who sent you. One line."
   - **Back links** use the pack's `back` glyph and the destination's name,
     with no "←" or "‹" anywhere. Round 27's U1 header is redrawn the same
     way.
   - **D7:** ages are MONO.sm capitals: "NOW" under a minute, then "12M",
     "5H" and "3D", and a date ("AUG 29") from 30 days. Revoke leaves the row
     in place at reduced weight, showing `REVOKED` and Undo for 10 seconds
     with no countdown, then sorts it to the foot. A new code gets a status
     line above the list ("DIAL-7QX2 MADE · LINK COPIED") and a `NEW` tag on
     its row until the page reloads. When copying fails, the band reads `NOT
COPIED` · "Copying didn't work here. The link is selected: copy it
     yourself." with the URL shown selected. A failed row action is the band
     `STILL ACTIVE` · "Revoke didn't go through. Try again?" · Try again
     (built: `NOT CHANGED`).

   _Build:_ 126, in `lib/access.ts`, `auth/auth-copy.ts`,
   `auth/google-button.tsx`, `account/components/RequestAccess.tsx` (the
   back link, the limit, the note's 140 and its counter) and
   `account/components/DeskAccess.tsx` (`ageLabel`, the undo, the status
   line and the bands). **The revoked row's "reduced weight" is drawn as
   opacity**, which the contract overrides: it is built from T1 roles
   (D-92).

**C · Placeholders confirmed or redrawn**

10. **Too many tries.** _Reworded:_ "That's 5 wrong tries. You can try again
    at 7:42 PM." It is a field message on CURRENT PASSWORD, in local time
    with no seconds. The field stays usable, and pressing before then shows
    the message again. _Build:_ 126 (`currentPasswordLimited`, now in
    `lib/contracts/`).
11. **H's two silent states.** _Confirmed, both:_ H's column, the back link
    and the sentence as the lead are the whole page. "This runner changed
    their name." links nowhere. "This runner isn't here." covers purged,
    deleted **and never-existed** handles on purpose, so no one can tell them
    apart. _Build:_ 129. `feed/components/RunnerAtHandle.tsx` already matches.
    Check that an unknown handle reaches the same page rather than a 404 or a
    redirect (`feed/redirect.ts`' `orHandlePage`). The back link takes the
    `back` glyph (#9). **Built in design PR D (2026-10-07):** it redirected
    to /feed; `orHandlePage` now shows the page. A runner the viewer may not
    see (banned, unconfirmed, leaving, blocked or reported) already shares
    the never-held answer, so it gets the same page, and none can be told
    apart. The viewer's own handle still goes to G.
12. **"Keep your account?"** _Confirmed, with the body amended:_ it now ends
    "Keep it and your runs, closet and entries come back as they were.", so
    it no longer promises Strava back. The Strava line stays, in TYPE.small,
    muted (built in the quiet body cut). Round 27's frame is amended.
    _Build:_ 126 (`account/components/Leaving.tsx`).
13. **PR #129's deltas.**
    - **GOES / STAYS hues:** _No, ink._ Hue means verdict, and a merge
      outcome is not a verdict. GOES, SAME NAME, STAYS and SAVED TO CLOSET
      all go in ink, MONO.xs, and D-77's built hues are reversed. _Build:_
      128 (`closet/components/DeleteWithRuns.tsx`, `AlreadyInCloset.tsx`).
      **Built in design PR C (2026-10-07):** GOES and STAYS on the delete
      sheet, SAME NAME (and RETIRED beside it) on the rail, and SAVED TO
      CLOSET on F, all `text-ink` at MONO.xs.
    - **PHOTO NOT ADDED kicker:** _No, hi-viz:_ "Every §4a kicker sits on
      the hi-viz ground. Put round 26's back." **Not adopted: sent back to
      design (D-91, open item 40).**
    - **Retired date:** _No, month and year:_ "RETIRED MAR 2026" in MONO.sm
      on the rail. Retired gear is read across years, and the day doesn't
      matter. _Build:_ 128 (`AlreadyInCloset.tsx`; `closet/retired-label.ts`
      keeps the closet's own format). **Built in design PR C:** the rail's
      record line is MONO.sm and dates a retirement "Retired Mar 2026"
      (`retiredMonthLabel`); Y and C keep `retiredLabel`'s day.
    - **Middle cell:** _Yes,_ "Blur middle". The product is in US English,
      and "middle" pairs with top and bottom. The board's "centre" is
      corrected. _Build:_ none.
    - **Photo-less rail thumbnail:** _No, hatch._ The hatch means "no photo"
      everywhere (round 27 #31b), and the photo ground means a photo is
      still loading. _Build:_ 128 (`AlreadyInCloset.tsx`'s `bg-photo`).
      **Built in design PR C:** the photo fill hatched one T1 step darker
      (item 51).
    - **Edit's photo failures:** _Yes, reuse._ A saved photo that is refused
      gets #20's `PHOTO REMOVED` band. A removal that fails gets 02b's band
      under the photo: `PHOTO STILL ON` · "That didn't go through. Try
      again?" (built: "Photo kept"). _Build:_ 128 (`GarmentForm.tsx`,
      `GarmentDetail.tsx`). `feed/components/RetractEntry.tsx` also says
      "Photo kept" when D's photo delete fails. The ruling does not name it,
      but the same rule makes it `PHOTO STILL ON`. **Built in design PR C
      for the closet** (F's Edit and Y's Remove), and **in design PR D
      (2026-10-07)** for D's photo delete (`RetractEntry`). The band's
      sentence stays the control's cause line (item 51).
14. **Odds and ends.**
    - **Desk destinations:** _Five, in this order:_ Today, Review, Access,
      Duplicates, Runners. That is the queues that need a person first, then
      upkeep, then lookup. Access is a destination because it has its own
      queue. Gave up is a section on Today, carrying its count, because it is
      a list to check rather than a place to work. **This revises D-35, and
      the owner adopted it (D-87).** _Build:_ 125 (`ops/components/DeskShell.tsx`'s
      order; Gave up moves off the rail and onto `Today.tsx`).
    - **Photo-delete glyph:** `remove` (keywords: delete, trash, bin). The
      accessible name stays "Delete photo 2". _Build:_ 128. **Built in design PR D
      (2026-10-07)** on D's photos (`feed/components/RetractEntry.tsx`'s
      `DeletePhoto`). **Nowhere in the closet:** round 22 draws the
      closet's Replace and Remove as text buttons, and the one site
      round 27 #26 draws the glyph on is an entry's photo.
    - **Blur cell check:** the pack's `check` at 20px, paper on ink. _Build:_
      128 (`PhotoBlur.tsx`'s `BlurCells`).
15. **Export states.** _Three confirmed, two redrawn,_ in "U1 export
    states":
    - **Ready** (confirmed): "Emailed. The link works until Oct 7." with
      **Download** on the row (D-84, PR #132). The next day the row is idle
      again, and the emailed link works until its date.
    - **Failed** (redrawn): "Your export didn't finish, and it doesn't count
      as today's." with **Try again** (built: "Your export didn't work. Try
      again." with Get a copy). PR #132 already lets a new request through
      after a failure, so "doesn't count" is true as built.
    - **The press failing** (confirmed): `NOT STARTED` · "That didn't go
      through. Try again?".
    - **A link opened signed out** (confirmed) goes to log in, then to the
      row.
    - **An expired or someone else's link** (redrawn): the row's sub-line
      reads "That link doesn't work any more. Get a copy for a new one."
      Both cases read the same, so nothing about the other account shows.
    - **The ZIP:** kit.csv and profile.csv are added to round 27 #13's list
      (D-83, PR #132).

    _Build:_ 126, on PR #132's `account/components/ExportRow.tsx` and its
    token route. PR #132 is still open: it adds these states to open item 39,
    and records D-83 and D-84.

16. **The legal reading page.** _Two confirmed, one redrawn:_ mono `CONTENTS`
    (MONO.xs) and no LAST UPDATED line are confirmed, and round 27's Terms
    and Copyright kickers drop their dates. "↑ Contents" becomes **"Back to
    contents"** in TYPE.small, in link colour, with no arrow, because ↑ is
    not a product glyph. It shows only where the contents sit above the text
    (phone and wide). At desk the contents column stays in view and the link
    isn't drawn. _Build:_ 126 (`account/components/LegalPage.tsx`).

**Conflicts for the owner.** None of these was adopted by the import. Each
quotes both sides and ends with a recommendation, and the owner ruled on
all six on 2026-09-30 (D-87 to D-92); each one's resolution follows it.

- **§4a kickers on hi-viz (13) vs the Form Contract and `docs/product.md`
  §4.** Round 28: _"Every §4a kicker sits on the hi-viz ground. Put round
  26's back."_ The Form Contract's failure band: _"No fill, no yellow,
  values untouched."_ `docs/product.md` §4: _"No fill. No yellow — yellow
  means 'the fix is here' and it isn't."_ §4a is "the same band", and
  `ui/form.tsx`'s `FailureBand` builds the contract ("No hi-viz"). So the
  ruling would change every failure band in the product, not one. This
  round's own failure bands (`STILL CLOSED`, `STILL ACTIVE`, `NOT COPIED`,
  `NOT CREATED`, `NOT SENT`, `NOT STARTED`) are drawn the board's way too.
  The contract wins until design amends it. _Recommendation:_ ask design
  whether it means to amend the Form Contract, or only notice bands
  (`PHOTO REMOVED`, `BEING CHECKED`, `HIDDEN WHILE WE CHECK`), which offer
  no fix and are a different case. **Resolved: not decided, sent back to
  design (D-91).** The Form Contract and `docs/product.md` §4 stay in
  force, and `FailureBand` stays as built. The question is open item 40.
- **Five Desk destinations (14) vs D-35.** D-35: _"Its destinations are
  Today, Review, Duplicates and Runners."_ Round 28: _"Today, Review,
  Access, Duplicates, Runners … Gave up is a section on Today."_ The build's
  rail already carries Access, and `DeskShell.tsx` also names Gave up.
  _Recommendation:_ supersede D-35 with the five, and record round 27 #22's
  "no separate runner page" in the same row. **Resolved: adopted (D-87),
  amending D-35.** The five are the board's, and Gave up lives under
  Today. Build work for 125, not this PR.
- **The CSAM second press (8) vs D-70.** Round 28's confirm: _"Remove it
  everywhere, close @n8's account and keep the evidence for the report?"_
  D-70: _"A suspected-CSAM quarantine is silent and preserves everything for
  a year … The owner reports to NCMEC's CyberTipline by hand."_ D-70 does
  not close the uploader's account, and `safety/quarantine.ts` does not
  ban. The board itself says the procedure is the owner's.
  _Recommendation:_ decide whether a CSAM removal also closes the account;
  the confirm's copy follows that decision. **Resolved: it does not
  (D-88).** Quarantine stays separate from closing an account and never
  closes one by itself, as D-70 and `quarantine.ts` already behave. The
  board's "close @n8's account" is not adopted: the confirm says only what
  happens. Build work for 128.
- **The reopen email (8) vs D-43.** Round 28: _"The runner gets one email:
  'Your dialed.run account is open again.'"_ D-43 says _"Which emails exist
  at launch"_: verify, password reset, email change, Strava broken or
  revoked, content removed, ban. Round 27's export and deletion emails are
  not on that list either. _Recommendation:_ add it as transactional mail,
  and bring D-43's list up to date. **Resolved: added (D-89), amending
  D-43's launch-email list.** Build work for 126 and 128.
- **The under-review tag without brackets (6) vs D-67.** D-67: _"marked
  `[UNDER REVIEW]` on the card and on D"_. Round 28: _"No brackets.
  Brackets mean a press is running."_ Round 27 #28 already drew the tag,
  and D-67's substance (the author always sees their own entry) is
  unchanged. _Recommendation:_ amend D-67's wording to the hi-viz tag and
  the band. **Resolved: not adopted (D-90).** The tag stays D-67's
  bracketed `[UNDER REVIEW]`.
- **The revoked row's opacity (9) vs T1 and Accessibility 02.** The board
  draws "reduced weight" as `opacity: 0.55` over the whole row. T1:
  _"Full strength, never opacity"_ (on `--quiet`, and again on
  `--dialed-tint`). Accessibility 02 sets 4.5:1 for body text, which a muted
  mono line at 55% will not hold. The contract wins without an owner call.
  _Recommendation:_ build the reduced weight from T1 roles (`--quiet` text,
  `REVOKED` in its state colour), and tell design. **Resolved by
  precedence, with no owner call (D-92).** The contract wins; the reduced
  weight is built from T1 roles.

**Round 27's disagreements this round resolves:** Form Contract §02b vs
`tokens.js` (tokens.js amended to 16 / 10 / 50, item 1); the closet tile's
radius 10 (`RADIUS.tile`); the deleted handle's release vs D-56 (board
amended, item 4); the minimum age (D-71, confirmed, item 3); and the ban
email's appeal (D-73, boards amended, item 2). Round 28 does not address the
other four: per-entry OG cards vs D-51, indexing vs D-53, D8's missing runner
page vs D-35 (folded into the destinations conflict above), and the Strava
disconnect email's wording.

**Not asked in round 28, and still open in the queue:** item 36's
content-removed email ("one of your runs", and a Log in button); item 38's F
rail card by category alone, which should settle with D-75's TYPE picker; and
item 39's delete-sheet Google flow and its deletion, invite,
Strava-disconnected and digest emails.

## Answered in round 27 (imported 2026-09-27)

Thirty-one asks in three parts: amend the contracts and boards to match the
owner's decisions (1–9), draw what the launch sweep needs (10–23), and
confirm or redraw what it built as placeholders (24–31). **All thirty-one are
answered.** They are on a new board, `Round 27 Rulings.dc.html`, and
mirrored in `design/docs/product.md` §Round 27. Design also changed
`Round 26 Rulings.dc.html` (the Google label is Archivo in every frame, and
the Roboto font request is gone) and both `Remaining Screens` boards (§AH
rule 08 amended, light and dark).

**Four contract files changed this time**, unlike round 26. Every change is
additive text: no T1 role, token value, glyph or motion value changed, and
the token, contrast, icon, motion and architecture tests pass unchanged
(`test/ui`, `test/architecture` and the three other test files that read
`design/`: 48 files, 1145 tests). What
changed:

- **Accessibility Contract §06** gains a second paragraph: _"One exception,
  FormField (round 26 #16): the ring sits on the field's own border, 2px
  ink, offset −1px, so nothing draws outside the field. Error stays distinct
  from focus: a 2px ink border plus the hi-viz band. With error and focus
  together the line is the same and the band tells them apart."_ The
  contract now says what D-48 decided and what `src/ui/a11y.css` already
  builds (`.field-box:has(:focus-visible)`). _Follow-up:_ none in values.
  The comments in `a11y.css` and D-48's "overrides §06" wording are now
  stale.
- **Theme T1** gains a block, `data-part="palette-exemptions"`, headed
  "EXEMPT FROM THIS TABLE · TWO PARTS, NO OTHERS":
  - `google-button`: Google's fill, border and label colours (light
    `#FFFFFF` / `#747775` / `#1F1F1F`, dark `#131314` / `#8E918F` /
    `#E3E3E3`) and the official four-colour G. The label is Archivo 500. It
    swaps by Google's own light/dark pair, not by T1.
  - `strava-button`: Strava's official orange "Connect with Strava" asset,
    48 tall, unaltered, the same on both themes, and only on the connect
    action.
  - _"Anything else carrying a colour outside this table is a bug,
    including Strava orange on a disconnect or status row."_

  The eighteen roles are unchanged. _Follow-up:_ `src/ui/tokens.css` and
  `styles.css`'s `@theme` need nothing. `test/architecture/palette-only.test.ts`
  hard-codes the Google exemption by path; it could read the two parts
  from the contract instead.

- **`icons.js`** gains a FOREIGN MARKS paragraph in its header (brand
  assets, not icons: never in `ICONS`, never recoloured, never used
  elsewhere) and a new export, `FOREIGN_MARK_PARTS = ['google-button',
'strava-button']`. `ICONS` is byte-identical, so the 77-glyph manifest is
  unchanged. _Follow-up:_ `src/ui/icons.tsx` can port `FOREIGN_MARK_PARTS`
  as the one list the palette test and the two buttons' `data-part`s read.
- **Form Contract** gains §02b, "Height · controls that aren't forms":
  - _"FormField is 50px tall (min-height), 16px type, content centred,
    radius 10. The 2px error border draws inward and never changes the
    height. Focus: the ring sits on the border, 2px ink, offset −1px."_
  - _"A control that isn't a form fails one way: the §4a band, sized to
    the thing that failed, directly under it. The kicker names the state
    that's still true; it offers one retry verb when retrying can work, and
    none when it can't. No field is marked, and no summary block appears."_

  _Follow-up:_ `ui/form.tsx`'s field box is `min-h-12` (48), which never
  binds, and reaches 50 through its padding. The 50 should become the real
  minimum. **"16px type" and "radius 10" are not contract values**; see the
  list at the end of this section.

Lanes are the launch plan's: 125 ops/platform, 126 accounts, 127
Strava/logging, 128 content & safety (which owns the closet this sweep), 129
feed. "ui/shared" means `src/ui`, which 125 holds as the platform lane.

**A · Amendments to match owner decisions**

1. **Focus on a field.** _Done on the contract:_ Accessibility §06 carries
   the FormField exception (above). _Build:_ none. D-48 is now what the
   contract says.
2. **The Google and Strava exemptions.** _Done on the contracts:_ T1's
   exemption block and `icons.js`'s `FOREIGN_MARK_PARTS` (above). _Build:_
   none required. Optionally, port the list and derive the palette test's
   exemption from it (ui/shared, 125).
3. **The Google label.** _Drawn:_ "Google button light r27" and "Google
   button dark r27". Archivo 500, 15px, in Google's label colour. The G,
   fill, stroke and pill stay Google's. Round 26 #13's frames, Au2 and the
   invite stage now say Archivo, and the Roboto request is gone from every
   board. _Build:_ none. It is D-49 and D-55, and the build already matches.
4. **Unverified saves private.** _Drawn:_ "A3 share unverified" and "A3
   share verified", and the link landing. The share switch shows off (full
   strength, never disabled) with "Confirm your email to share. This run
   saves private."; pressing it opens #17's sheet. Verified, the sub-line is
   "Signed-in runners can see it. Search engines and link previews can't."
   The confirm landing now reads "Email confirmed" · "New runs follow your
   sharing setting. Runs you logged before today stay private; share any of
   them from the run." · Open dialed.run. "Shares when you confirm your
   email." and "3 runs shared." are gone. The WAITS list is share (saves
   private), Useful, report and email change. _Build:_ 126 (D-50), with the
   A3 switch copy in 127's logging flow.
5. **Legal page type.** _Ruling:_ the contract's 620 measure and `lead`
   step on /privacy, /terms and /copyright. 680 and 17/1.65 are struck
   from product.md. _Build:_ none new. D-52 and 126's ACC-13 already say
   this.
6. **§AH rule 08.** _Done on the board:_ both `Remaining Screens` boards
   read "…and no swatch unless the shade is exact (amended round 26 #5): a
   named colour alone gets no square." _Build:_ none.
7. **"Public" is retired from the copy.** _Drawn:_ a WHERE / WAS / NOW
   table:
   - A3's share switch: "Share publicly" becomes "Share with runners on
     dialed.run".
   - The settings default: "New runs are public" becomes "Share new runs
     with runners on dialed.run".
   - F and A3's state label: `PUBLIC · PRIVATE` becomes `SHARED · PRIVATE`.
   - D's owner meta line: "Public entry" becomes "Shared with runners on
     dialed.run".
   - The nag band: "Confirm your email to share runs with other runners." ·
     Resend link.
   - /privacy §4's heading: "What's public" becomes "What other runners
     see".

   Stored values can stay `PUBLIC`. **Only the default share card ships**
   (wordmark, "Log runs, see what worked", ink ground, og:title "dialed.run"
   on every URL), and round 26 #22's per-entry card is struck. **Indexing:**
   until public launch every response sends `X-Robots-Tag: noindex` and
   robots.txt disallows all. After launch only `/` is indexable. /privacy,
   /terms and /copyright stay noindex but reachable, and the invite flag
   flips it. **Signed-out `/@handle` and entry URLs go to Au1 with "Log in
   to see this run."** _Build:_ the copy across 127 (A3), 129 (D, the
   settings default) and 126 (the nag, /privacy). The default card, the
   header and robots.txt belong to 125. The signed-out redirect belongs to 129. **This supersedes D-51, and differs from D-53**; see below.

8. **Unsubscribe is one press.** _Drawn:_ "Unsubscribe landing" and
   "Unsubscribe done". The body link opens a signed-out page, "Stop run
   reminder emails?", with the address masked ("ma•••@example.com") and one
   ink **Unsubscribe** button that POSTs. The done state on the same URL is
   "Run reminder emails are off" · Turn them back on (also a POST). A
   failure is a §4a band, `STILL SUBSCRIBED` · "That didn't go through. Try
   again?". The link is signed and never expires, and a second visit shows
   the done state. The mail client's List-Unsubscribe-Post stays one click.
   **The same rule covers every state-changing link**, including "This
   wasn't me" (#15). This overrides round 26 #19. _Build:_ 125 (the signed
   link and the page), 126 ("This wasn't me").
9. **Reset confirms the email.** _Ruling:_ yes. Password reset moves from
   WAITS to CAN, and saving a new password from the link marks the address
   confirmed. _Build:_ 126, drawn in #10.

**B · Drawn**

10. **Password reset.** _Drawn:_ "Au1 Forgot it", "Au6 Reset request", "Au6
    Check inbox", "Au7 New password" and "Au7 Link expired".
    - "Forgot it?" sits right-aligned on Au1's PASSWORD label line and
      carries the typed email into Au6.
    - Au6 is "Reset your password" · Send reset link. "Check your inbox"
      reads the same for any address: "If {email} has an account, a reset
      link is on its way. It works once, for one hour."
    - Au7 is "Set a new password", with "Saving confirms this email and
      signs out your other devices." · Save and log in.
    - An expired or used link reads "That link has run out" · Send a new
      link.
    - A new request kills the old link. The rate limit reads `NOT SENT` ·
      "That's 5 links this hour. You can send another at 7:42 PM.", shown
      only to the same browser.
    - Google-only accounts get the email with "Set a password".
    - After saving, the runner lands on Closet with "Password changed.
      Other devices are signed out." A banned account's link lands on D4.

    _Build:_ 126.

11. **U1 · Account.** _Drawn:_ "U1 · Settings › Account · email change
    pending", plus sheets for "U1 Change email", "U1 Change password" and
    "U1 Sign out everywhere". U1 is one list: Email, Password, Sign out
    everywhere, Export your data, then Delete account, set apart. Every
    takeover-grade change asks for the current password, and Google-only
    accounts re-authenticate with Google instead.
    - **Email:** the new address gets a confirm link, and the old one a
      notice with "This wasn't me". The old address stays live until
      confirmed, and only one change can be pending. A wrong password reads
      "That's not your current password.". An address already in use runs
      the same flow, and its owner gets round 26's existing-account email.
    - **Password:** "Your other devices will be signed out."
    - **Sign out everywhere:** the retire-confirm grammar, landing on Au1
      with "Signed out everywhere."

    _Build:_ 126.

12. **Legal lines and pages.** _Drawn:_ "Au2 legal lines", "Au5 Turnstile",
    "Terms desk" and "Copyright desk". Under Au2's form: "By creating an
    account you agree to the Terms and have read the Privacy policy." and
    "dialed.run is for runners 16 and over." There is no checkbox, and the
    server stores the terms version and time. **Turnstile runs managed,
    directly above the primary**, on Au2 (it covers Google too, before the
    redirect) and Au5. It is not on Au1 or Au6. A Turnstile failure reads
    `NOT SENT` · "We couldn't check this browser. Reload the page and try
    again." /terms and /copyright use /privacy's layout at the contract's
    type. The footer order is Privacy · Terms · Copyright, and Copyright
    carries the takedown address. _Build:_ 126 (ACC-6, ACC-13). **The age,
    16, is an owner call**; see below.
13. **Export.** _Drawn:_ U1's row and the "Email export". "Get a copy"
    becomes `[ Preparing ]`, with "We'll email a link when it's ready." It
    is limited to one a day. The ZIP holds runs.csv, entries.csv,
    garments.csv, the original run files and photos, and a README naming
    each column. The link works for 7 days, only while logged in. _Build:_
    126, with 125 for the queued job and R2.
14. **Delete account.** _Drawn:_ "U1 Delete account", "Delete pending" and
    "Delete pending sign in". The confirm takes the current password (or a
    Google re-auth) and reads "Log in before Sat, Oct 4 to keep
    everything.". During the 7 days every device is signed out, shared runs
    leave the feed and the Call at once, and the handle stays reserved.
    Logging in shows "Keep your account?" · Keep my account / Log out, and
    never cancels silently. At day 7 everything goes, **the handle is
    released**, and no further email is sent. _Build:_ 126, with 125 for
    the purge cron. It also needs the "retire, don't delete" exception the
    audit named (§2.1). **Releasing the handle contradicts D-56**; see
    below.
15. **The remaining emails.** _Drawn:_ "Email reset", "Email change new",
    "Email change old", "Email Strava disconnected", "Email content removed",
    "Email ban", "Email export" and "Email delete scheduled", all in round
    26's template. All are account mail: always sent, with no unsubscribe.
    The ban email carries no case number, and appeals are by replying within
    30 days, when a different moderator looks (superseded by D-73: no
    deadline and no second moderator). _Build:_ 125 (sending), 126
    (reset, change, export, delete), 127 (Strava), 128 (removed, ban).
16. **Moderator force-rename.** _Drawn:_ in D8 Runners' right column
    (Rename above D3's ban panel), and "What the renamed runner sees".
    - A reason comes from a fixed list: Offensive or sexual · Pretends to
      be someone else · Contains personal information · Advertising.
    - The handle becomes `@runner_NNNN`, and the old handle is blocked for
      everyone.
    - On their next load the runner sees O0's field once: "USERNAME CHANGED
      BY A MODERATOR" · "Pick a new username" · "@x broke the rules on
      names: {reason}. For now you're @runner_4821." · Save username / Keep
      @runner_4821 for now.
    - No email is sent.

    _Build:_ 128 (the desk control), 126 (the screen). Remembering that a
    re-pick is owed is likely an additive column.

17. **"Confirm your email first" sheet.** _Drawn:_ Body: "Sharing, marking
    runs Useful and reporting need a confirmed address. We sent a link to
    {email}." Buttons: Resend link / **Not now** (focused). The first word
    follows the trigger. _Build:_ 126, opened by 129 (Useful), 128 (report)
    and A3's switch (#4).
18. **Strava is full.** _Drawn:_ "T1 Strava full". The build's copy stands,
    with contractions ("while it's reviewed"). The band replaces the button
    for that attempt, and the button returns on the next visit. In
    onboarding, Skip becomes Next. _Build:_ 127, a copy tweak.
19. **Disconnected on Strava's side.** _Drawn:_ "S1 Strava revoked" and the
    email. The band reads `NOT CONNECTED` · "You disconnected dialed.run on
    Strava, so run reminders have stopped." · "Runs you already added stay."
    Strava's official Connect asset sits beside it. When Strava ends the
    connection itself: "Strava ended the connection, so run reminders have
    stopped." The email is sent once per disconnect. _Build:_ 127.
20. **Content removed.** _Drawn:_ "Content removed notice" and the email.
    Where the thing was, the band reads `PHOTO REMOVED` · "A moderator
    removed this photo: it shows where someone lives." · "Your run and
    verdict stay." · See the community rules. The kicker is `NOTE REMOVED`
    or `REMOVED FROM THE FEED` for a note or a whole entry, and the bell
    gets one row. _Build:_ 128, with the bell row in 129.
21. **A garment photo being checked (R-69).** _Drawn:_ "Garment photo
    checking". The band reads `BEING CHECKED` · "Only you can see this photo
    until it's checked, usually within a day." The photo and its closet
    tile carry an `ONLY YOU` tag. If the photo is refused, #20's band says
    why. _Build:_ 128 (the closet this sweep).
22. **Desk › Runners.** _Drawn:_ "D8 Runners" (412 ACCOUNTS). A search
    ("Handle or email") with All / Reported / Closed. The table has HANDLE,
    EMAIL, JOINED, RUNS, REPORTS and STATE (`ACTIVE`, `PENDING DELETE`,
    `CLOSED`). The selected runner's right column holds Rename, then Close
    account (D3, moved here from the entry view). A row click selects;
    **there is no separate runner page**. Reports here count only reports
    on the name or profile. _Build:_ 128. It revises D-35's "banning lives
    on a runner's page".
23. **Banned, via Google.** _Confirmed and drawn:_ "Au1 account closed
    Google". D4's band sits on Au1 over the empty form: `ACCOUNT CLOSED` ·
    "This account was closed for breaking the community rules." · "Think we
    got it wrong? Reply to the email we sent you." There is no case line.
    The same applies to a password log-in, and it never says whether the
    password was right. _Build:_ 126, as built.

**C · Placeholders confirmed or redrawn**

24. **Failure on a control that isn't a form.** _Confirmed as the rule_ and
    written into the Form Contract as §02b (above). _Build:_ none. Open item
    26 closes.
25. **Two feed words.** _Ruling:_ the leading consensus bar reads "Most" and
    the rest "Some". **New:** a tie for the lead reads "Split" on each tied
    bar, and a single bar reads "All". The bell reads "Notifications, 3
    new", and above 9, "Notifications, more than 9 new", not "9+". The dot
    never draws a digit. _Build:_ 129 (`BAR_WORD` gains Split and All; the
    bell's name above 9). **The bar words are built in design PR D
    (2026-10-07)** (`feed/bar-share.ts`): Split on each bar tied for the
    lead, All on a lone bar, Most on the one leading bar whatever its share
    and Some on the rest; every word but Some is pink. How the words read
    when groups overlap is open item 54. The bell's name above 9 is notifications', and still
    says "9+" (R-141).
26. **Deletes.** _Drawn:_ "Delete entry sheet", "Delete run sheet", "Delete
    photo sheet" and the D owner foot. Entry and run deletes are text links
    at the foot under a `YOURS` kicker (with "Edit this entry" above), for
    the owner only. **There is no overflow menu.** "Delete photo {n}" moves
    onto the photo as a 44×44 icon button, top right, named "Delete photo
    2". The confirm grammar is confirmed. The bodies:
    - Entry: "Your verdict, kit and note for this run go, and it leaves the
      feed and your Call's record. The run stays. This can't be undone."
    - Run: "The run, its weather and its entry go, and your pieces lose
      this wear. This can't be undone."
    - Photo: "It comes off this entry for everyone. The entry and its other
      photos stay. This can't be undone."

    _Build:_ 128 (`RetractEntry`, the photo button), 127 (`DeleteRun`), and
    ui/shared (`ConfirmSheet` copy slots). **The board names no glyph for
    the photo button**; the pack has `remove` and `close`. **Built in design PR
    D (2026-10-07):** YOURS over "Delete this entry" at D's foot, `remove`
    top right on each owner's photo, and the entry and photo bodies and
    verbs as drawn. "Edit this entry" has no screen to open yet, so it is
    absent (R-141).

27. **W3's keyboard blur cells.** _Redrawn:_ a 3×3 grid of 44px square
    cells that maps the photo, not a row of pills. A pressed cell is ink
    with "✓", and the names stay "Blur top-left"…. Focus outlines the
    matching ninth on the canvas. _Build:_ 128 (`PhotoBlur`'s `BlurCells`).
    The "✓" should be the pack's `check`, not a text character.
28. **Own entry under review (R-62).** _Drawn:_ a hi-viz `UNDER REVIEW` tag
    on the card, and a §4a band on the detail: `HIDDEN WHILE WE CHECK` · "A
    runner reported this entry. Other runners can't see it until a
    moderator has looked, usually within a day." · "You can still edit or
    delete it." Neither says who reported it or why. _Build:_ 129 (card and
    detail) on 128's review state. R-62 closes once it is built.
29. **"Photo not added."** _Ruling:_ the kicker stays. The body becomes
    "This photo couldn't be prepared without blur. Turn blur on, or pick
    another photo." _Build:_ 128 (`PhotoBlur.tsx`).
30. **D4 without a case number.** _Confirmed:_ the case line is omitted, and
    the board's `CASE [B-0031]` is struck. Appeals go by replying to the ban
    email. _Build:_ none.
31. **Three measurements.**
    - **Field height:** 50px, now in the Form Contract (§02b) as
      FormField's min-height. _Build:_ ui/shared (`form.tsx`).
    - **Closet tile:** the photo is `aspect-ratio: 4 / 5`, full tile width,
      with rounded top corners, and the hatch when there is no photo. It has
      no fixed height. _Build:_ 128 (`ClosetGrid`).
    - **The desk primary:** sized to its label, left-aligned in the primary
      column, at desk (≥1040). Full width is phone only. Round 25 wins.
      _Build:_ ui/shared (`SubmitButton` at `desk`).

**Where a ruling and a contract, or an owner decision, disagree.** None of
these is resolved by this import. Each needs design to amend the contract
file or the owner to decide.

- **Form Contract §02b vs `tokens.js`.** "16px type" is not a TYPE step
  (`body`, 15, is the one tokens.js assigns to inputs), and "radius 10" is
  not a RADIUS step (`field` is 8, "boards: 9 → 8"). Both are contracts.
  Under the collapse rule the build keeps `text-body` and `rounded-field`,
  and takes only the 50px minimum and the behaviour.
- **The closet tile's "radius 10 on top" (31b)** is also not a RADIUS step.
  `card`, 12, is the one tokens.js names for photo wells.
- **Per-entry OG cards (7) vs D-51**, which says they are generated now.
  The round 27 ask itself ("link previews never show entry data") and D-58
  point the other way. D-51 needs superseding by the owner.
- **Indexing after launch (7) vs D-53.** D-53 flips "the landing page and
  other public marketing pages" to index. Design keeps /privacy, /terms and
  /copyright noindex, so only `/` is indexed.
- **Deleted accounts release their handle (14) vs D-56**, which says a
  handle a runner leaves "stays in `username_history` for good" and is
  never reclaimable by another runner.
- **The minimum age, 16 (12).** The audit (§1.3) lists the minimum age as
  undecided, and ACC-6 says the owner's terms set it. Design chose it.
- **Desk › Runners (22) vs D-35.** D-35 has banning live "on a runner's
  page". D8 has no runner page. This is design revising its own round 8
  call, and needs noting in D-35.
- **The ban email's appeal (15)**: "Reply within 30 days and a different
  moderator will look" is a moderation-process commitment for the owner.
  **Decided: D-73** (owner, 2026-09-29). An appeal carries no deadline, no
  timeframe and no "different moderator" — the service has one operator.
  The ban email reads "Think we got it wrong? Reply to this email to
  appeal and we'll look again.", and D4 drops "answers within a week".
- **The Strava disconnect email (19)** is another effect of Strava's side
  of the connection. CLAUDE.md's product rule says the webhook's only
  effect is a notification row. D-43 already lists "Strava broken or
  revoked" mail, so this is wording to update, not a conflict of substance.

**Round 26's disagreements this round resolves:** field focus vs §06 (§06
amended); the exemptions on a board only (now in T1 and `icons.js`);
Roboto (gone); privacy page type (the contract); queued shares (dropped,
matching D-50); and §AH 08 (amended on its board). The privacy link under
Au1 stays declined, as D-52 accepted.

## Answered in round 26 (imported 2026-09-25)

Twenty-two asks: round 24's eight, carried in full, F at the desk as round 25
promised, eight new ones, and four addenda from the owner (19–22). **All
twenty-two are answered.** They are on a new board, `Round 26
Rulings.dc.html`, each section marked with the board it will fold into, and
mirrored in `design/docs/product.md` §Round 26. Design also changed `Round 22
Coverage.dc.html`: every "HEIC" on the photo well is now "JPG, PNG or WebP",
and the `[TOO MUCH]` flag is gone from "D Someone else's entry".

**No contract file changed.** `tokens.js`, `motion.js`, `icons.js`,
`Theme.dc.html` and the Form, Desktop and Accessibility Contracts are
byte-identical to round 25, and the token, contrast, icon and motion tests
pass unchanged. **Several rulings nonetheless describe values the contracts
do not hold.** They are listed at the end of this section. Until a contract
file says otherwise, the contract wins.

Lanes are the launch plan's: 125 ops/platform, 126 accounts, 127
Strava/logging, 128 content/safety, 129 feed. The plan names no closet lane,
so closet items name task 122's code and need an owner.

**Carried from round 24, drawn**

1. **A1 · fixing the start time.** _Drawn:_ "A1 Time correction" and "A1
   Time correction desk". The time on the stats line is a button, "Change
   start time, 6:04 AM". It opens a START TIME row inside the parsed card
   with the hint "The file said {t}. Change it if your watch's clock was
   off.", a time field, and **"Get weather"** (not "Refetch": _"Refetch is
   our word, and the runner's word is weather"_). While it fetches, the
   conditions block reads `WEATHER FOR {t}` · [ Getting it ] · `WAS {old} ·
AT {t0}`. At the desk that block is in the rail. On success the row
   closes and the stats line reads `{t} · CHANGED`. On failure a §4a band
   reads `STILL {t0}` · "Couldn't get weather for {t}. Try again?", and
   **both the time and the conditions revert**, so a run never carries a
   time whose weather we don't have. The date is fixed. A primary action
   pressed mid-fetch waits in brackets and then goes. _Build:_ rename the
   button, add the WAS state and the revert. 127 (task 121's code).
2. **R2b · Set conditions.** _Drawn:_ "R2b Set conditions". There are two
   required picks and nothing is preselected. **How warm:** the build's
   twelve 5 °C bands, labelled in the runner's unit (°F −4–5 … 95–104, all
   whole numbers), in a 3-column radiogroup, coldest top-left, with no
   open-ended cells. **Sky:** Dry / Damp / Rain / Snow. The button reads "Set
   {band} and {sky}" ("Set conditions" before either pick). The missing-pick
   messages are "Pick how warm it was." and "Pick the sky.". The run strip
   badge reads `SET · 41–50° · RAIN` and never shows the stored midpoint.
   _Build:_ add the sky pick, which needs somewhere to live.
   `manual_conditions` holds `temp_c` only, so this is an **additive
   nullable column**. 127 (task 121's code).
3. **Deleting a garment that has runs.** _Drawn:_ "Y Delete with runs". The
   title is "Delete the {piece}? Retire it instead.", with "It's on {n}
   runs." Below it: GOES "It comes off the kit of all {n} runs", GOES "Its
   record in {b} bands", STAYS "Every entry and verdict, and the rest of
   each kit", and "This can't be undone." Buttons: pink **Retire it**,
   hairline **Delete it and its record**, Cancel. No second confirm. On
   success the runner lands on C with "{piece} deleted."; on failure the
   kicker is `Not deleted`. _Build:_ the sheet for the with-runs case.
   Closet (task 122's code).
4. **F · garment saved, photo refused.** _Drawn:_ "F Photo failed". The
   form fields go, because the row exists, and the action becomes **Done**
   (→ Y). Under the well is a §4a band: `PHOTO NOT ADDED` · "Garment saved,
   photo didn't. Try again?" plus the reason ("IMG_2231.HEIC isn't a JPG,
   PNG or WebP."). **"Try again" is offered only for a network failure**, and
   it re-sends the same file. For a size or type refusal the only choice is
   "Pick another". Closet (task 122's code).

**Carried from round 24, ruled**

5. **The swatch.** _Ruling:_ round 22 is right, and so is the build. The
   square shows only when the shade is exact. §AH rule 08 is "amended to
   say 'no swatch unless the shade is exact'", but only on the new board;
   the §AH board itself did not change. _Build:_ none.
6. **Per-item flags on a stranger's entry.** _Ruling:_ dropped. The contract
   wins, and the D frame now shows the name alone. The OG card (item 22)
   repeats the rule. _Build:_ none. `feed/entries.ts` already returns
   flags to the entry's owner only, so the board now agrees with the build.
7. **Usernames.** _Drawn:_ "O0 Handle taken" and "Handle placements". The
   `@handle` replaces the name **everywhere, in one style: Archivo 600, "@"
   included, lowercase, never mono**. Search, G and H move from mono to this
   style. That covers the feed author row, D, S1 ("@x found your 41° run
   useful.") and the report sheet ("Report @x's entry?"). **Sign-up asks for
   email and password only.** Everyone, email or Google, picks a handle at
   **O0, the first step of onboarding** ("What should runners call you?",
   STEP 1 OF 4). The rule is 3–20 of `[a-z0-9_]`, not starting with `_`,
   unique regardless of case, and lowercased as typed. It is checked on
   Next, not while typing. A taken handle reads "@x is taken. Try another,
   like @x_pdx.", with one real free suggestion (the typed handle plus the
   city slug, or else plus a digit). The other refusals are "Use 3–20
   letters, numbers or _." and "Handles can't start with _.". Settings ›
   Username changes it later. **An old `/@handle` shows "This runner changed
   their name." and never redirects**, because a redirect would link the old
   handle to the new one. _Build:_ 126 owns the field, O0, settings and the
   rule. 129 owns the placements, 128 the report sheet. **Schema:** a
   `username` column with a case-insensitive unique index is additive.
   Dropping `display_name` is destructive and goes expand→contract.
   Answering "changed their name" needs old handles kept somewhere.
8. **Task 120's two calls.** _Ruling:_ both confirmed ("JPG, PNG or WebP";
   `STILL MARKED`). Closes open item 27. _Build:_ none.
9. **The round 21–23 placeholders.** _Ruling:_ all confirmed except two.
   City field error copy is superseded by item 12. **Date order is US**: mono
   labels read "SAT AUG 29" and prose reads "Sat, Aug 29", via Intl with the
   month before the day; "Sat 29 Aug" is wrong for en-US. Details added to
   the confirms:
   - E2-lite "No weather yet" becomes "No weather for {place} yet. It shows
     after the first reading."
   - "Didn't load" is the §4a band sized to the block, with no
     illustration.
   - The bell's names are "Notifications" and "Notifications, 3 new".
   - Consensus bar colours also need a word label (rule 10).
   - "Find runners" is a right-aligned text link, not a bar icon.
   - "Show retired (4)", with no count at 0.
   - The phone's way back reads "← Closet".

   _Build:_ the date formatter (127, task 121's code; every lane renders
   dates). E2-lite copy and the bar labels (129). The Show retired count
   (closet).

**Promised in round 25**

10. **F at the desk.** _Drawn:_ "F Add garment desk" (DS1 split). The rail
    holds **one card: "Already in your closet · {CATEGORY} · {TYPE}"**. It
    lists the same category and type, newest first, up to five, retired
    pieces included and marked `RETIRED`, and a brand+name match is marked
    `SAME NAME`. The rows are read-only and don't link, because a link would
    fire the leave rule. Empty: "No half-zips yet." There is no card before
    a category is picked. It is **not** the photo preview (the well already
    is one) and **not** "worn in" (a new piece has worn nothing). The
    photo-failed state (#4) sits in the primary column, and the rail stays.
    Closet (task 122's code).

**New, drawn**

11. **Email verification.** _Drawn:_ "Au4 Check your email", "Email verify",
    "Email existing account", "Link expired", "Link used", "Link success",
    "Resend states" and "Au2 Sign up redraw". **Every email sign-up ends on
    Au4**, whether the address is new or registered. A registered address
    gets the email "You already have a dialed.run account", so **Au3's
    exception is retired** and the page reveals nothing. The link works
    once, for 24 hours. Resend shows [ Sending ], then "Sent ✓" for 60 s
    (the old link stops working), then when rate-limited a §4a band
    `NOT SENT` "That's 5 links this hour. You can send another at {time}.".
    **Unverified accounts can do everything private.** What waits is anything
    another runner would see or that trusts the address: share (it queues,
    with the sub-line "Shares when you confirm your email."; it then posts in
    logged order with original dates and "3 runs shared."), Useful, report
    (both open a "Confirm your email first" sheet), email change, and reset
    by email. There is one nag, a hairline band on Feed and You with no
    dismiss. Google accounts skip Au4. The ruling rejects the build's default
    of allowing everything and nagging: _"allowing everything and nagging is
    the spam path."_ _Build:_ 126, and 129 for the share queue and the
    band. It needs an email-sending binding, which does not exist yet
    (125; `wrangler.jsonc` is human-managed). **"Queued" is a new state for
    an entry**, not public and not private, so it touches `docs/contracts.md`
    sharing rules: contract-shaped.
12. **The typed city.** _Drawn:_ "City field empty", "City field resolved",
    "City field not found" and "O1 City step". The hint reads "Add the
    state or country. We'll show you the place we found before we use it."
    Beside the field is **Find**. It returns "Weather for {resolved}" with
    **Use this** ("Not it? Add more to the name."), and nothing is saved
    until Use this is pressed. A place that doesn't exist gets the field
    message "We couldn't find "{q}". Check the spelling, or try a nearby
    city."; a failed lookup gets the §4a band `NOT FOUND YET`. On O1 the
    resolved string, uppercased, becomes the chip, and "Change city"
    reopens the field. Enter means Find. Next with an unconfirmed entry
    reads "Press Find, or clear the field to skip.". Your conditions'
    header reads `WEATHER FOR {RESOLVED}`. _Build:_ 129 for Your conditions
    (task 123's code) and 126 for O1 (task 124's code).
13. **The Google button.** _Drawn:_ "Google button light" and "Google button
    dark". Google's light and dark specs are taken whole (fill, 1px stroke,
    **Roboto Medium**, the official G) in our pill, 48 high, reading
    "Continue with Google" on both Au1 and Au2. `data-part="google-button"`
    is exempt from the palette and icon-pack checks, and nothing else is.
    Focus follows rule 06. _Build:_ 126 (task 124's code).
14. **Privacy policy.** _Drawn:_ "Privacy policy desk", with the phone
    described in notes. `/privacy` is a reading page with a sticky contents
    column at the desk and a plain list under the H1 on the phone. Each H2
    carries an id and "↑ Contents". There are no accordions, and inline links
    are underlined. It uses the signed-in shell when signed in. **It is
    linked from the signed-out footer, under Au2 only** ("Creating an
    account means you've read our Privacy policy."), from Settings › About,
    and from every email footer. **Not under Au1**: _"logging in isn't
    consent to anything new."_ _Build:_ 126 (R-105).

**New, ruled**

15. **The Call's threshold is 15.** _Drawn:_ "K Call teaser 15", which
    supersedes round 22's K. It shows 15 cells, `4 OF 15 VERDICTS`, "Log 15
    verdicts and the Call starts." and "11 to go. …". At 0 it reads "Your
    first verdict is one run away." _Build:_ K's copy and meter. 126 (task
    124's code).
16. **Field focus.** _Drawn:_ "Field focus states". On a FormField **the ring
    sits on the border** (outline 2px ink, offset −1px), so a focused field
    shows one line. Error is a 2px ink border plus the band. Error with focus
    looks the same plus the band, and **the band is what tells error from
    focus**. _Build:_ `ui/form.tsx` (task 120's primitives; 125 as the
    platform lane). **This contradicts the Accessibility Contract as
    written**; see below.
17. **Breached password.** _Ruling:_ the placeholder is confirmed: "That
    password has turned up in a data breach. Pick another." It never says
    "your password was breached". If the check can't be reached, it fails
    open. _Build:_ 126.
18. **Small confirms.** _Ruling:_
    - **W3:** counts are digits, always, including "You blurred 1 spot."
      (128; task 120's code).
    - **Password:** the hint is "At least 10 characters.", the refusal is
      "Use at least 10 characters.", and Au1 shows no length hint (126).
    - **G:** a settings icon button (`settings` is in the pack, named
      "Settings") sits at the right of G's identity line in every state. Day
      one keeps its inline link too (129; task 123's code).

**Addenda from the owner**

19. **Notification email.** _Drawn:_ "Email run reminder", "Settings
    notifications" and "Unsubscribe landing". In v1 **only the Strava run
    reminder can be emailed**. It is on by default and sent 20 minutes after
    the run lands. It is skipped if a matching file was uploaded or the push
    was opened, and at most one goes out a day, with the next one counting
    both ("2 runs landed on Strava yesterday and today."). Subject "New run
    on Strava. Add it here.", body "A run landed on Strava at {time}. Upload
    its file, then add what you wore.", button "Add it". The footer reads
    "You get this because Strava is connected." · Stop run reminder emails ·
    Email settings · Privacy policy. It sends List-Unsubscribe with one-click.
    Settings › Notifications has Push/Email switches per kind:
    - Run reminders: push and email.
    - Useful: push; email reads "IN THE APP ONLY".
    - Account and security: email reads "ALWAYS SENT", with no switch.

    Unsubscribing is a signed, never-expiring link for one address and one
    kind. Opening it unsubscribes, with no log-in and no confirm, and lands
    on "Run reminder emails are off" · Turn them back on. An invalid link
    reads "That link doesn't work. Change emails in Settings ›
    Notifications." _Build:_ 127 (the reminder and its skip rule), 125
    (sending, the delayed dispatch, headers, the signed link), and 126
    (settings). It needs the same email binding as item 11.

20. **Invite-only sign-up.** _Drawn:_ "Au2 Invite code", "Au5 Request
    access", "Au5 Request receipt" and "D7 Access". **INVITE CODE is Au2's
    first field**, above email and Google, and `/join?code=` fills it in. A
    used code reads "That code has already been used. Ask whoever sent it
    for another."; an invalid or revoked code reads "That code doesn't work.
    Check it against the email or message it came in." "No code? Request
    access" opens Au5: email plus an optional 280-character note. The receipt
    is **"You're on the list", the same for a new, repeat or registered
    address**, and a repeat updates the note. The invite email is "Your
    dialed.run invite" · "Here's your code: DIAL-7K3P. It works once." ·
    Create your account. Desk **D7 Access** has two lists:
    - **Requests**, oldest first. Send invite mints a single-use code,
      emails it and moves the row to Codes. Decline is silent.
    - **Codes**: `DIAL-XXXX` without 0/O/1/I, case ignored, with a label,
      a uses limit, used-by @handles, Copy link, and Revoke (no confirm, 10 s
      undo).

    A code is consumed at account creation, not at verification. The owner's
    account is seeded. At public launch one flag removes the field and the
    request link. _Build:_ 126 (Au2, Au5, codes) and 125 (D7 on the Desk).
    New tables, all additive. D7's nav also lists a "Runners" page that no
    board draws.

21. **Strava's Connect button.** _Drawn (slot only):_ "T1 Strava official
    button" and "O3 Strava official button". Strava's **orange** "Connect
    with Strava" asset goes on both themes, 48 tall, unaltered, left-aligned
    where our pill was, and wrapped in our `<a>` named "Connect with
    Strava". Focus is rule 06, square, offset 2. While OAuth is in flight
    our brackets ("[ Connecting ]") show beside it, and the asset never
    changes. Disconnect stays our hairline pill. There is no "Powered by
    Strava" mark, because we show no Strava data. `data-part="strava-button"`
    joins the Google button as the only palette exemptions. _Build:_ 127.
    The asset has to be vendored from Strava's brand kit.
22. **Icons and the share card.** _Drawn:_ "App icon 512", "Apple touch
    180", "Favicon 32", "Favicon 16", "OG Entry card" and "OG Default card".
    Every icon is "[d]": pink brackets and a paper d on an ink tile. At 16
    only the brackets remain. The files are `favicon.svg`, `favicon.ico`
    16/32, apple-touch 180, manifest 192/512 plus a 512 maskable, and
    `theme_color` `#0B0B0E`. **OG for a shared entry, 1200×630:** wordmark,
    date, conditions, verdict chip (hue plus word), distance/feels/wind,
    kit and @handle, **never the photo**, note, route or flags. The title is
    `@handle · {temp} {precip}, {verdict}` and the description is the kit
    in kit order. Private, deleted, banned or unverified-queued entries
    serve the default card ("What to wear for the run you're about to do.")
    titled "dialed.run". _Build:_ 125 (icons, manifest, default card) and
    129 (the entry card and its meta). Rendering an image in a Worker needs
    a library we don't have, which is an owner call.

**Where a ruling and a contract, or an owner decision, disagree.** None of
these is resolved by this import. Each needs design to amend the contract
file or the owner to decide.

- **Field focus (16) vs Accessibility Contract §06**, which still reads
  "2px solid outline, offset 2px" for every control. The ruling moves one
  control class to offset −1px, and the contract file was not changed.
- **The Google and Strava exemptions (13, 21)** are declared on a board.
  T1's table and `icons.js` don't carry them. The Google button also brings
  **Roboto Medium**, a fourth font family outside the stack's three.
- **Privacy page type (14):** "680 measure" is not a `MEASURE` (620 is the
  document measure), and "17/1.65" is not a TYPE step (`lead` is 17/1.5).
  By the contract, it collapses to `column` and `lead`.
- **Privacy link placement (14) vs R-105**, which says "a link from the
  signed-out shell and both auth forms". Design says not under Au1.
- **Unverified shares queue (11).** An entry that is neither public nor
  private is a change to the sharing rules in `docs/contracts.md`.
- **§AH rule 08 (5)** is amended only on the rulings board, so the §AH board
  still reads "no swatch".
- **The reminder email (19)** is a second effect of the Strava webhook.
  CLAUDE.md's product rules say its only effect is a notification row.
  R-105's policy note already expects "an activity id per reminder", so this
  is wording to update, not a conflict of substance.

## Answered in round 25 (imported 2026-09-24)

Three asks from the build lanes, answered on a new board (`Round 25
Rulings.dc.html`) and applied to the Desktop Contract, both Remaining
Screens boards, round 22's coverage board and design's product.md. No
contract values moved.

- **Log a run is a desk page.** Design withdrew the panel for it: _"the
  panel was a rule about inputs that got drawn as a rule about width."_
  From 1040 up, A1–A3 use DS1's two columns: every input and the primary
  action in the primary column (max 620, phone order), read-only context
  cards in a `data-part="rail"` — conditions, "you in this band", the run,
  the kit being judged. The rail never holds an input, button or radio, and
  the harness is to check that. A2b takes over the primary column (a push,
  not a modal); A3's verdict row stays at 390; the primary action sizes to
  its label. No frame or card around the form; the ink bar is unchanged and
  no nav link underlines (the pill carries `aria-current`). 720–1039 is the
  620 reflow, not the panel. **F follows** (drawn in round 26; panel until
  then). **Auth and onboarding stay in the panel.** Not built.
- **Strava: "Strava reminds. You upload."** The connected receipt, T3b's
  Kept/Stops, the reminder (push and S1 row: "New run on Strava · Add it
  here: upload the file, then what you wore", timed by when the run
  _landed_), T3a's status line ("CONNECTED · LAST RUN SEEN …"), the
  auto-import toggle removed, and T2's import-progress screen retired. The
  reminder is one per run and clears when a file with a matching start time
  is uploaded. DS2's header reads "6 RUNS · NO VERDICT YET". Not built.
- **Your conditions: "in these conditions".** Eyebrow `SAME CONDITIONS ·
FEELS [{lo}–{hi}°] · {PRECIP} · {WINDOW}`; line "In {feels}° and
  {precip}, {window}, wherever they were." Wind leaves the eyebrow; no line
  names a place. E1's compact line and N's privacy card follow. Not built.

**Round 24's asks were still open** (answered in round 26, above) — the time correction on A1, R2b's
options, the delete-with-runs sheet, "Garment saved, photo didn't", the
swatch conflict, per-item flags on another runner's D, usernames, and item 27.

## Answered in round 22 (imported 2026-09-23)

The coverage request (`docs/reconciliation/2026-09-23-design-coverage.md`)
came back on two new boards: `Auth.dc.html` (items 1–2) and `Round 22
Coverage.dc.html` (items 3–14 drawn, 27 frames; items 15–25 as one-line
rulings, drawings due round 23). Every section carries a `data-board` mark
naming the board it will fold into; the frame, part and state marks are
final, so the conformance harness can diff against these files until the
fold lands. Tokens, motion and icons are unchanged.

**Rulings that change or remove what already ships** — each is build work,
taken with its screen's reconciliation:

- `/runs/import/$id` goes. A1 never navigates while parsing; every outcome
  (pending, parsed card, parse failed, duplicate, stalled) shows in A1, and
  the old URL redirects to A1.
- Run detail's manual-temperature form goes, for one row: "No conditions ·
  Set conditions ›", opening R2b. Weather that arrived is never editable.
- The product-link field comes off F for v1 (AC2b); F2a/F2b return with
  enrichment. Edit is F prefilled, titled "Edit {name}", button Save.
- Settings becomes U1/N's tap-through index, one small form per sub-page.
- M's hi-viz unread wash goes: unread is a white row and a pink dot (S2c).
  The bell's number counts runs awaiting a verdict; everything else is the
  dot; caps at 9+.
- D's photo grid goes for the pager. The owner's verdict prompt takes the
  badge's place, not a banner; Report is a foot text link.
- The v1 post card drops kit and pace: author and badge, photo, caption,
  the strip, Useful. A missing part is absent, never a placeholder. Badge
  fill follows A3 — E1's yellow "dialed" was drift.
- The auth failure band opens "Not signed in", not "Nothing saved".
- Zero follows lands on Your conditions.
- Your conditions needs **five runners** before any aggregate shows (a
  privacy floor, design's number — the owner may change it); under five in
  three days the window widens once to fourteen and says so; the band never
  widens. Location denied recovers with a typed city saved to settings.
- The garment photo sits in the well: with a photo the well is the
  preview, Replace and Remove below; drag-over is a 2px ink border and a
  title swap. Garment detail's order and a 4:3 photo (262 phone, 320 desk).
- 404 and loader errors keep the shell when signed in; a slow route keeps
  the old screen and, after 300ms, the destination's tab label breathes.

**Not answered: item 9** (one failure pattern for controls that aren't
forms) never reached design — the brief as pasted was missing it. Re-asked
as item 26. **Not yet done by design:** the fold into the screen boards,
and mirroring the new `data-part` names into its product.md §6b.

## Answered in round 21 (imported 2026-09-23)

Ten asks, ten answers, on a new board of its own (`Round 21 Rulings.dc.html`)
and mirrored in `design/docs/product.md` §6d. Theme moved, so the contract
tests moved with it.

- **Two T1 roles (item 14): granted.** `--hiviz-text` (`#F5FF3D`, ink
  surfaces only, both themes) and `--dialed-tint` (`#D2F0E9` light,
  `#0A2524` dark — teal into ground at 14%, precomputed). Ported, and both
  placeholders replaced: NowGoRun's eyebrow and EntryDetail's matched panel,
  whose border the ruling also draws in teal rather than `--dialed-text`.
- **The three contract values (item 15): all confirmed.** The square swatch
  is data, not a control; the ink block is a surface and should not outline
  itself; `.run` at `--muted` is right and the dark grey was the drift.
- **"Visibility" (item 16): keep it** — _"the runner's word for being seen;
  the column name is storage's business."_ Condition: no runner-facing
  privacy control ever uses "visibility"; sharing stays "Share to feed".
- **"Color" (item 17): stays American on every board.** Noted, no answer.
- **Bend 2 (item 21): met; the sentence is retired, not moved.** The
  Desktop Contract now reads O1 → O3 → O4 → P3. R-92 closed.
- **Two bars in the markup (item 22): understood.** R-90 stands as a note.
- **The landing page at width (item 23): its own bar.** From 720 up, a
  wordmark and one action — "Log in" (hairline) signed out, "Your closet"
  (ink) signed in — and the hero drops its own wordmark. Below 720, no bar.
  No nav, search, bell or "Log a run"; pink stays off it. **Not built yet**;
  R-93 narrowed to that. The full landing brief stays open.
- **Dead-lettered work (item 10): drawn** as D6 · Gave up on Operator
  Screens, a rail item with a hi-viz count and one row per job. Not built.

**Round 20's A3 follow-ups** (items 24–25) are answered on the same board,
and are the next A3 work: MORE › leaves with
share and submit when Noted lands; a re-tapped garment chip returns to
Fine; all four chip assumptions confirmed, plus a garment needs **≥2 runs**
in the band to be "weakest"; nothing-to-note is a **receipt** ("Logged. No
weather came with this run, so no band record moved." / "…No kit on this
run, so no garment record moved.") and A3 never navigates; chips draw at
32px with a `::before` making the target 44, row gap 12px; A3b is drawn as
built, and Done and swipe-down both keep.

## Answered in round 19 (imported 2026-09-22)

Every question from the conformance work came back answered, and the
contracts moved with them.

- **A3's chosen fill is the verdict's T2 hue** — _"cold pink, dialed teal,
  warm quiet grey — exactly as DS2's row does; --action is never a verdict
  fill."_ A3's board had filled its chosen cell pink to mean _selected_.
  Built: `ui/verdictHue` is the one table A3 and DS2 both read. R-98 closed.
- **The in-band count is a line beneath the row, never in a cell.** The
  harness's known gap for it closed itself. The line is not built; R-97.
- **One beat, not two** — now in `motion.js`, not only the doctrine
  caption: _"close by TRAVEL.frame as the fill lands (one beat, not two),
  then the row locks."_ The fill used to wait a whole `reveal` and then
  flip. It now lands on the brackets' own duration and curve. The motion
  test had hand-coded the old two-beat timing as an exception, so the
  contract change was invisible to it until that exception became an
  assertion read from the contract.
- **`--action-hover` and `--ink-hover` joined T1.** Ported; nothing wears
  them, because the app has no hover states at all. R-99.
- **Regions named** on A1, A2, A3, C, D, E1, DS1 and DS2, and
  `data-status="unbuilt"` on seven regions, which the harness now honours.
- **Wrappers stay 390px.**

**Still open from this round:** the three round-18 "drift, correct to T1"
hexes are still on the boards (`#4A4A52` 38 uses, `#C41E6A` 7, `#009F8C`
4), and the eighteen unlicensed colours were not ruled on. Colour coverage
inside screen frames rose from 93% to 95.2% with the hover roles. One
hazard worth passing back: `#DEDDD6` is `--ink-hover`'s dark value and
also a light-board paper tint (91 uses), so a hex→role lookup reads that
tint as a hover state. Harmless until a light board's panel is compared by
role; then it is a false match.

## Answered in rounds 16–17 (imported 2026-09-21)

### The verdict row is one row at every width, and never in a field box

Round 17, verbatim: _"the five are one row at every width — in the 390
desk panel too; never a stack, never wider than the panel. Neither the row
nor the chips sit inside a field box."_ Both halves were wrong in the
code, and one of them was hiding a defect.

**The stack.** A3's five buttons were `flex flex-col` — a tall column of
five full-width buttons on the phone, and at desk the same column with a
screen of empty space beside it. The owner spotted it on film and read the
ruling as covering both widths, which it does. `grid-cols-5` is now the
layout, and the labels break inside their own cell because the row cannot.

Worth recording _why_ nothing caught it: the `ui` vitest project runs in
happy-dom, which parses CSS and lays nothing out, so every rect is zero
and "one row" is not a question it can answer. The class was as intended
and the suite was green. `e2e/verdict/verdict-row.spec.ts` is the answer —
real Chromium, both widths, and it was checked against the old stack to
confirm it fails on it.

**The field box.** Wrapping the group in `FormField` drew the Form
Contract's 1px-rule boundary around five buttons that each already draw
their own, which is the "mostly empty box" the owner asked about. It was
also suppressing the focus ring: `field-box` (`src/ui/a11y.css`) removes
the outline from its descendants — correct when the child is the
borderless input a `FormField` insets, wrong for buttons — so tabbing
across the five verdicts showed one static outline around the whole box
and no indication of which button had focus. On the single control the
product turns on, rule 06's _"never removed"_ was failing by construction
rather than by an `outline-none` anyone could grep for.

A3's group was the only `FormField` in the app whose child was not an
`<input>` or a `<select>`, which is why nothing else was affected.
`ui/form.tsx` gained `FieldGroup` — legend, hint, message, no box — and
`ChoiceList` was refactored onto it, so the chips and the row share one
implementation of the ruling instead of two.

**Also from this round:** A3's legend read "How it felt" where the board
reads "Did it work?" — which DS2's backlog header had already shipped in
round 16, so the two mirrored everywhere except the words. Owner
confirmed 2026-09-21; A3 now reads "Did it work?" and the one string
lives in `LABELS.verdict`, which the error-summary row reads too.

## Answered in round 15 (imported 2026-09-20)

Five questions from task 115, all composition, all answered the lane's
way. Three files changed: `Desktop Contract.dc.html`, `Remaining
Screens.dc.html` and `motion.js`.

**Search is a link, and there is no theme control in the bar.** DS1a's
240px field is withdrawn — _"a field is an input surface with states
nobody drew"_ — and replaced by the pack's search glyph at every width,
named "Search runners", opening `/feed/search` in the 390 panel per DS3.
The AUTO/LIGHT/DARK segment takes no seat: _"no theme control in the bar
until dark mode ships; an inert segment fails rule 07 and an absent one
fails nothing."_ It stays on You, where its source line already lives. DS4's
desk row now reads _"Bar is identical to Wide — no field, no segment."_

**The pill says "Log a run" at width and `+ Add` on the phone bar**, as two
elements each hidden at the other width, each with its own accessible
name. Design called the duplication deliberate rather than tolerated: _"the
phone seat is a glyph-sized launcher, the bar has room for the verb."_ The
readings are "Add, button, dialog" and "Log a run, button, dialog".

**Feed is one column at desk in v1.** Two of X's three rail cards are the
Call, so DS3's Feed row now says the rail _"arrives whole with Epic 200 or
not at all. A rail with one live card and a hole is the dashboard DS5
forbids."_ DS5's third-column entry gains the qualifier "(post-Epic 200)".
Closet and the backlog keep their second column.

**The top bar's underline is static**, which closes item 18 above and
settles the one place `motion.js` and the Desktop Contract could be read
against each other. The four links are natural width; the active one
carries its own 2px border-bottom (`--action` on ink, `--cold-text` on
paper) and does not travel; the colour still flips at `instant`/`snap`.
Sliding stays the phone bar's.

## Answered in round 14 (imported 2026-09-20)

Three small ones, raised by task 112 as round 13's answers met the code.
One file changed — `Accessibility Contract.dc.html` — and all three
answers went the lane's way, which is worth recording: each was a place
where the build had already made a judgement and wanted it confirmed
rather than a question it could not answer.

**The synchronous pending verb — a slip, corrected.** `Use this` in the
shade sheet had been given `[ Saving ]`; it is synchronous, and the row
now reads _"Use this — synchronous; the hex travels with the form. No
in-flight state (round 14 corrects a round 13 slip)."_ `Attach N items`
_"stays as built"_ — it is genuinely async and the lane added the state it
was missing.

**The file input's name — the drawn copy stands.** _"'Drop a .FIT, .gpx,
or .tcx file' is the rest label and the only home for the formats;
`[ Reading ]` in flight. `Add a photo` stays for the photo input."_ So the
two file inputs resolve the table differently on purpose: one had a drawn
name worth keeping and the other had only a field caption.

**The face-detection sentence — the build is right, and gains a rule.**
X3 now reads _"Hear 'Checking this photo'"_ rather than _"Looking for
faces"_, because _"'Checking this photo' doesn't promise a face search the
detector can't guarantee; the two outcomes carry the specificity."_ With
one clause the lane had not thought to ask about: **no trailing ellipsis
in the announced string — the status region reads it, the ellipsis is
drawn only.** So `PhotoBlur` holds one constant and renders it two ways,
which is the one place in the app where what is drawn and what is
announced deliberately differ.

## Answered in round 13 (imported 2026-09-20)

Round 13 is the accessibility round, and it exists because task 112
measured rather than spot-checked. Three questions went out with the
lane's own recommendation attached; all three came back, and two of them
changed a contract value. Eight design files changed: `Theme.dc.html` and
`Accessibility Contract.dc.html` carry the rulings, and the other six are
the retired teal swapped through the artboards.

**The label grey — answered, and it is a new T1 row.** `--label #6E6E64`
(4.64:1 on paper), for _"a grey that is a control's only label: field
captions, radiogroup legends, inactive tab labels"_. `--muted #7A7A70`
keeps its hex and gains the sentence that was missing: _"never a control's
only label on paper (3.9:1) — that is --label"_. The dark column folds
`--label` into `--muted`, which already clears at 5.81:1, so this is a
paper-only role and task 111 inherits it with nothing to decide.

**Teal as text moves, and the nine call sites were right.** `--dialed-text`
is cut from `#009F8C` (2.98:1) to **`#00776A`** (4.87:1 measured on
ground). Design's framing is worth keeping: the sites were not wrong to
say "dialed" in teal — _the hex was wrong_. `#009F8C` is retired outright,
which is why six artboard files changed in a round about contrast.

**The unavailable control — the dim is gone, and the label carries it.**
Rule 07 already retired the `disabled` attribute; rule 02 retires the
40–50% opacity that went with it, and **nothing replaces it**. In its
place the contract gains a table, _"round 13 · unavailable, spelled
out"_, naming both states for all nine controls:

- **In flight** — the label swaps to breathing brackets with `aria-busy`,
  the treatment the Form Contract already gave submit buttons. The verbs
  are design's: `[ Noting ]`, `[ Following ]` · `[ Unfollowing ]`,
  `[ Saving ]`, `[ Connecting ]` · `[ Reconnecting ]` ·
  `[ Disconnecting ]`, `[ Uploading ]`, `[ Reading ]`, `[ Attaching ]`.
  The rule behind them: _"the rest verb in -ing, in brackets, breathing.
  Never 'Loading', 'Please wait', 'Processing'."_
- **Not yet** — `Attach 0 items`, drawn at full strength, `aria-disabled`,
  silent on press. _"The count is the sentence: it says what is missing on
  the button the runner is looking at."_ No band, no new copy.

**The inline target — 03 means standalone targets.** Rule 03 gains the
clause: _"a link set in a sentence takes WCAG 2.5.8's inline exception and
does not grow the line."_ So nothing reflows, which is what the lane
recommended and what the boards were drawn to.

**Two of the nine pending verbs describe a state the control does not
have**, which is a lane finding rather than a design one and is recorded
in `docs/deferred.md`: `Use this` in the shade sheet is synchronous, and
`Attach N items` had no in-flight state at all until this lane added one.

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

**The tied band — R-60 — is answered as `Split`.** A cold/warm tie fills _both_
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
    had it; the artboard now agrees."_ Closes R-55, which existed so nobody
    would "fix" the code to match the drawing. O3 is also re-cut as one list
    ordered by climate band (§AA), and coverage is ink rather than hue (§AB).

16. **Onboarding's column question** — answered as §AE.

17. **Transient feedback with nowhere to land** — answered as §AF.

**And two nobody asked for.** `Theme.dc.html` plus dark variants of every
artboard. The app has no dark mode, and this did not arrive through the queue
— so it gets a lane of its own rather than leaking into whichever surface a
future lane touches next: `docs/tasks/111-dark-theme.md`, unscheduled, with
"is a dark theme in v1 at all?" as its first open question. **R-36** (the
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

- **R-54**: §AC3's three payout lines each need something that does not
  exist (`products.type` → lane 107; an owner count → no such read; tagged
  runs → O4). The named row states what happened and stops.
- **The ranked heading is inert.** Rule 01 sorts by O4-tagged runs and O4
  is out of scope, so rule 02's fallback — _"the first heading is absent —
  not empty. One flat list, closet order"_ — is what every v1 runner sees.

**Design also flagged one back at us, and the build was already right:**
O3's artboard still draws a paste field with `SPECS FOUND`, same lane-107
dependency. `TapListForm` never built one. Recorded as **R-55** so nobody
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
| **No form-validation strategy** (`docs/deferred.md` R-17)                                                                   | `Form Contract.dc.html`, the new §Forms & failure in `product.md`, and a reference `design/src/ui/FormField.tsx`. Field failure and form failure are different events with different marks; per-field vs summary is decided by count so every lane lands in the same place; errors are marked, not reddened; nothing animates.                                                                                  |

## Resolved design↔contract nit (no upstream change needed)

Skipping the name in F/P2.5 files the garment as `[GENERIC]`; the contract
requires `name`, so generic saves default it to the category/tap-list label
(taplist rows already work this way). Noted in task 101.
