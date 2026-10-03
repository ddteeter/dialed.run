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
    Not built.**
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
    `check`. Not built.** Each is
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
    drawn, and the ban email's foot is D-73's. Not built.**
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
    sent back to design (D-91, item 40). Not built.** Six the PR shipped, and two its review added. The
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
    the owner, D-91).** Not decided; nothing is built differently while it
    is open.
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
    round 26 #11, round 27 #7 and #17).** Built to the words; five
    composition calls no frame makes.
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
    (ACC-6, ACC-13; round 28 PR A).** Built from existing primitives.
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
   tag is `[UNDER REVIEW]`, not the board's plain tag.
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
    `back` glyph (#9).
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
    - **PHOTO NOT ADDED kicker:** _No, hi-viz:_ "Every §4a kicker sits on
      the hi-viz ground. Put round 26's back." **Not adopted: sent back to
      design (D-91, open item 40).**
    - **Retired date:** _No, month and year:_ "RETIRED MAR 2026" in MONO.sm
      on the rail. Retired gear is read across years, and the day doesn't
      matter. _Build:_ 128 (`AlreadyInCloset.tsx`; `closet/retired-label.ts`
      keeps the closet's own format).
    - **Middle cell:** _Yes,_ "Blur middle". The product is in US English,
      and "middle" pairs with top and bottom. The board's "centre" is
      corrected. _Build:_ none.
    - **Photo-less rail thumbnail:** _No, hatch._ The hatch means "no photo"
      everywhere (round 27 #31b), and the photo ground means a photo is
      still loading. _Build:_ 128 (`AlreadyInCloset.tsx`'s `bg-photo`).
    - **Edit's photo failures:** _Yes, reuse._ A saved photo that is refused
      gets #20's `PHOTO REMOVED` band. A removal that fails gets 02b's band
      under the photo: `PHOTO STILL ON` · "That didn't go through. Try
      again?" (built: "Photo kept"). _Build:_ 128 (`GarmentForm.tsx`,
      `GarmentDetail.tsx`). `feed/components/RetractEntry.tsx` also says
      "Photo kept" when D's photo delete fails. The ruling does not name it,
      but the same rule makes it `PHOTO STILL ON`.
14. **Odds and ends.**
    - **Desk destinations:** _Five, in this order:_ Today, Review, Access,
      Duplicates, Runners. That is the queues that need a person first, then
      upkeep, then lookup. Access is a destination because it has its own
      queue. Gave up is a section on Today, carrying its count, because it is
      a list to check rather than a place to work. **This revises D-35, and
      the owner adopted it (D-87).** _Build:_ 125 (`ops/components/DeskShell.tsx`'s
      order; Gave up moves off the rail and onto `Today.tsx`).
    - **Photo-delete glyph:** `remove` (keywords: delete, trash, bin). The
      accessible name stays "Delete photo 2". _Build:_ 128.
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
    bell's name above 9).
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
    the photo button**; the pack has `remove` and `close`.

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
