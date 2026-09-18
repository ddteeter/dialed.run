# Epic 200 — Travel & Home (parked with the Call tab)

> Decision, September 2026: the Trip surface and the permanent-move flow ship with
> Epic 200, alongside the Call tab. Nothing in v1 needs to change for them. This note
> records the shape so v1 doesn't accidentally close a door.

## The premise

A verdict is stored against the **conditions of the run**, never the place. A
Minneapolis runner's 40°/damp verdicts are valid in Portland at 40°/damp. Travel does
not need a second model — it needs the Call asked about a different forecast, and the
closet filtered by what's being packed. There is **no new data object**. A Trip is a
saved query: destination + date range.

## What travel changes

1. **Forecast source.** The Call gains a location + date override. Nothing else in
   the Call changes.
2. **Coverage becomes the headline.** A winter runner in Denver in July hits hairline
   (unknown) bands. The Call must say *why*: "You've logged 0 runs above 72°." The
   O5 low-confidence state already exists; travel just reaches it more often.
3. **Cohort is the fallback, labelled as borrowed.** When the runner's own bands are
   empty, the destination's climate cohort fills in — the primary signal, not the
   tiebreaker, and marked as not theirs.
4. **Trip — the one new surface.** Destination + dates → forecast range → the Call
   per day → a de-duplicated packing list from *their* closet, weighted to pieces
   rated dialed in those bands. Unknown bands surface as "Nothing rated for 80°+.
   The cohort wears singlets; you own two." This is the Call and coverage combined.
   Reached from the Call tab, because it *is* the Call with a different question.
5. **Logging while travelling changes nothing.** Runs get their actual conditions and
   flow into the same bands. Travel *fills* coverage. On return, say so:
   "Three new bands covered."

## Moving permanently

Same data, different default.

- **Home** is one field in Settings. Auto-prompt after N consecutive runs logged far
  from stored home: "Looks like you're running in Portland now. Make it home?"
- **Climate band** (O3's sort key, the closet nudge) is recomputed from the new home.
  It only orders things, so flipping it is harmless.
- **Verdicts and ranges are never archived or reset.** The old bands stay valid and
  get used less. A Denver runner still visits Minneapolis at Christmas.
- **Say the cost plainly.** Coverage will look hollow in the bands that now matter.
  The move flow states that rather than letting the Call quietly degrade.

## v1 must not

- Store verdicts keyed to a location.
- Treat `home` as anything other than a default for forecast + local social proof.
- Reset or partition closet data on a home change.

## Design owed in Epic 200

- Trip surface (destination, dates, per-day Call, packing list).
- Location/date override on the Call.
- Home field + auto-prompt in Settings.
- "Bands covered" return moment.
- The Call tab's own glyph.
