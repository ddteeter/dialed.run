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
- **Legal.** Au2: "By creating an account you agree to the Terms and have read the Privacy policy." + "dialed.run is for runners 18 and over." (round 35; was 16) No checkbox. Turnstile managed, above the primary on Au2 and Au5. /terms, /copyright in /privacy's layout.
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
- **Launch guard.** A DB check constraint allows only `private` and `runners` in `audience` (on entries, and on the default-visibility and Strava-import-default settings). The API and the app reject `groups` when saving. So no row holds `groups` before Day 2, and `group_ids` stays empty everywhere.
- **One audience check.** Every read path (feed, entry page, API, social proof, export, notifications) calls a single `canSee(viewer, entry)`. Nothing else compares `audience` to a value. Day 2 changes that one function.
- **Day 2 migration (planned).** Add `selected`, or rename `groups` to `selected`, and swap the constraint. Rename `group_ids` to `audience_ids`. No data is rewritten. Followers becomes a built-in group per runner, and existing follows become its members, already approved. `private` and `runners` keep their meaning. Nothing is widened automatically. Turning on follower approval keeps existing followers.
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
- **M5 note field.** Confirmed, with the placement corrected to match Au5. The order is label NOTE · OPTIONAL, then the hint on its own line, then the field, then the counter. The counter goes right under the field, right-aligned, and appears from 120. It doesn't sit beside the hint. The field comes after email and before Turnstile. 140 characters max, the same as the Au5 counter ruling. The older "280-character note" in the Au5 summary is superseded. Past 140: ink and weight 600. On send: a field message. Announced at 120 and 141 only. Drawn on both M5a boards in the resting state.
- **M5 intro** stays: "One email when yours is ready, and nothing else." It promises what we send, not what we ask for. The legal line changes to "See the Privacy policy for how we use what you send.", because the note is data too.

