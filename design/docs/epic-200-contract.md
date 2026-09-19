# Epic 200 — the contract between v1 and the Call epic

> The seam. v1 lanes and epic lanes ship in any order because the epic only
> READS v1 data and WRITES its own. If a change here needs a v1 migration, it is
> not epic work — raise it.

## Files

- **Epic owns:** `Call Epic.dc.html`, `docs/epic-200-*.md`, the `call`, `trip`,
  `home`, `pack` glyphs in `icons.js`.
- **Epic never edits:** `V1 Screens`, `Product Screens`, `Onboarding`,
  `Remaining Screens`, `Operator Screens`, `Form Contract`, `Motion Doctrine`.
  Stubs in those files point here; they are the only permitted touch.

## Reads (v1 tables, read-only)

- `verdicts` — kind, conditions (temp, feels-like, humidity, wind, precip), garment set, timestamp. **Never keyed to a place.**
- `bands` / coverage — derived per temp band × condition class.
- `wardrobe_items`, `products` — the closet and its canonical products.
- `runners.home` — one place. v1 stores it; the epic reads it and may prompt to change it (C3a) through the same Settings write v1 already exposes.
- `cohort` — the climate-cohort model, queried by **destination**, not by the runner's home.

## Writes (epic-owned)

- `trips(id, runner_id, place, start_date, end_date)` — the whole object. Deleting a trip deletes nothing else.
- `forecast_cache(place, date, payload, fetched_at, kind)` — per place-day, TTL-bound, never stored on a trip. `kind` is `hourly` (≤15 days), `statistical` (beyond), or `none` (fetch failed).
- `kits` — a saved Call answer (B2 / C0a "Save as kit"). References `wardrobe_items` by id; does not copy them.
- `usual_start_time` — derived, not stored: median start of the runner's last 20 logged runs, rounded to 15 min. Falls back to "now" when fewer than 5 runs exist. Every Call and every Trip day carries an explicit hour; the runner only sees a picker when they want a different one.
- `home_prompt_dismissals(runner_id, place, until)` — "Just visiting" for 90 days.

## Behaviour the epic guarantees

- **A Call is for an hour, never a day.** Forecast, cohort lookup and coverage band all resolve against a specific start time. Default is `usual_start_time`; `now` under five runs. A Call rendered without a resolved hour is a bug.
- A Call for another place uses **that place's** cohort and **the runner's own** bands. When the target band is uncovered, the disclosure is *borrowed*, not *best guess* (C1b).
- The Trip packing list draws only from the closet. A gap names a category and the destination cohort's choice; brand mentions come from brands already in the runner's closet. **No prices, links, or affiliate anything.**
- Changing `home` recomputes: Call default place, feed local-tab ordering, O3 climate sort. It never touches verdicts, bands, ranges, or coverage.
- Coverage ink (solid / hatch / hairline) is reused for forecast confidence on the day strip. Teal outline on the bar appears only in the return moment (C2b); hi-viz outline only after a move (C3c). Neither persists.

## Tab bar

v1 keeps `verdictPending` in mute ink for the Call tab. The epic's first visible
commit swaps it for `call` and replaces the K teaser body with C0b — same
header, different body. Nothing else in the tab bar changes.

## Attribution (Visual Crossing requirement)

Every card showing a forecast or conditions reading ends with a linked
`WEATHER · VISUAL CROSSING` line (→ https://www.visualcrossing.com/), on the same
screen as the data. Settings/About mentions do not satisfy this on their own.
Applies to: A1 conditions, Q manual entry, C0a/C0b, C1b, C2 day strip, O5, B1.

## Thresholds (tweakable, not decided)

- Home prompt: 6 consecutive runs > 150 km from home.
- Forecast horizon: Visual Crossing returns hourly forecast to 15 days and a statistical day (range, from decades of history, no hourly row) for any date beyond. There is **no maximum range out**. Past 15 days the hour is estimated from the climate diurnal curve and the Call hedges. Trips are re-fetched daily; days flip statistical→hourly as they enter the window, and the runner is told if the packing list changed.
- Forecast fetch failure never blocks a Call. The day renders hairline; the Call uses the runner's bands plus the destination cohort's seasonal norm and labels the reading line `NO FORECAST`.
- "Just visiting" silence: 90 days per place.
