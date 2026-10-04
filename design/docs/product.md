# §Forms & Failure

> Insert after §Brand. This section is the contract: four agents implementing four
> forms must produce one experience. Nothing here is a suggestion. Where it says
> "never", a PR doing it is wrong.

## 0. The position

A failed submission is not an alarm. It is a **measurement that came back out of
range** — same posture as "you were too cold on this run." The form tells you what
did not happen, marks where the fix is, and stays still while you fix it.

Two failures, two different things:

| | Field failure | Form failure |
|---|---|---|
| Means | The form is intact; the fix is inside it | Nothing was saved; the fix is not inside it |
| Cause | zod issue on one or more fields | Network died, 500, expired session |
| Marked at | The fields | The submit button |
| Fields marked | Yes | **No** — never mark a field for a 500 |
| Recovery | Edit and re-submit | `Try again` re-submits the same values |

They currently look identical. That is the bug this section closes.

## 1. Where a message renders

Field messages and the summary are **not** an either/or. The rule is by count, so
every implementation lands in the same place:

- **1 field error** → field message only. Focus moves to that field.
- **2+ field errors** → summary block at the top of the form (`Nothing saved.
  Three fields need a fix.` + one focus button per field) **and** every field
  message. Focus moves to the summary.
- **Form failure** → the failure band above the submit button. No summary, no
  field marks.

The summary's list items are `<button type="button">`, each focusing its field.
Not anchors — a form is not a document.

### The screen-reader path (this is the part every lane missed)

Every form renders exactly one `<FormStatus />`: a permanently-mounted
`role="status" aria-live="polite"` region. It is empty until a submit resolves,
then it receives **one sentence, every time, on every outcome**:

| Outcome | Sentence |
|---|---|
| 1 field error | `Nothing saved. One field needs a fix.` |
| n field errors | `Nothing saved. {n} fields need a fix.` |
| Form failure | `Nothing saved. Your connection dropped.` |
| Success | `Run logged.` |

Then focus moves (field, summary, or the retry button). Announce, then move —
never move without announcing.

Field messages themselves are **not** live regions. They are wired with
`aria-describedby` and the input carries `aria-invalid="true"`. Two live regions
firing at once means one of them is lost.

## 2. What a field error looks like

It is **marked, not reddened**. No new hue enters the palette, and the mark is
never carried by color alone.

- **Input:** border `1px #DCDBD2` → `2px #0B0B0E` (dark surface: `1px #2A2A31` →
  `2px #F4F3EF`). Weight is the signal. The value is never cleared or
  re-formatted.
- **Message:** flush beneath the input, on a `#F5FF3D` band, ink text, 13px
  Archivo, sentence case. Same band on both surfaces.
- **Label:** unchanged. One mark per field.
- **Accent pink `#FF2D8A` is action, not failure.** Never use it for an error.
- **Choice groups (button groups, chip sets) have no box.** The border mark is
  for a typed value. A group of bordered options keeps `FormField`'s label and
  message band, draws no enclosing box, and must not suppress its children's
  focus rings. A required-but-empty group is marked by the message band alone.
  Applies to A3's verdict row and the per-item flag chips alike.
- **Verdict commit brackets frame the cell, not the text** (round 18). They sit
  at the chosen cell's left and right edges, vertically centred, and slide
  inward by `TRAVEL.frame` as the fill lands — one beat, not two: the fill is
  the slide's arrival, on the contract's 320ms / align. Never inline with the
  label. `motion.js` "Verdict commit" says the same (round 19).
- **The chosen verdict cell fills with its T2 hue, never `--action`** (round 19).
  Cold pink `#FF2D8A`, dialed teal `#00E0C6`, warm quiet grey (`--quiet`), ink
  text on all three — on A3 and on DS2's row alike; the two surfaces mirror in
  both directions. Pink on a chosen cell means *cold*, not *chosen*. Resolves
  D-98: A3's board was stale.
- **A verdict cell carries the word only** (round 16, reaffirmed round 19).
  The band history (`[38–46°] · 2 cold · 7 dialed · 1 warm`) is the line
  beneath the row. Never a count inside a cell — a dialed-only count reads as
  a nudge. Resolves D-97: A3's board was stale; the build was right.

### Motion: none

The Motion Doctrine already answers this — *Offline / error: nothing,
deliberately static*, and `NEVER` bans overshoot. So:

- The error does **not** animate in. No fade, no slide, no height transition.
- **No shake.** A shake is a spring wearing a costume.
- The only motion in the failure path is the button leaving its pending state:
  the brackets stop breathing. That is the whole animation budget.

Layout shift is real and accepted: the message pushes content down instantly.
Reserving empty space under every field to avoid it costs more than it saves.

### Error clears on input, not on blur

`onChange` on a marked field clears that field's error and removes its summary
row immediately, with no re-validation. Nothing stays marked while you are
fixing it. The next submit is the next verdict.

## 3. Client-side pre-validation: yes — same schema, run twice

It exists, and it cannot drift, because **there is only one schema**.

- Every form's rules live in one module under `src/lib/schemas/`, importing
  nothing from `src/server/`. The server function imports it for its trust
  boundary; the form imports the same object for its pre-check. No new
  dependency — zod is already there.
- **A hand-written client rule is a bug.** No `if (!email.includes('@'))` in a
  component, ever. If the client needs a rule, add it to the schema.
- **Error copy lives in the schema**, in zod's `message`. Components never author
  error strings. One rule, one sentence, one place.
- The pre-check runs **on submit only** — not on keystroke, not on blur. It saves
  a round trip; it is not a live critic.
- If the pre-check fails, render exactly as a server field failure and skip the
  request. Identical output, identical code path.
- The server check always runs. It is the gate. The pre-check is a courtesy.

### Server-only rules

Rules the client physically cannot evaluate stay server-side and surface through
the same field-error path. Keep this list current:

- Garment name uniqueness within a closet
- Ownership of the garment / run being edited
- Session validity and rate limits
- Anything reading another user's data