## Round 35 · Fourteen asks from the build (items 45–58)
Board: `Round 35 Rulings.dc.html`.
- **45 · Flagged handle row.** Drawn on Operator Screens D1. It names why: kicker HANDLE · RE-CHECK in place of the item kind; the `[classifier]` tag stays. Line: "The hourly re-check flagged a handle this runner already has. Nothing is hidden while it waits." D8's "Why the name has to go" picker, Rename (submit), Keep (text button). No Approve, Remove or CSAM. The taken-placeholder sentence shows in the row's control band under NOT RENAMED. Keep clears the flag until the word list changes.
- **46 · Onboarding close.** Qualified: "Weather comes with each run, fetched for when and where you ran." Light and dark.
- **47 · T1 erratum.** Muted note: "was #7A7A70 at 3.9:1". Placeholder note: "was #9A9A90 / #6E6E74". No value changes.
- **48 · M5 note.** Confirmed. Drawn in round 34 in Au5's order.
- **49 · Confirm email from Follow.** (a) Lead: "Following runners needs a confirmed email." (b) Not drawn. While the address loads or if it can't be read, the body is the lead alone and no space is reserved. The address line and Resend appear together when it arrives, with no motion.
- **50 · Beside rounds 29–30.** (a) Drop `role="status"` from the frames. A band is its own status region only on a screen that has no page region. (b) "Attach the kit" (A2) and "The verdict" (A3) confirmed. (c), (d), (e) confirmed.
- **51 · Beside W3 and Review.** (a), (b), (e), (f) confirmed. (c) Reworded: "Auto-blur covered 2 areas. You covered 1 more. Tap one to undo." / "Auto-blur couldn't check this photo. Tap anything you want covered." (d) Words confirmed; Use this photo is hidden while the band shows.
- **52 · Beside the closet.** (a) Names and plurals confirmed. (b) Category and Type come first, then Brand and Name, at every width; type picks the glyph and defaults. (c), (d), (e) confirmed.
- **53 · Beside the Feed.** (a) Confirmed. (b) [UNDER REVIEW] goes first on G's row meta line, outside the link, so the link's name stays the entry label. Drawn. (c) A lone photo has no counter; the pager shows from 2.
- **54 · Consensus words.** Amends round 27 #25. The words claim a share of matched runners, not a rank. All = every matched runner wore it, even with other bars beside it. Most = more than half. Some = anything less (a lone bar at 3 of 14 and a leader at 5 of 14 both read Some). "Split" is dropped; equal bars show a tie. Two bars can both read Most.
- **55 · Gave up.** (a)–(g) confirmed as built.
- **56 · Au2 date of birth.** Drawn. TextField "Date of birth", platform date control, after Invite code and before Email, shown whether or not sign-up is invite-only. (b) Schema errors confirmed. (c) Amended: the under-18 band (NOT CREATED · "dialed.run is for runners 18 and over.") has no Try again, because a retry is refused for a day. (d) Confirmed. Legal line is 18 on Au2, M5 and round 27 #12. The date is checked and never stored.
- **57 · Export words.** Confirmed: "Runs, closet, entries and photos" and "Your runs, closet, entries and photos are in one ZIP." Redrawn on rounds 27 and 28. The README lists a run file only when the ZIP has one.
- **58 · Intimate-image removal.**
  - (a) W1 reason, after "The photo shows someone inappropriately": "It's an intimate image of someone, shared without their consent". One report hides it from everyone; receipt unchanged. Drawn on W1, light and dark.
  - (b) The clock belongs in the header, right side, in place of the age: DUE IN 31H, then OVERDUE. The brackets stay about people. Drawn.
  - (c) Confirmed: "A moderator removed this photo: it's an intimate image shared without consent."
  - (d) Subject confirmed. Body: "Someone reported a photo as an intimate image shared without consent. It's hidden from everyone now. The law gives us 48 hours to decide." Button "Open Review". Foot confirmed.
  - (e) Drawn: /takedown (public, no account) fields Email, Full name ("Typed as your signature"), Link to the image, What it shows (one line, optional), checkbox "I believe in good faith this image was shared without consent, and I'm the person in it or acting for them." Submit "Send the request". Receipt: subject "We have your removal request"; body "We'll decide within 48 hours, by 2026-10-12 13:05 UTC, and email you either way." Review gets a REMOVAL REQUESTS section above the queue, same row shape: header clock, the requester's line, Take it down (submit), Decline (text button). Decline needs a one-line reason, which the requester's email carries.

## Round 37 · /takedown abuse limits (D-118)
Board: `Round 37 Rulings.dc.html`.
- **59a · /takedown/confirm.** All five states drawn, words confirmed. Nothing happens on arrival. Failed press: NOTHING SAVED · "That didn't go through." with Try again.
- **59b · Receipt past the cap.** Confirmed, with a lead: "It isn't hidden yet. To have it hidden while we look, confirm this request. We'll decide within 48 hours, by …, and email you either way." Button "Confirm the request". Foot unchanged. A blocked requester gets the normal receipt, never this one.
- **59c · Valve email.** Confirmed as given.
- **59d · State bracket.** In the brackets, after [via /takedown]; the header's right side stays the clock. Words: [hidden], [unconfirmed], [valve shut], [blocked]. No bracket when the link isn't ours. Confirming later files again, and the bracket shows what that decided.
- **59e · N more.** Confirmed: "2 more from this requester", a mono caption under the address, only when N ≥ 1.
- **59f · Block and decline all.** Drawn: resting, question open, after. Words confirmed; N counts every open request including this one. Focus opens on Cancel, as CSAM's does; Cancel and Esc return it to Block and decline all. After: the requests leave at once, the page status region says "Blocked. N requests declined.", and focus moves to the next row or "Nothing waiting".
- **58k · W1 link.** Kept. A hint under the intimate-image reason, shown only once it's picked: "Rather not use your account? Report it without signing in", linking to /takedown. Images not on dialed.run go through the footer link.
- **59g · Which image, signed out.** A field, not a hint. "Their dialed.run username · optional", hint "If you know who posted it.", after Link to the image (whose hint stays "A dialed.run link, or say where it is."). It's a TextField with the handle schema; an unknown username is kept as written and not refused, because the requester may have it slightly wrong. In Review, a request in words with a username reads "Not one of our links: find it on @name's entries from what they wrote." Drawn on round 35's /takedown frame. No screenshot uploads.

