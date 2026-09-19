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
  check state, no success toast on a form that navigates.

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

## 7. The primitive

`src/ui/FormField.tsx` ships the whole contract: `useFormSubmit`, `FormField`,
`FormStatus`, `FormErrorSummary`, `FormFailureBand`, `SubmitButton`. A form that
uses them cannot get this wrong; a form that hand-rolls any of them is a review
failure. Rendered spec: `Form Contract.dc.html`.
