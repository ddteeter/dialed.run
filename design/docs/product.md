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
- Kicker in Archivo Black, uppercase, 11px: `NOTHING SAVED`.
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
- **Google button.** Google's light/dark spec taken whole (#FFFFFF/#747775/#1F1F1F; #131314/#8E918F/#E3E3E3; Roboto Medium; official G), pill, 48 high, "Continue with Google". `data-part="google-button"` is the sole palette/icon exemption.
- **Privacy policy.** /privacy, 680 measure, 17/1.65, sticky contents column at the desk, plain list on the phone. Linked from the signed-out footer, under Au2 ("Creating an account means you've read our Privacy policy."), Settings › About, and email footers. Not under Au1.
- **Field focus.** On FormField the ring sits on the border (outline 2px ink, offset −1px). Error = 2px ink border + band; error+focus looks the same plus the band, and the band is the discriminator.
- **Rulings.** Swatch only when the shade is exact (§AH 08 amended). The stranger flag is dropped from D. JPG/PNG/WebP. STILL MARKED. Round 21–23 placeholders confirmed. Dates: "SAT AUG 29" / "Sat, Aug 29". K threshold 15 ("Log 15 verdicts and the Call starts.", 15-cell meter). Breached password copy confirmed, failing open. Counts in digits. Password "At least 10 characters." G: settings icon button in the header in every state.
- **Notification email (19).** In v1 only the Strava run reminder can be emailed. It's on by default, sent 20 min after landing, skipped if the run was uploaded or the push opened, and limited to one a day (the next day's email counts any extra runs). Subject "New run on Strava. Add it here." Body "A run landed on Strava at {time}. Upload its file, then add what you wore." Button "Add it". Footer: "You get this because Strava is connected." · Stop run reminder emails · Email settings · Privacy policy. Sends List-Unsubscribe with one-click. Settings › Notifications has per-kind Push/Email switches: Run reminders (push, email); Useful (push; email "IN THE APP ONLY"); Account and security (email "ALWAYS SENT", no switch). Unsubscribe landing: a signed link that never expires, no log-in, no confirm. "Run reminder emails are off" · Turn them back on.
- **Invite-only (20).** Au2 invite stage: INVITE CODE is the first field, above email and Google (both need it); /join?code= prefills it. Used: "That code has already been used. Ask whoever sent it for another." Invalid or revoked: "That code doesn't work. Check it against the email or message it came in." Au5 Request access (email plus an optional 280-character note) → the receipt "You're on the list", identical for new, repeat and existing addresses. Invite email "Your dialed.run invite" · Create your account. Desk D7 Access: Requests (oldest first; Send invite = single-use code + email; Decline is silent) and Codes (DIAL-XXXX with no 0/O/1/I; label, uses limit, used-by @handles, Copy link, Revoke with 10 s undo; a code is consumed at account creation). At public launch one flag removes the field and the request link.
- **Strava button (21).** Strava's official orange "Connect with Strava" asset, 48 tall, unaltered, on both themes, on T1 and the onboarding Strava step, left-aligned, wrapped in our link; our brackets show beside it while in flight. Disconnect stays our pill. `data-part="strava-button"` is exempt. No "Powered by Strava" mark (we show no Strava data).
- **Icons + OG (22).** "[d]" on an ink tile: favicon.svg, .ico 16/32 (16 = brackets only), apple-touch 180, manifest 192/512 plus 512 maskable, theme_color #0B0B0E. OG 1200×630 for a shared entry: wordmark, date, conditions display, verdict chip, distance/feels/wind, kit, @handle. Never the photo, note, route or flags. og:title "@handle · {temp} {precip}, {verdict}". Private, deleted, banned or queued entries get the default card and the title "dialed.run".