## Round 38 · Built beside or without a drawing (items 60–65)
Board: `Round 38 Rulings.dc.html`. In-place rewrites: Round 27 #21, Round 28 #6, Round 29 #4, Round 32 1a/1b/2a; U2's conditions-pool card marked retired on Remaining Screens (light and dark).

**Blocking public launch (61)**
- **61a · Change sheet.** Confirmed as built: it holds only the totals group (title Privacy, switch, sub-line, "How the guides are made", Done). Done returns focus to Change, and A3's private line re-reads the switch.
- **61b · One name.** Privacy, on U1's row, the sub-page title and the sheet title. "Sharing" is no longer a name. U1 sub-line: "New runs shared · Counted in totals", with "private" / "Not counted" when those apply.
- **61c · Two groups.** Privacy sub-page: NEW RUNS (Share new runs + Save; it's a form) then, after a --hairline-2 rule and outside the form, ANONYMOUS TOTALS · SAVES AS YOU SWITCH (the switch + link; a failure shows §4a NOT CHANGED in this group). The totals switch comes last in tab order. Round 32 1a/1b relabelled.
- **61d · Unconfirmed runner.** ON: "Once you confirm your email, your runs add their temperature, kit and verdict to the guides and reports, and shared runs count in Same conditions. Never your name, notes, photos, when you ran, or anywhere more precise than a broad climate zone." OFF: "Off. Your runs won't count, even after you confirm your email." No confirm sheet.
- For information: the link opens /privacy until #totals is live. There's no Settings › Region (D-120).

**64 · Private**
- The five rewrites are confirmed, along with their tenses (won't / can't / don't).
- Confirmed ON reworded: "Shared and private runs add their temperature, kit and verdict to the guides and reports. Shared runs also count in Same conditions, which other runners see. Never your name, notes, photos, when you ran, or anywhere more precise than a broad climate zone."
- OFF confirmed: "Off. Your runs leave the guides at tonight's update. They leave Same conditions now, and it still works for you. Reports already published stay as they are."
- A3 private line for an opted-out runner: "Other runners won't see this run." only, with no Change.
- **Follow-up · unconfirmed runner (a).** Round 27's line stays: "Confirm your email to share. This run saves private." The switch is held at PRIVATE (D-50), and "Confirm your email" opens the confirm-email sheet. There's no totals sentence and no Change, because an unconfirmed runner's runs count nowhere yet (61d). Round 32 2a's note updated, with Settings › Privacy in place of Sharing.
- Amended: the closet tile tag [ONLY YOU] becomes [CHECKING] (spoken: "Being checked, other runners can't see this photo").
- U2's THE CONDITIONS POOL card and the SHARED/NEVER table are retired; the one switch lives on Privacy.

**60 · Rename race.** NOT RENAMED · "The handle changed to @{now} before the rename landed. Nothing was renamed. Look at it, then press Rename again if it still has to go." In D8's control band and on D1's flagged-handle row; the row stays open and its header re-reads to the new handle.

**62 · Lane C**
- (a) Under "Think we got it wrong? Reply to the email we sent you.", in the same quiet type: "Or write to desk@dialed.run." (mailto).
- (b) Under Today's three numbers, above Gave up: DIGEST NOT EMAILED (MONO.xs, hi-viz) · "Today's digest wasn't sent to @{handle}. Their email address, {masked}, isn't confirmed." One line per skipped operator, gone on the next UTC day the digest goes out.
- **Follow-up · 62b name (a, with the address).** {handle} is the operator's runner @handle, which is how the Desk names every account. There is no Desk name and none is added. The address follows, masked the way round 27 masks addresses (je•••@gmail.com), so the operator can tell which inbox to confirm. The sentence leads with the handle to avoid the possessive. There's no button: confirming happens in the operator's own Settings › Account.
- (c) Confirmed: the same band first in Au2's form region.
- (d) Nothing is cleared. A password refusal keeps Email and Password; "empty" was the Google return only.

**63 · Lane D2**
- (a) Confirmed: THEIR OTHER PHOTOS · {total}, newest kit first, at most 12, each at the row's photo height, opening its kit, with its id in mono under it. Past 12: "+ N MORE · OPEN @name IN RUNNERS" (D8). None: "No other photos from this runner."
- (b) Confirmed and drawn: "We removed a photo from one of your runs after a copyright notice. Your run and verdict stay." / "We removed one of your runs from the feed after a copyright notice. The run itself stays." No reason is quoted. A removal request's takedown keeps the moderator's reason.

**65 · E1 compact line.** Confirmed as built at the top of Following, above the posts. Widened: "…in the last 2 weeks." With no saved place, no fresh reading or fewer than five runners: no band and no gap. Following with no posts shows its empty state and no line.

## Round 39 · Built since round 38, and in review (items 66–76)
Board: `Round 39 Rulings.dc.html`.

**66 · Strava consent.** Lead-ins are run-in semibold at the paragraph's size, not mono labels. On P3, "So we can remind you. Optional." stays; "We read that a run happened. Nothing else." retires from P3. The refused receipt's Try again goes to T1 (or back to P3), with focus on the heading.

**67 · Weather credit.** All eight placements confirmed as built. A3's header keeps the credit at every width, including the desk. Entry card: foot right, 22px at 1200, #DEDDD6, opposite the verdict; drawn on the board. The card is wired only once it carries the credit.

**68 · Quarantine.** Words and the SEP 10 2026 date shape are confirmed. Recorded: live region "Reported to NCMEC. Kept until {date}.", KEPT UNTIL re-reads, and the form leaves the row; with no number the tag ends at the date. Empty: "Nothing is in quarantine." Review's foot order: Takedown, Copyright holds, Quarantine.

**73 · Copyright holds.** Counter-notice received takes RECEIVED ON (date, default today). Refusals: "Pick a date on or after it was hidden." / "Pick today or an earlier day." Both Case over presses confirm in place: "Delete it for good? It can't be put back." [Delete it] / "Put it back where it was?" [Put it back], each with Not yet. The owner approved "Case over: delete" and "Case over: restore", with these confirms.

**71 · Matching photos.** A separate grid under THEIR OTHER PHOTOS: MATCHING PHOTOS · ANY RUNNER · N. Under each: id; "{N} BITS" ("SAME" at 0) plus [PRIVATE] where it applies; the owner's @handle → D8. A garment tile opens nothing; its owner link is what it offers. The takedown form stays kit-only.

**69 · Mississippi and Tennessee.** The sentences and four places are confirmed. Added: on load, Au2 shows SIGN-UP CLOSED HERE + the NOT CREATED sentence in place of the form and Google, with Ask for access (→ Au5) and "Have an account? Log in". The refusals stay for a place that changes after load.

**70 · Removal reminder.** Confirmed. {UTC minute} renders as "OCT 26 14:20 UTC".

**74 · Bell notices.** No kicker; the heading-led paragraph is as built. The author's rows open their run or kit; the reporter's open nothing.

**75 · Rule line.** Confirmed as built.

**76 · D8 Which rule it breaks.** Under Why, PickOne, "—" start, "Pick the rule it breaks." The ten bold names verbatim, a hairline, then "Suspected CSAM (the notice names no rule)".

**72 · /open-source.** Confirmed: two typefaces; the shared small-group line is retired; "Licence" after Project · Notice; Third-party notices after the groups, with the preamble left out. (Round 40 #82: notices are no longer last; Tools we build with follows them.)

## Round 40 · Item 82 and five carried asks
Board: `Round 40 Rulings.dc.html`. In-place: Form Contract §02b samples (C5a). Amends Round 39 #72, Round 25 F desk ("no card before a category"), Round 27 Strava email first line.

**82 · /open-source · Tools we build with**
- (a) **Where.** The last section, after Third-party notices, and the last entry in the contents, with its count. The page reads: what ships, what its licences ask of us, then the tools.
- (b) **Words.** Heading "Tools we build with" ("Built with" collides with the page title "Built with thanks"). Count as a group's: MONO.sm, "44 · NOT SHIPPED". Line (TYPE.small, --quiet): "We build and test dialed.run with these. None of them ships in the app, so each is credited by name and licence." The lead's {N} keeps counting only what ships.
- (c) **Empty search.** "Nothing we ship or build with is called “xyz”." A tool match shows under its own heading, so it never reads as shipped.
- (d) **Tool row.** Nothing added. Name, version (MONO.sm, as shipped rows), Project; the licence id in MONO.xs in the copyright line's slot. No copyright, no licence text, no Notice. Three rows, then "Show all 44"; sorted by name.
- Noted, nothing to draw: 136 shipped, AGPL group gone, Tailwind and unenv joined, 5 own-licence rows.

**83 · dialed.run/open-source (marketing site)**
- (a) **Structure.** Approved as built: the site's legal reading layout (620 measure, sticky Contents at desk), type group, licence groups largest first, Tools we build with last. No search, no "Show all", no client script.
- (b) **Lead.** Kept: "This page covers the dialed.run website. The app keeps its own list, at app.dialed.run/open-source. The website runs on code and type that people chose to give away. Here are all {N} pieces it ships, grouped by licence, with a link to each project." The URL text is the link. {N} = 4 today.
- (c) **Type (corrected).** One row per family, as Google Fonts ships them: Archivo, Archivo Black, IBM Plex Mono. Archivo Black is its own project and holder, with its own link. Holder lines are the licence files' own: "© 2020 The Archivo Project Authors", "© 2017 The Archivo Black Project Authors", "© 2017 IBM Corp. with Reserved Font Name "Plex"". Count "3 · TYPE"; line "The typefaces you read everything in." The app's list follows: three rows, the same line (amends round 39 #72 "two typefaces").
- (d) **Tools line.** "We build and test the website with these. None of them ships in it, so each is credited by name and licence." "The website", as the lead names it.
- (e) **26 tools.** One list, every row; no disclosure. Revisit past about 60.
- (f) **Contents.** Counts, as the app's: MONO.sm, right-aligned (3 · 1 · 26).

**C1 · Item 39, Google delete.** Confirmed as described, with two corrections. Back from Google, the sheet reopens with no message and focus on "Delete my account"; it never deletes on return. Keep pressed after the purge has begun: §4a band NOT KEPT · "Your account is already being deleted. It can't be kept now." in Keep's place; Keep my account leaves, Log out stays. Both pages keep the signed-out panel and DELETION SCHEDULED.

**C2 · Item 39, emails.**
- Deletion: confirmed. The date is the UTC day the week ends, and the sheet and both DELETION SCHEDULED pages print the same UTC date.
- Invite foot reworded: "Sent because this address asked for access. Didn't ask? Ignore this; nothing happens."
- Strava disconnected: confirmed. "Strava says dialed.run was disconnected, so run reminders have stopped." Foot: "Runs you already added stay." Round 27's two openings and "Your runs here haven't changed." retire.
- Daily digest: confirmed. From hello@dialed.run; three sentences in one paragraph; the third number is Today's "bans this week".

**C3 · Item 36, content-removed email.** Not covered by 74–76 (bell rows). Round 27's frame is the text of record and replaces the round 26 build: "We removed the {photo} from your {Sat, Aug 29} run. Reason: {reason}. Your run and verdict stay." Button "See the community rules". Foot "Think we got it wrong? Reply to this email." Copyright removals use round 38 #63b's sentences, with no reason.

**C4 · Item 38, F's rail card.** Confirmed: "Already in your closet · Top", sentence case; empty "No tops yet." The "no card before a category" state is retired. Once TYPE lands: "Already in your closet · Top · Half-zip" when a type is picked (empty "No half-zips yet."); clearing the type returns to category alone.

**C5 · Contract errata.**
- (a) Form Contract §02b's two kicker samples are redrawn in MONO.xs (Plex Mono 10 / 0.10em, caps). The contracts agree.
- (b) The feed gutter is retired; no T1 role is added. Posts are divided by a 1px --hairline, full width, and each post keeps SPACE[4] top and bottom.

## Round 41 · Items 84–86
Board: `Round 41 Rulings.dc.html`. Amends round 27 #7 ("public" retired), round 33 (profiles signed-in only, D-58 scope), round 38 #61 (Privacy sub-page), round 31 default card ("one card for every URL").

**84 · Held on upload (D-147).**
- Source tag `[held on upload]`, replacing `[fingerprint]`: it names what we did, not the technique.
- Line (BODY, under the row's photo, before THEIR OTHER PHOTOS): "A close match to an image removed as intimate on {OCT 3}, {3 BITS} apart." At 0 bits: "The same image as one removed as intimate on {OCT 3}." Date and distance MONO.xs. "Copy" is dropped: a match within 8 bits is a likeness, and the operator decides.
- In MATCHING PHOTOS the removed original is an empty 1px --hairline frame reading REMOVED, with its id, "{N} BITS · REMOVED {date}" and owner. The image is never shown again.
- The uploader sees [CHECKING] (round 38) and nothing else.

**85 · Other sites (D-147).** Reworded: "If it's on other sites too, these free services can help stop it spreading: StopNCII.org if the person in it was 18 or over when it was taken, Take It Down if they were under 18. Each makes a fingerprint of the image on your own device; the image never leaves it." TYPE.small, --quiet, last in the body after a --hairline. On: the /takedown receipt, /takedown/confirm DONE, and W1's receipt after an intimate-image report (not under the reason while picking). Both names are links, new tab, with "(opens in a new tab)" in their accessible names.

**86 · Public pages.**
- (a) **Name: PUBLIC.** `world` = PUBLIC beside SHARED and PRIVATE, on the picker, the bracketed state label and Privacy. Picker (A3's share-toggle becomes a three-row radiogroup; D's Change opens it as a sheet): PRIVATE "Only you." · SHARED "Runners signed in to dialed.run." · PUBLIC "Anyone with the link, no sign-in. Never when or where you ran." While PUBLIC is picked, under the group: "Sites that already showed a preview of the link, like Reddit, iMessage or Slack, keep their own copy. Making it shared or private later can't take that back." D owner meta for a public kit: "Public: anyone with the link can see it." with Copy link (the /k URL) and Change. Unconfirmed runners stay held at PRIVATE. Strings that change: H empty "No public entries yet." → "No shared runs yet."; any legal "public" meaning signed-in → "shared with runners on dialed.run"; /privacy gains "What anyone can see" (for legal review). D-58's signed-out /feed/entry page is unchanged.
- (b) **Settings › Privacy** (the Sharing page since round 38 #61b). New group PUBLIC PROFILE · SAVES AS YOU SWITCH, between NEW RUNS and ANONYMOUS TOTALS. "Public profile", off: "Off. Anyone signed out who opens app.dialed.run/@{handle} sees nothing. Public runs still open from their own links." On: "Anyone can see your public runs at app.dialed.run/@{handle}. No sign-in." "Show my closet" (only while the profile is on; value kept while hidden): "Pieces in use, shoe mileage and retired pieces, on your public profile. Never notes or flags." With the profile off, NEW RUNS has no Public row; in its place: "Public is a choice here once your profile is public. You can still make any one run public." Turning the profile off while PUBLIC is the default moves it to SHARED, status "New runs now default to Shared."; runs already public stay public.
- (c) **/k/<id>.** Order: @handle · day (local date, never a time), photo if any, conditions + verdict chip (T2 hue), four stats (distance, moving, pace, gain), caption, THE KIT (linked pieces open the product in a new tab), "Weather data provided by Visual Crossing", the invite block, foot (Report this kit → /takedown with the link prefilled · Privacy · Terms). Invite block, not "Get your own Call" (a stranger doesn't know the word; sign-up is by invite): "Wear what worked." · "dialed.run keeps what you wore on each run and how it felt, then tells you what to wear when that weather comes round again." · Request an invite → dialed.run/invite · "Have a code? Join". Signed in: the top bar's Log in becomes "Open in the app" → /feed/entry/<id>, and the invite block leaves; filled client-side so the HTML is one cached page. No Useful, follow or comment on the page. Photo served re-encoded with no metadata. og:title "@{handle} · {38° damp}, {cold}". noindex.
- (d) **/@handle.** Handle (TYPE.display), Kits {N} (three rows, then "Show {N} more", a link, no script; empty "No public kits yet."), then Rotation if shown: IN USE · N (name, type), SHOES · N (name, mileage), RETIRED · N (--quiet + line-through). Desk: DS1 columns, kits a 3-up grid in the 620 primary, Rotation in the 300 rail. Foot: Report this profile · Privacy · Terms. Closet off: no Rotation section, no gap. Pieces never link to runs.
- (e) **Share card** for PUBLIC kits only: the default card's 600×315 at 2×, #0B0B0E, SPACE[8]. Top: wordmark left, MONO "@HANDLE · SAT OCT 18" right. Middle: "38° DAMP" (display) + verdict chip; MONO stats "6.2 MI · 52:10 · 8:25 /MI · 210 FT"; kit line, models without brands, "+N" past one line. Bottom right: the Visual Crossing credit (round 39 #67). Never the photo or caption. Re-rendered on any edit; once not public the image URL serves the default card. The public profile keeps the default card.
- (f) **Not public.** One page per path, identical bytes, status, headers and card for every reason (never public, made shared or private, removed, held, deleted, banned, never existed). MONO.xs "404" · "Nothing to see at this link" · /k: "A kit shows here only while the runner who logged it keeps it public." · /@: "A profile shows here only when its runner makes it public." (handle not echoed) · link "What is dialed.run?". Signed in: the top bar slot reads "Look in the app" → /feed/entry/<id> or /feed/u/<handle>, which run their own checks.

**87 · Garmin phase 1, G6–G10.** Amends 77 (G1 weight), 79 (G3), 81 (G5).
- G6 · **A3 effort.** Confirmed as built: "Did it work?" + run line, verdict chips, ANYTHING SPECIFIC?, --hairline, EFFORT, Share to feed, LOG IT. On every run. Unrated: shown, nothing picked, kicker EFFORT · OPTIONAL (the watch line takes that slot when rated); never required. Line under the chips, always: "You run warmer the harder you go. Next time, the Call allows for it." TYPE.small, --quiet. B1's figure line stays on the Call.
- G7 · **Credit weight.** 400, TYPE.small, --quiet. COLLAPSE: G1 credit 500 → 400.
- G8 · **Failed import tap.** §4a NOT IMPORTED · "Garmin didn't answer. Nothing was imported." · Try again (same tap), in the load-failure band's slot above the rows. Tapped row returns to idle; status region; focus unchanged.
- G9 · **Parsed card strip.** "PARSED · FROM GARMIN". No date, distance or time. REPLACE kept, returns to the import chooser.
- G10 · **Credit on D.** Confirmed: first line under the title, above the date/distance strip.