A server-only rule that returns a field error renders like any other field error.
The user cannot tell which side answered, and should not need to.

## 4. What a form failure looks like

A bordered band directly **above the submit button** — where the eyes already
are, not the top of the form.

- `1px solid #0B0B0E` on paper, `1px solid #F4F3EF` on ink. No fill. No yellow —
  yellow means "the fix is here" and it isn't.
- Kicker in MONO.xs, ink, caps: `NOTHING SAVED` (round 30 #1).
- One sentence naming what happened in the user's terms: `Your connection
  dropped.` / `Our end failed. Nothing about your run changed.`
- A `Try again` button that re-submits the same values. Values are never cleared
  on a form failure.
- **Never a toast.** A toast takes the retry with it when it leaves.
- Static, per the doctrine. A broken connection should not feel alive.

Session expiry is the one exception to "stay put": it routes to sign-in carrying
the pending payload, and returns to the filled form.

### 4a. When a control fails (round 23, item 9)

The same band, sized to the thing that failed, **directly under it**. Covers
Useful (D, feed card), Follow/Unfollow (H), Unblock (W2), A1 upload, A2 Attach,
Strava connect/disconnect, DS2 row save.

- **Where:** under the control's row, full content width. Row controls: inside
  the row's border, below its content. `data-part="failure-band"`,
  `data-state="failed"` on the band and on the control/row.
- **Control state:** already at its prior state — no control is optimistic.
- **Kicker names the state still true:** `NOT MARKED` (Useful),
  `NOT FOLLOWING` / `STILL FOLLOWING`, `STILL BLOCKED`, `NOTHING ATTACHED`,
  `NOT CONNECTED` / `STILL CONNECTED`. Sentence is the §4 cause line.
- **Dismissal:** stays until the next attempt (band's `Try again` or the control
  itself), success, or leaving the screen. Never on a timer. No animation.
  Announce via the status region; focus stays on the control.
- **In flight:** wait for the server. `[ Noting ]`, `[ Following ]`,
  `[ Unfollowing ]`, `[ Unblocking ]`. Counts change and rows leave on success
  only.
- **Never** a pink line, never a silent snap-back.

## 5. Submitting: the button

- **Never the `disabled` attribute.** Disabled buttons drop focus and stop
  announcing. Use `aria-disabled="true"` + `aria-busy="true"` and a re-entry
  guard in the handler. Double-submit is prevented in the handler, not the DOM.
- **The button does not resize.** Idle and pending labels are stacked in one
  grid cell, so width is fixed by the longer label.
- **Pending = breathing brackets flanking the label** (`[ Logging ]`, 900ms
  opacity loop) — the product's one waiting device. No spinner, ever. The
  brackets are the device; the label text stays plain, since bracket *notation*
  is reserved for measured values.
- **Inputs go `readOnly` while in flight, never `disabled`** — keeps focus,
  keeps the value announced.
- Label pairs are fixed. Verb, no ellipsis, no "Please wait":

| Idle | Pending |
|---|---|
| `Log run` | `Logging` |
| `Save` | `Saving` |
| `Add to closet` | `Adding` |
| `Retire` | `Retiring` |
| `Send` | `Sending` |

- On success the button returns to idle and the **screen** moves on. No green
  check state, no success toast on a form that navigates. A3 is the one form
  that does not navigate: its receipt (`Noted`) lands in the submit's place —
  see §6c.1.

## 6. Copy rules for errors

- Name the fix, not the rule. `Pick a temperature between -40 and 140.` — not
  `Value out of range.`
- One sentence, under ten words, sentence case, ends in a period.
- Banned: `please`, `invalid`, `error`, `oops`, exclamation marks, and any
  reference to a field being "required" in the abstract — say what to put in it.
- **No mono, no brackets in error copy** — including the numbers inside it.
  Bracket/mono notation marks measured values in the product's own voice; an
  error sentence is prose.
- The lexicon holds: **useful**, never **like**.

## 6b. Board conformance markup (round 18)

Screen boards carry three machine-readable marks. Keep them when editing.

- `data-screen-label` on the 390px wrapper; every direct `<span>`/`<p>` child
  of that wrapper that is not the phone frame carries `data-annotation=""`.
  Round rulings live in those `<p>`s — a diff tool reads them, so a ruling
  is never only in chat.
- `data-part` on meaningful regions inside a frame. Vocabulary (round 19):
  - every phone screen: `status-bar`, `header`, `tab-bar`, `primary-action`
  - A1: `drop-zone`, `parsed-card`, `conditions`
  - A2: `most-likely`, `closet-picker` ⊃ `kit-list`, `outfit-photo`
  - A3 and DS2: `verdict-row` (same name on purpose — the harness may diff
    them against each other), A3 `flag-chips`, `noted`, `share-toggle`, `submit`
  - C: `top-bar`, `rail`, `grid-header`, `grid`
  - D: `photo`, `run-strip`, `kit`, `try-kit`, `note`, `reactions`
  - E1: `feed-tabs`, `feed` ⊃ `post`
  - DS1/DS2 shell: `top-bar` ⊃ `wordmark`, `bar-nav`, `bar-actions`; `columns`
    ⊃ `primary`, `rail`
  - DS2: `backlog-header`, `column-heads`, `backlog-row` ⊃ `verdict-row`,
    `keys`, `selected-card`, `attribution`
  - round 20: `flag-more` (A3's MORE › chip), `verdict-badge` (D run-strip,
    E1 author row)
  - round 21: A3b `sheet` ⊃ `garment-groups`, `done`; D6 `dead-letter` ⊃ `job-row`
  Add more only as kebab-case nouns; never rename one.
- `data-state="<name>"` on a region drawn in a state other than the screen's
  resting state, so a composite board reads as two states, not one layout.
  So far: A1 `drop-zone` = `before-file`; A3 `noted` = `after-log-it`. The
  harness diffs a `data-state` region only against the build in that state.
- `data-divergence="<reason>"` on a region whose built composition is allowed
  to differ from the board. Record it as intended, not a failure. So far:
  C `rail` = `ships-whole-or-one-column`.
- `data-status="unbuilt"` on a screen or region with no built counterpart
  yet; the harness skips it by design. So far: E2 (post-MVP), D `try-kit`
  (deferred with saved kits), DS1's placeholder columns.
- `data-content=""` on an element whose colour is data (a garment's own
  colour, e.g. `#1F2A44` on AH2), not palette. Exclude from colour checks.
- `data-annotation=""` *inside* a frame marks an explanatory block that is
  drawn in situ but is not product (D's "No comments in v1", DS2's "Verdicts
  saved here…"). Not composition; skip.
- Screens are drawn at 390px, the device target.

### Colour conformance scope (round 19)

Only hex **inside a `data-screen-label` frame** is checked. Everything outside
is board chrome — captions, BACKGROUND callouts (`#22161C`), prose
(`#DEDDD6`) — and is unlicensed by design. Inside a frame, hex outside T1 is:

- a **state tint**: `--action-hover #FF57A2`; `--ink-hover #24242B` light /
  `#DEDDD6` dark (both in Theme, 17 roles). Dark boards that hovered an
  ink button to `#24242B` were drift; corrected.
- a **placeholder photo hatch** — any `background-image: repeating-linear-
  gradient` pair and its base (`#E9E8DE`/`#E1E0D5`, `#E3E2D8`/`#D8D7CC`,
  `#22222A`/`#2A2A31`, `#24242B`/`#2C2C34`) and the blurred-face `#CFCEC3`.
  Excluded; a photo replaces them.
- **drift** to correct to the nearest T1 role: light `#DEDDD6`-on-ink →
  `--quiet` dark value; `#F9F8F4` → `--panel`; `#8B8B84` → `--muted`;
  `#EDE7C8`/`#4A4820` unread-row hairline → `--hairline`. Dark `#2E2E36` →
  `--hairline`; `#14141A`, `#17171C` → `--panel`; `#121217` → `--ground`;
  `#A0A0A6` → `--muted`. Pre-round-13: `#009F8C`, `#C41E6A`, `#6E6E74`.
- **content**, marked `data-content=""`: `#1F2A44` and any garment swatch.

Nothing else is licensed; report it.

**`#DEDDD6` is two things; classify by property, not value** (round 20).
As a `background` on an ink-filled button inside a dark frame it is
`--ink-hover` and legal only under `style-hover`. As a `color` inside any
frame it is drift → `--quiet` dark `#B9B8AE`. Outside a frame it is prose
and out of scope. Round-20 sweep: `#4A4A52` → `--hairline` dark `#2A2A31`
(nav-inactive use → `--placeholder` dark `#6E6E74`); `#C41E6A` → `#C21A6B`;
`#009F8C` → `#00776A`; corrected on every board. No unlicensed hex remains
inside a frame beyond the three buckets above.

## 6c. Behaviour the boards draw but did not say (round 20)

End states the boards show, with the rule behind each. These are rulings.

### A3 · Verdict

1. **Flag chips are generated, never composed.** Five chips in two blocks.
   Block one, up to two per-garment flags: `GARMENT + TOO MUCH | NOT ENOUGH`.
   Direction follows the verdict — warm → too much, cold → not enough,
   dialed → the garment with the weakest record in this band, either
   direction. Garment = weakest band record first. Block two: tags ranked by
   this runner's use in the band, then global, filling to five. A sixth chip
   `MORE ›` opens **A3b**: every kit garment as a `Fine / Too much / Not
   enough` triple (same choice-group rules as the verdict row, §2) plus all
   nine tags. "The Harrier was not enough" is either a suggested chip or one
   tap in A3b. `Fine` is the default and is never a chip. Changing the verdict
   recomputes unchosen chips; chosen chips stay. Chosen = ink fill, ink-hover
   on press; the `✕` is the whole chip's affordance, not a second target.
2. **Noted is a receipt.** It appears only after `Log it` resolves, in the
   submit's place, replacing `share-toggle` and `submit`. The verdict row
   (filled, brackets closed) and the chips stay, read-only. Noted has no
   button; the tab bar is the exit. Its two sentences are generated: the
   garment record that moved, then the rule that changed, if one did.

### A2 · Attach kit

3. **`ALL ›` and every `+ CATEGORY` chip open A2b as a sheet** for that
   category. Never a route, never in place. A2b opens with `MATCHES
   CONDITIONS` on and states the hidden count; a category with zero matches
   opens with the filter off and no hidden block. Selection in A2b commits on
   its button (`Add {garment}` / `Add 3 pieces`); `✕` discards.
4. **A kit is required; the count lives in the header sub-line.** `6.2 MI ·
   41°F DAMP · 0 PIECES` until something is chosen, then `· N PIECES`. The
   primary label is fixed (`Next — did it work?`). Tapping it with none
   chosen marks the `closet-picker` group by message band alone: `Pick at
   least one piece.` The escape is the text link beneath the button, `Not now
   — leave it in the queue`: the run stays in DS2 with no outfit, exactly like
   an imported run. No verdict without a kit — a verdict teaches nothing
   about garments.

### A1 · Upload

5. **The drop zone is the before-file state.** Once a file parses it goes;
   the parsed card's header carries the filename and `REPLACE`, the only way
   back. While parsing, the drop zone stays and its title becomes the
   breathing brackets — `[ Reading MORNING_RUN_0829.GPX ]`, the 900ms loop
   from §5. No bar, no percent, no second device.
6. **One correction control: the run time on the parsed card.** Tapping
   `6:04 AM` opens a time picker; on change, conditions re-fetch and the
   block re-renders (static, no motion). Date follows the same control.
   Weather values are never editable. Copy under the conditions block:
   `Never typed by hand. Wrong time? Tap it on the run card and we'll
   refetch.`

### D · Post detail and E1 · Feed

7. **The badge is never on the photo.** On D it sits in the `run-strip`,
   right of the distance, next to pace — the one block every post has. On E1
   it is in the author row. Both are `data-part="verdict-badge"`. Photos
   carry only the `1 / 2` counter.

### DS2 · Backlog

8. **`Same as …?` names the most recent run in the same band that has an
   outfit.** Within seven days of the row's own date (not today): the
   weekday. Beyond: `MON D` — `Same as Sep 4?`. None: `No usual kit here ·
   Pick`.
9. **The rail sentence is generated from three slots, fixed order:**
   (1) conditions in words — band adjective, moisture adjective, time of day;
   (2) the count of runs in this band; (3) the verdict split, naming the one
   garment that separates dialed from not, if one does. Slot 3 falls back to
   `dialed in one/two/…`; at zero runs the whole sentence is `No runs in this
   band yet.` Never free text.

### C · Closet (desk)

10. **One-column fallback is one flat grid.** Every piece, header `47
    pieces`, the three rail groups as filter chips above the grid (round 16).
    The header count follows the chips; `14 tops` appears only once a GROUP
    chip is set. **Badges are computed, never set:** `MOST DIALED` = the one
    piece in the visible set with the highest dialed share at ≥5 runs;
    `RETIRE?` = any piece at ≥5 runs, dialed ≤25%, same off-direction on ≥3.
    **Top bar is DS1's, verbatim** — the board that read `The Call` / `+ Add
    garment` was stale and is redrawn. Adding a garment is the grid's dashed
    tile and the Y route; never a bar action.

## 6d. Round 21 rulings

Drawn in `Round 21 Rulings.dc.html`; D6 in `Operator Screens.dc.html`.

1. **A3b** is the shade sheet's frame: heading `Anything specific?`, one
   `Fine / Too much / Not enough` radiogroup per kit garment (kit order,
   garment name as legend, §2 rules), all nine tags as A3's pill, `Done`
   (outline secondary). Done and swipe-down both keep. Once Noted shows,
   `MORE ›` is removed, not inert. Re-tapping a chosen garment chip returns
   it to Fine.
2. **Chip inputs** confirmed as built: weakest = lowest dialed share in band,
   ties → more runs → kit order; needs ≥2 band runs to qualify; never-worn
   and never-off garments are not suggested; dialed suggests one garment in
   its more-frequent off direction; no garment chips before a verdict, tags
   fill to five.
3. **Nothing to note:** Noted still lands, one sentence. No band: `Logged. No
   weather came with this run, so no band record moved.` No kit: `Logged. No
   kit on this run, so no garment record moved.`
4. **Chips:** 32px drawn, 44px target via `::before { inset: -6px 0 }`,
   group gap `12px 7px`.
5. **Theme, 19 roles:** `--hiviz-text` #F5FF3D (ink surface only, both
   themes); `--dialed-tint` #D2F0E9 light / #0A2524 dark.
6. Swatch RADIUS.none, ink-block `--hairline` dark, wordmark `.run`
   #7A7A70 on paper — all confirmed.
7. **"Visibility"** stays the runner label; no privacy control may use it.
8. **Bend 2** met (O1 → O3 → O4 → P3); the phone-photos line is retired.
9. **`/` from 720 up:** own bar — wordmark + one action (`Log in` / `Your
   closet`). No nav, search, bell or `Log a run`; hero drops its wordmark.
   Below 720, no bar. Full landing brief still open.
10. **D6 · Gave up:** dead-lettered jobs, one row each: job, subject, what it
    was trying to do, why it stopped, tries + last attempt, actions.
    Enrichment: `Re-fetch page`, `Re-run extraction` (disabled with no
    fetched page); others: `Retry`. `Drop` removes the row.

## 7. The primitive

`src/ui/FormField.tsx` ships the whole contract: `useFormSubmit`, `FormField`,
`FormStatus`, `FormErrorSummary`, `FormFailureBand`, `SubmitButton`. A form that
uses them cannot get this wrong; a form that hand-rolls any of them is a review
failure. Rendered spec: `Form Contract.dc.html`.


## Round 25

- **Log a run at ≥1040** is a desk page, not the panel. DS1 columns: the phone form in the primary column (max 620; same fields, order, validation); `data-part="rail"` holds read-only cards only — no input, button or radio inside it. A1 rail: conditions + band record. A2: this run + last 3 in band. A3: this run + kit records + band history. A2b replaces the primary column. Verdict row stays ≤390. Primary action sizes to label, left. Bar unchanged, no nav underline, pill `aria-current="page"`. 720–1039: reflow. F follows (round 26). Auth and onboarding stay in the panel.
- **Strava** never imports. Receipt: "Strava connected. After each run, we'll remind you to add it here. You upload the file (GPX, TCX or FIT) from your watch or a Strava export, then add what you wore." T3b: KEPT runs/outfits/verdicts, KEPT closet, KEPT adding runs by upload; STOPS the reminder after each run. Push: "New run on Strava" / "Add it here: upload the file, then what you wore." S1 row: "A run landed on Strava at {time}. Upload its file to log the kit." · Add it ›. No distance/route/pace from Strava. T3a toggle and T2 import screen retired.
- **E2-lite** eyebrow `SAME CONDITIONS · FEELS [{lo}–{hi}°] · {PRECIP} · {WINDOW}`; line "In {feels}° and {precip}, {window}, wherever they were." Empty: "Fewer than five runners logged {feels}° and {precip} in two weeks, which is too few to show without showing who." Never "near you".

## Round 26

Drawn in `Round 26 Rulings.dc.html`.

- **Usernames.** `@handle` replaces display_name everywhere (feed author row, D, S1 notifications, report sheet title "Report @x's entry?"), in Archivo 600, never mono. Sign-up asks for email and password only; O0 "What should runners call you?" is step 1 of onboarding for email and Google. 3–20 of [a-z0-9_], can't start with _, case-insensitive unique, lowercased as typed, checked on Next. Taken: "@x is taken. Try another, like @x_pdx." (one real free suggestion). Changing it: Settings › Username; old /@handle shows "This runner changed their name." with no redirect.
- **A1 start time.** The stats-line time is a button ("Change start time, 6:04 AM") that opens a START TIME row in the parsed card: hint "The file said {t}. Change it if your watch's clock was off.", field + "Get weather". While fetching, the conditions block reads "WEATHER FOR {t}" · [ Getting it ] · "WAS {old} AT {t0}" (in the rail at the desk). Success: "{t} · CHANGED". Failure §4a `STILL {t0}` · "Couldn't get weather for {t}. Try again?", and time and conditions revert.
- **R2b.** Twelve 5 °C bands (−20…40), labelled in the runner's unit (°F −4–5 … 95–104), in a 3-col radiogroup, plus Sky: Dry / Damp / Rain / Snow. Both required; nothing preselected. Button "Set {band} and {sky}". Badge `SET · 41–50° · RAIN`; never show the midpoint.
- **Delete with runs.** Title "Delete the {piece}? Retire it instead." Lists GOES kit on {n} runs, GOES record in {b} bands, STAYS entries and verdicts, "This can't be undone." Pink "Retire it", hairline "Delete it and its record", Cancel. No second confirm.
- **F photo refused.** Fields go and the action becomes Done (→ Y). §4a `PHOTO NOT ADDED` · "Garment saved, photo didn't. Try again?" plus the reason. "Try again" only on network failure; otherwise "Pick another".
- **F desk.** DS1 split. Rail: "Already in your closet" only (same category and type, ≤5, retired included, SAME NAME mark), read-only rows. No card before a category is picked.
- **Email verification.** Au4 "Check your email" for every sign-up, whether the address is new or registered (the registered address gets a "You already have a dialed.run account" email). Au3's exception is retired. The link works once, for 24h. Landings: expired / already confirmed / confirmed. Resend: [ Sending ] → "Sent ✓" (60 s) → rate-limited §4a `NOT SENT` "That's 5 links this hour. You can send another at {time}." Unverified CAN do everything private; WAITS: share (queues, sub-line "Shares when you confirm your email."), Useful, report, email change, reset by email. One nag band on Feed and You. Google accounts skip Au4.
- **Typed city.** Hint "Add the state or country. We'll show you the place we found before we use it." Field + Find → "Weather for {resolved}" + Use this. Not found: field message "We couldn't find "{q}". Check the spelling, or try a nearby city." Lookup failure: §4a `NOT FOUND YET`. O1: the resolved string becomes the chip; Enter = Find; Next with an unconfirmed entry → "Press Find, or clear the field to skip."
- **Google button.** Google's light/dark spec taken whole (#FFFFFF/#747775/#1F1F1F; #131314/#8E918F/#E3E3E3; label Archivo 500; official G), pill, 48 high, "Continue with Google". `data-part="google-button"` is the sole palette/icon exemption.
- **Privacy policy.** /privacy, 620 measure, `lead` step (round 27), sticky contents column at the desk, plain list on the phone. Linked from the signed-out footer, under Au2 ("Creating an account means you've read our Privacy policy."), Settings › About, and email footers. Not under Au1.
- **Field focus.** On FormField the ring sits on the border (outline 2px ink, offset −1px). Error = 2px ink border + band; error+focus looks the same plus the band, and the band is the discriminator.
- **Rulings.** Swatch only when the shade is exact (§AH 08 amended). The stranger flag is dropped from D. JPG/PNG/WebP. STILL MARKED. Round 21–23 placeholders confirmed. Dates: "SAT AUG 29" / "Sat, Aug 29". K threshold 15 ("Log 15 verdicts and the Call starts.", 15-cell meter). Breached password copy confirmed, failing open. Counts in digits. Password "At least 10 characters." G: settings icon button in the header in every state.
- **Notification email (19).** In v1 only the Strava run reminder can be emailed. It's on by default, sent 20 min after landing, skipped if the run was uploaded or the push opened, and limited to one a day (the next day's email counts any extra runs). Subject "New run on Strava. Add it here." Body "A run landed on Strava at {time}. Upload its file, then add what you wore." Button "Add it". Footer: "You get this because Strava is connected." · Stop run reminder emails · Email settings · Privacy policy. Sends List-Unsubscribe with one-click. Settings › Notifications has per-kind Push/Email switches: Run reminders (push, email); Useful (push; email "IN THE APP ONLY"); Account and security (email "ALWAYS SENT", no switch). Unsubscribe landing (round 27 #8 overrides): a signed link that never expires, no log-in; the page has one "Unsubscribe" button (POST); List-Unsubscribe-Post stays one-click. "Run reminder emails are off" · Turn them back on.
- **Invite-only (20).** Au2 invite stage: INVITE CODE is the first field, above email and Google (both need it); /join?code= prefills it. Used: "That code has already been used. Ask whoever sent it for another." Invalid or revoked: "That code doesn't work. Check it against the email or message it came in." Au5 Request access (email plus an optional 280-character note) → the receipt "You're on the list", identical for new, repeat and existing addresses. Invite email "Your dialed.run invite" · Create your account. Desk D7 Access: Requests (oldest first; Send invite = single-use code + email; Decline is silent) and Codes (DIAL-XXXX with no 0/O/1/I; label, uses limit, used-by @handles, Copy link, Revoke with 10 s undo; a code is consumed at account creation). At public launch one flag removes the field and the request link.
- **Strava button (21).** Strava's official orange "Connect with Strava" asset, 48 tall, unaltered, on both themes, on T1 and the onboarding Strava step, left-aligned, wrapped in our link; our brackets show beside it while in flight. Disconnect stays our pill. `data-part="strava-button"` is exempt. No "Powered by Strava" mark (we show no Strava data).
- **Icons + OG (22).** "[d]" on an ink tile: favicon.svg, .ico 16/32 (16 = brackets only), apple-touch 180, manifest 192/512 plus 512 maskable, theme_color #0B0B0E. OG 1200×630 for a shared entry: wordmark, date, conditions display, verdict chip, distance/feels/wind, kit, @handle. Never the photo, note, route or flags. og:title "@handle · {temp} {precip}, {verdict}". (Superseded by round 27 #7: only the default card ships; og:title "dialed.run" everywhere.)

## Round 27
- **Contracts.** §06 carries the FormField ring exception (2px, offset −1px). Theme T1 and icons.js (`FOREIGN_MARK_PARTS`) name google-button and strava-button as the only foreign marks. §AH 08 amended on its board. Form Contract 02b: FormField 50px; non-form failures = §4a band sized to the control.
- **Unverified.** Entries save PRIVATE; A3 switch off with "Confirm your email to share. This run saves private."; pressing opens the Confirm-your-email-first sheet. Confirming restores the default for new runs; earlier runs stay private. No queue, no "3 runs shared.".
- **"Public" retired in copy.** "Share with runners on dialed.run"; state labels SHARED · PRIVATE. Default OG card only. Whole site noindex until public launch; afterwards only / is indexable. Signed-out entry URLs go to Au1 "Log in to see this run."
- **Reset.** Au1 "Forgot it?" → Au6 request → "Check your inbox" (same for any address) → Au7 set password → "Save and log in". Links work once, 1 h; a new request kills the old. Completing confirms the email and signs out other devices. Google-only accounts get "Set a password".
- **U1 Account.** Email (current password; confirm to new, notice with "This wasn't me" to old; old stays live until confirmed), Password, Sign out everywhere, Export (one a day, emailed ZIP link, 7 days, logged-in), Delete (password or Google re-auth; 7-day pending, signed out, shares hidden, handle reserved; log-in shows "Keep your account?").
- **Legal.** Au2: "By creating an account you agree to the Terms and have read the Privacy policy." + "dialed.run is for runners 16 and over." No checkbox. Turnstile managed, above the primary on Au2 and Au5. /terms, /copyright in /privacy's layout.
- **Emails.** Reset, email change (new/old), Strava disconnected, content removed, ban (no case number, reply to appeal), export ready, delete scheduled. Any state-changing link lands on a page with a button.
- **Notices.** §4a bands in place: STRAVA IS FULL (build copy), S1 NOT CONNECTED, PHOTO/NOTE REMOVED, garment photo BEING CHECKED ("ONLY YOU" tag), Au1 ACCOUNT CLOSED (Google or password, no case line).
- **Desk D8 Runners.** Search, list (handle, email, joined, runs, reports, state), right column: Rename (reason list → @runner_NNNN, old handle blocked; runner sees "Pick a new username" once) then D3 ban.
- **Confirmed.** Consensus "Most"/"Some" ("Split" on ties, "All" alone). Bell "Notifications, 3 new", ">9" = "more than 9 new". Deletes at the foot under YOURS, photo delete on the photo, no overflow; retire-confirm grammar with "Keep it" focused. W3 blur: 3×3 44px square map. Own under-review: UNDER REVIEW tag + HIDDEN WHILE WE CHECK band. "Photo not added" body reworded. Closet tile photo 4:5. Desk primary sized to label.

## Round 29
- **§4a kickers stay unfilled.** The contract wins. Kicker: MONO.xs (round 30 #1), caps, ink, inside the 1px band. Yellow only where the fix is (the field message). Round 28 #13b reversed; R26/R27/R28 and Feed bands redrawn. Desk keeps hi-viz as its "needs a person" accent (rail, counts, NEW), never on a band.
- **Desk (D-87).** Today, Review, Access, Duplicates, Runners (order corrected round 30). Gave up is a section on Today; Today's count is the Gave up count.
- **CSAM (D-88).** Confirm: "Remove this photo everywhere and keep the evidence for the report?" + "@x's account stays open. Closing it is a separate action on their Runners page."
- **[UNDER REVIEW] (D-90).** Bracketed, MONO.xs ink, no fill, in the SHARED slot.
- **D7.** Revoked = --quiet + line-through, no opacity. STATE column ink/quiet, no hue. Made line ink. NEW on hi-viz (Desk accent). Every row action fails on its row: NOT SENT, STILL WAITING, STILL REVOKED, STILL ACTIVE; page-level NOT CHANGED only for New code.
- **Terms prompt.** A page (Keep-your-account panel). Never accepted: TERMS · "dialed.run has Terms now. Read them, then accept to carry on." Bump: TERMS UPDATED · "The Terms have changed…" + owner's WHAT CHANGED summary (1–3 lines, --tint; absent if none). Accept / Log out; "delete your account" opens U1 delete. Changed-again = NOT ACCEPTED band. Refused save returns to the filled form after Accept.
- **Email reopen.** "We reopened @x. You can log in, and your runs are back as you shared them." · Log in · "Your handle is still yours." Footer: Privacy policy · Terms · Copyright.
- **Au5 counter.** From 120, right under the field, --muted MONO.xs; ink+600 past 140; refusal on send as field message. Announced at 120 and 141 only.
- **/open-source.** Legal layout. "Built with thanks". Grouped by licence (type first), licence text once per group, three packages then "Show all N", search by name. Generated from lockfile and manifests. Linked from signed-out footer and Settings › About ("Open source · What dialed.run is built on").
- **Confirm-email band** is static, no role — not a second region. Sheet leads: Useful "Marking runs Useful needs a confirmed email." · Report "Reporting needs a confirmed email." · Share "Sharing needs a confirmed email. This run saves private." · Email change "Confirm this address before you change it." Body "We sent a link to {email}." Resend: outline pill on the sheet, link on the band.
- **Google bands** all under the button. Refusals: link or nothing; fault: Try again.
- **Confirmed.** O0 NOT KEPT / [ Keeping ]. Back to contents below desk. Email footer labels. Export adds terms.csv (version, accepted_at, how).

## Round 30
Drawn in `Round 30 Rulings.dc.html`.
- **§4a kicker = MONO.xs**, ink, caps. tokens.js COLLAPSE carries it; no new step. Boards drawn in Archivo Black 11 are not redrawn (round 10 precedence).
- **Redraw notes.** Operator Screens D0/D6 rail was not redrawn in round 29 and now is. Round 22 Coverage has nothing that depends on round 29, so the note was wrong and there's nothing to re-export.
- **Rail (D-87).** Today, Review, Access, Duplicates, Runners.
- **Terms gate (D-95, D-96).** Lets through: delete, export, read-only Settings › Account. Escape line: "Rather not? Log out, or go to your account to export or delete it." After Accept: back to the route; typed values aren't restored.
- **Signed-out entry link (D-58).** app.dialed.run/feed/entry/{id} signed out shows nothing of the entry. Title "Log in to see this run", the pitch, Log in (filled), Request an invite (outline, → dialed.run/invite), "Have a code? Join". On a device that has signed in before, Log in leads and the invite drops to one line. After login → the entry; if it isn't visible to them → the Feed board's removed-entry state. noindex; default OG card. Supersedes the /r/{id} public view drawn on the Integrations board.
- **API tokens.** Settings › Account › API tokens. Name + "Shared entries only" (default) / "Include my private entries". Shown once as drn_…, Copy, "You won't see this again." The list shows name, scope, created, last used ("Never used"), and Revoke, which is immediate. Up to 10. Read-only, own account only, no expiry. Creating one emails a notice with "This wasn't me" (which revokes it). The export adds tokens.csv (name, scope, created, last_used; never the secret). The per-piece publish toggle on the Integrations board is dropped: the token decides scope.

## Pre-launch data requirements (for seasonal and annual reports)
These are cheap to add before launch and expensive after. The report page is drawn as M8 on `Marketing Site.dc.html`.
- **Terms + Privacy: aggregate publication.** dialed.run may publish anonymous aggregates of shared entries and closet pieces. Each published figure needs ≥20 runners (brand figures) or ≥5 (band figures, as for the guides), and no figure ever names or links to a runner. This ships in the launch Terms version, so it doesn't trigger a second acceptance prompt.
- **One catalogue entry per brand and model.** Every closet piece resolves to a catalogue model (or "unmatched"). Desk Duplicates is the merge tool. Reports only count matched pieces.
- **Closet added_at.** Store the date a piece was added, and its first worn date (derived from the first entry). This is required for "growing brands" and can't be backfilled.
- **Region (optional, opt-in).** Settings › Profile › Region: country, plus state/province where it applies. Off by default. It's only used in aggregates, never shown on a profile or entry, and it's included in the export (profile.csv). Hint: "Used only in anonymous totals, like what runners in your state wear. Never shown to anyone."

## Round 31 (marketing site, Phase 1)
Drawn in `Round 31 Rulings.dc.html`.
- **Hero type.** tokens.js MARKETING.hero: clamp(44px, calc(28px + 4.05vw), 76px), lh 0.95, −0.035em, caps. Used on the M1 and M8 h1 only. Every other marketing h1 is TYPE.display, and leads are TYPE.lead.
- **Ink blocks on marketing** (the Call card, the guide strip, the M3 invite card, the M8 data card). Light: `data-ground="ink"`, which takes T1's dark column. Dark: `--panel` plus a 1px `--hairline` (the T2 04 fallback), not `--tint`. The dark board is corrected. The guide strip follows the same rule, with hairlines top and bottom.
- **Off-table hexes.** #2A2A26 → --ink. #24242B (Call card rules) → --hairline in the ink scope. #4E4E44 on paper → --quiet for prose, --muted for MONO captions. Its dark twin is #B9B8AE, not #A0A0A6. #DEDDD6 → --ink. #E9E8DE (bar tracks) → --tint.
- **Wordmark.** Direction 08 everywhere: [dialed.run] with --action brackets and .run in --muted. The marketing boards' "[dialed]" is corrected.
- **M4 verdict scale.** The A3 verdict-row component, static, with Dialed selected: teal surface, ink text, the other four as hairline slots with MONO.xs ink words. No cold hue, so no pink on the page except the CTA.
- **Changelog, zero entries.** Not built and not linked until the first entry exists (like the guides). The footer link and /changelog.xml appear with entry 1.
- **404.** Legal layout, status 404, noindex. MONO.xs "404" · TYPE.display "Nothing at this address" · lead "The link may be mistyped, or the page has moved." · links Home / What to wear (if any band is published) / How it works. App paths on the marketing host (/feed, /login, /join, /account…) 301 to app.dialed.run with the same path and query.
- **M5b.** "When your code is ready we'll email you." No address echo.
- **Icons.** Unchanged from round 26 #22. **Default OG card**: a 600×315 layout rendered at 2× to make the 1200×630 image. Ground #0B0B0E. Padding SPACE[8]. Wordmark TYPE.title at top left. "Wear what worked." in TYPE.display, ink-dark (#F4F3EF), bottom left. MONO.sm "DIALED.RUN" in --muted dark at bottom right. One card for every URL on both hosts. This replaces round 27's "Log runs, see what worked" line.

## Round 32 · Anonymous totals
Drawn in `Round 32 Rulings.dc.html`. **The middle path, with five conditions. If A or B can't be met at launch, ship shared-only.**
- **Scope.** Published totals (guides, reports, any "runners wore…") count shared and private entries. In-app social proof stays shared-only. Closet pieces count only when worn on a counted run. Runs whose conditions the runner set in R2b (SET BY YOU) are excluded. Round 34: the old wording "manual-temperature" referred to the form removed in round 22.
- **A · Fields.** Band, sky, month, garment type and model, verdict, and region if set. Never notes, photos, route, start time or place, handle, or free text. The aggregate job has no read access to anything else.
- **B · Thresholds per figure.** Every displayed number needs 5 or more distinct runners (20 for a brand), including rows, sky sections, split sentences and region slices. Below that, the cell is left out.
- **C · Who counts.** Confirmed-email accounts only. Excluded: removed or quarantined entries, banned accounts, accounts pending deletion.
- **D · Opt-out.** Settings › Sharing › "Count my runs in anonymous totals", on by default. Off sub-line: "Off. Your runs leave the guides at tonight's update. Reports already published stay as they are." No confirm. Deleting an account opts out.
- **E · Disclosure.** A3 PRIVATE sub-line: "Only you see this run. Its kit and verdict still count, anonymously, in the guides. Change". If opted out: "Only you see this run." Au2 legal line adds: "Your runs count, without your name, in totals like the guides. You can turn that off in Settings." No onboarding step.
- **Copy.** M1/M2/M3/M4/M8 updated on both marketing boards. M4 gains a FAQ entry and a "How the guides are made" (#totals) section.
- **Terms/Privacy.** The draft paragraphs on the Round 32 board are for legal review and ship in the first published versions.

## Round 33 · Sync after round 30
- **Read API is general.** api.dialed.run: GET /v1/pieces, /v1/pieces/:id, /v1/pieces/:id/runs?asOf=&since=&cursor=, /v1/runs, /v1/bands. Each run has start, distance, duration, temp/feels in °F and °C, wind, sky, verdict word, the piece's flag and note, kit, visibility, and entry_url when shared. Callers aggregate for themselves. Integration Opportunities 02 is redrawn. The biglongrun block still shows the date only.
- **Owner adopted:** three hosts; legal pages move to the marketing host; guides and reports as anonymous totals on the open web (entries and profiles stay signed-in only, D-58); the terms "go back to" line; tokens keep reading while a runner is behind on the Terms; the token-created email (Round 30 6f); any runner can create tokens.
- **Not adopted:** the Strava kit line, and any link-preview card except the default.
- **Marketing site:** its own public Astro repo, rebuilt nightly, with guide data from the app's nightly anonymous-totals file. Before public launch it's Home and Invite only. Changelog entries are drafted by Claude from merged changes and approved by the owner (M7 amended).
- **Aggregates:** answered in Round 32: the middle path with five conditions. Reports count closet pieces only when worn on a counted run.
- **Au6** (Auth.dc.html): the Google fault band moves under the button, which keeps Google's own spec. MONO.xs kicker, and Try again in the band.

## Pre-launch: audience model (for Day 2 groups)
- **Visibility is an audience, not a flag.** `audience: 'private' | 'groups' | 'runners'` plus `group_ids[]` (empty at launch). Launch uses only private and runners. The UI copy is unchanged: SHARED = runners, PRIVATE = private.
- Every audience check (feed, entry page, API visibility, social proof, export) reads `audience`, never a boolean, so groups ship without changing existing data.
- API `visibility` already returns a word. `"groups"` will be added under /v1 (additive).
- Export: entries.csv `visibility` column → `audience`.
- Day 2 design lives in `Day 2 Groups.dc.html`.

## Round 33 · Contrast and lint fixes
- **--muted on paper is now #6E6E64**, the same as --label (4.6:1). The old #7A7A70 was 3.9:1 and failed AA for MONO captions, which is the job round 31 gave it. Dark was already the same as --label (#8B8B93). All boards are updated. The token name stays, so caption code keeps reading --muted.
- **no-raw-spacing lint** now checks the whole value. It used to stop at the first `0` or `v`, so it missed `padding: 0 20px`, `var(--space-4) 20px`, negative values, longhands, camelCase JSX and unitless numbers. It also flagged `border-top: 1px` by mistake. The test cases are in tokens.js LINT_FIXTURES.
- **--placeholder is now the same as --label**: #6E6E64 on paper and #8B8B93 on dark. The old #9A9A90 (about 2.8:1) and #6E6E74 (3.7:1) failed AA. Axe doesn't check placeholders, so it didn't flag them. On the boards the token had also spread to tab labels, field captions, metadata and footers, so every use is replaced. An entered value is still told apart from a placeholder because the value is --ink. Disabled labels take the same grey. They're exempt, but nothing in V1 needs a lighter grey.

## Round 34 · M4 copy review (dialed.run-site, Phase 1)
- **a · Weather.** Both are true. Weather is fetched. R2b lets a runner set conditions only when the archive has no record for that hour. Brand principle 02 stands, because those runs never reach the totals. So the marketing copy is qualified and C is reworded:
  - M1 step 01: "From Strava or a file. Weather comes with it, fetched for when and where you ran."
  - FAQ "Where does the weather come from?": "Visual Crossing, for the time and place your run started. If there's no record for that hour, you set it yourself, and that run stays out of the guides."
  - In-app A1 "Never typed by hand." is unchanged. It sits on a fetched block, so it's true there.
- **1 · The loop** (TYPE.lead): "Log the run from Strava or a file, and the weather comes with it, fetched for when and where you ran. Then say how it went, from way cold to way warm, and which piece was off if one was. That takes ten seconds, and every run you log adds to your record."
- **2 · The call** (TYPE.lead): confirmed as written.
- **3 · #totals** (TYPE.body, bold lead-ins). Written in second person, like the rest of M4:
  - **What's counted.** "Each run adds its feels-like temperature, sky and month, the type, brand and model of each piece you wore, and your verdict. Your region counts too, if you've set one in Settings. Never your name, handle, notes or photos, and never where the run started or the time of day."
  - **When a figure shows.** "Every number we publish needs at least 5 different runners behind it, or 20 if it's about a brand. That goes for every row, section and sentence. Below that, the figure is left out. It's never shown as 'fewer than 5'."
  - **Who counts.** "Confirmed accounts only. If you've turned off Count my runs in anonymous totals, your runs are left out. So are removed entries, banned accounts, accounts being deleted, and runs where you set the conditions yourself."
- **b · Region.** Keep it. It's disclosure, not a feature claim. A says the job reads region, so the page must say so even before region slices ship.
- **c · Shared-only fallback.** Not needed. Before public launch Phase 1 is Home and Invite only (round 33), so M4, the FAQ and #totals publish with the app, after A and B are confirmed. If launch goes shared-only, M4 waits for a copy pass then. No alternate copy is kept in the repo.
- **d · Models.** The public copy says "brand and model". "Catalogue" stays an internal word.
