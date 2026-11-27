# Questions from sprint lane A2 (the Call's evidence)

Product questions for one owner round. The design doc is
`docs/designs/sprint-a2-call-evidence.md`; every guessed string is in
`src/modules/call/evidence/words.ts`, marked `guess`, and listed by
`test/call/evidence/words.test.ts`.

## Q0: The skeleton failed `table-owners.node.test.ts` (resolved)

- What: `test/eslint/table-owners.node.test.ts` requires every folder under `src/modules/` in `AREAS` in `eslint/table-owners.ts`, so the shared skeleton broke the pre-push `npm test` on every A branch.
- Resolved: the owner approved (2026-11-26) the one line `"call",` after `"auth",`, byte-identical to A1's, committed on its own as `chore: name the call module in the table-owner map's areas`.
- Recommend: add this test to the skeleton's checklist for future sprints.

## Q0b: The words table's fallow `ignore` line (resolved)

- What: `src/modules/call/evidence/words-data.ts` is the strings table alone (`{ origin, text }` rows), split from `fill` as `closet/tap-list-data.ts` is; in semantic mode a run of rows reads as a clone, so `dupes` blocked the commit.
- Resolved: the owner approved (2026-11-26) one entry in `.fallowrc.jsonc`'s `duplicates.ignore`, committed on its own.

## Q1: The wording this branch guessed

- What: every `guess` and `said` entry in `evidence/words.ts`: plurals ("once", "3 times", "1 run", "more verdict"), the flag, band-runs, cohort and works-at lines, the "skip the X" sentence, the probable, borrowed and best-guess bodies, and the spoken forms of drawn lines.
- Cost: owner time, one read of one file.
- Recommend: approve or reword in one pass; the test lists them, so a change is one edit.
- Meanwhile: the guesses ship in the view model, marked.

## Q2: "Why not the X?" answers

- What: the board draws only the question. The branch answers, in this order: the runner's own "too much" on the asked piece ("You told us the vest was too much twice in this band."); for a left-out group, "Nothing in your verdicts says you need the vest at this hour."; else the chosen piece's record against the asked one's ("The half-zip is dialed 8 of 9 in this band. The tee, 2 of 5."), or "The half-zip ranked higher for this hour." when the chosen piece has no record here.
- Cost: owner time.
- Recommend: keep the order; reword freely.
- Meanwhile: as above.

## Q3: Which pieces are offered a "why not"

- What: in every group, the best-ranked piece the kit did not choose: the runner-up of each chosen group, and the best piece of each group the kit left out (the board's vest). A piece with no name or no answer is not offered.
- Cost: none beyond the reading.
- Recommend: this rule; the owner may want only left-out groups (fewer, closer to "not a menu").
- Meanwhile: this rule.

## Q4: How a cohort line names its source

- What: the board draws "DENVER COHORT" and "CLIMATE COHORT"; the contract's `climateZone` is an opaque id, so a place name is not available. Zone rungs show `CLIMATE COHORT`, the `everyone` rung `ALL RUNNERS`. The board also draws a temperature ("78% AT 58°") where the contract carries a band, so the band takes its place.
- Cost: naming zones on screen needs a zone-to-place table, a contract change.
- Recommend: keep these until trips (C1) need the place name.
- Meanwhile: `CLIMATE COHORT` / `ALL RUNNERS`, with the band.

## Q5: B2's "RUNNERS YOU FOLLOW · SAME CONDITIONS" block

- What: it is the feed's consensus, not the Call's cohort, and lives in `feed` (a design 261 zone).
- Cost: a feed change in a later lane.
- Recommend: wire it from `feed` beside the view model when B2 is built (#457).
- Meanwhile: not in the view model.

## Q6: #401's receipt sentence ("We'll stop suggesting gloves above 40°")

- What: it needs a fact saying the Call changed a threshold because of a flag; `EvidenceFact` has none, and the wiring is in `feed/noted.ts` (a 261 zone).
- Cost: a contract change (a new fact kind) and a feed change.
- Recommend: return to it with the scorer's wiring.
- Meanwhile: no template.

## Q7: Kicker words with no fact behind them

- What: "EASY TO SHED", "CHEAP INSURANCE, EASY TO SHED" and "UV, NOT WARMTH" give a reason no `EvidenceFact` carries. No fact kind was invented.
- Cost: a contract change if wanted.
- Recommend: leave them out of v1 of the Call.
- Meanwhile: such a piece shows its strongest counted fact, else `NO VERDICTS YET`.

## Q8: The below-threshold count needs the runner's verdict total

- What: C0b's "7 more verdicts" is `CALL_VERDICT_THRESHOLD` minus all the runner's verdicts; `CallResult` carries only `personalRunsInBand`.
- Cost: a contract field (`verdictsSoFar` on `CallResult`), or the route passes it.
- Recommend: the route passes it, as this branch's `b2View(result, { unit, names, verdictsSoFar })` takes it.
- Meanwhile: an option on `b2View`.

## Q9: Strength order of a piece's line

- What: personal-piece, then personal-flag, then personal-band, then cohort-share, then estimate; the first of a kind in the scorer's order on a tie.
- Cost: none.
- Recommend: this order.
- Meanwhile: this order.

## Q10: The paragraph's reach

- What: only cold runs ("too cold twice"), no "too warm" mirror; the board's "the half-zip fixes it" needs a fact naming the piece that fixes it, and its "at 41° last week" needs a date and temperature the contract does not carry. Prose reads only facts in the hour's own band.
- Cost: contract fields if wanted.
- Recommend: add a warm mirror in the owner round if wanted (one template).
- Meanwhile: cold only; "in this band" in place of a date.
