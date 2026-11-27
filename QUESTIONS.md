# Questions from sprint lane A1 (the Call's scorer)

Each is something the sources do not settle. The scorer builds the stated
default as one named constant or function, with a test named for it, so an
answer changes one place. Design: `docs/designs/sprint-a1-call-scorer.md`.

**The owner answered Q1 to Q18 on 2026-11-26** (issue #1103, "Owner's
call"). Changed and now built: Q3, Q5, Q13, Q14. Settled: Q6, Q11, Q18.
Stands as built, as `scorer-1`: Q1, Q2, Q4, Q7, Q10, Q12, Q15, Q17, and Q16
as a contract change after the sprint. Parked with the cohort cells table's
design: Q8, Q9. Q19 and Q20 are new, raised by building the answers.

## Q1: Is the Call's "condition class" the precipitation class?

- What: design 194 keys the cohort by "feels-like band × condition class".
  The only condition classifier in `lib/contracts` is `PrecipClass`
  (dry / damp / wet). Wind, UV and altitude (board C1) are not in it.
- Cost: a wider class means a new classifier in `lib/contracts`, new columns
  on the cells table, and thinner cells.
- Recommend: keep `PrecipClass` for the first version.
- Meanwhile: `CallScope.precip` is a `PrecipClass`; wind is not read.

## Q2: Is the "feels-like band" the 5 °C band?

- What: the coverage ladder counts in 5 °C `bandFloorC` bands; the consensus
  block uses ±3 °C around the viewer. The scorer needs one.
- Cost: none now; the cells table's key follows the answer.
- Recommend: the 5 °C band, so the Call and the ladder a runner sees agree.
- Meanwhile: `bandFloorC` of the forecast's feel, and of each run's judged feel.

## Q3: Are runs with typed weather left out of the runner's own counts?

- Answered (owner, 2026-11-26): no. Typed-weather runs count toward the
  runner's own Call. They stay out of the cohort, consensus and published
  totals.
- Built: the scorer counts every run in the history, whatever its source.
  The cohort side is the rollup's to enforce: the scorer only reads cells,
  and a test pins that nothing of a runner's history reaches a cohort
  figure.

## Q4: Does the thermal offset shift only the estimate fit?

- What: the runner's thermal level could shift the feel against estimate
  ranges, or also move which band their history is read from.
- Cost: none.
- Recommend: estimates only. A runner's own verdicts already say how the
  hour felt to them.
- Meanwhile: `effectiveFeelC` = feel − level × `THERMAL_LEVEL_C`, used in
  the prior and nowhere else.

## Q5: What does effort do to a Call?

- Answered (owner, 2026-11-26): a starting table. The hour feels warmer by
  easy 0 °C, steady +2 °C, workout +5 °C, race +7 °C; no effort counts as
  easy. The Call's effort shifts the feel used for its band and for
  estimate fit, and each past run's judged feel is shifted by its own
  effort, so runs and the Call are compared on the same footing.
- Built: `EFFORT_WARMTH_C` and `feelAtEffortC` in `scorer/effort.ts`. See
  Q19 for what this does to the band a fact names.

## Q6: What decides confidence, and where is the probable/confident cut?

- Answered (owner, 2026-11-26): as built, the cut at 6 runs in band.
- What: the ladder is `below-threshold` under `CALL_VERDICT_THRESHOLD`
  verdicts, `borrowed` with no run in this band and class, then
  `probable`, then `confident`. Since Q3's answer `best-guess` is never
  answered: a runner over the threshold always has runs of their own.
- Cost: the words sit on the screen (O5, C1b, C0a).
- Recommend: the cut at 6 runs in band: twice the personal prior strength.
  The board's "11 RUNS IN BAND" is an example.
- Meanwhile: `CONFIDENT_RUNS_IN_BAND = 6`. Below the threshold the scorer
  still ranks, so the teaser can show the cohort's line.

## Q7: Which groups does a kit fill?

- What: one piece a group at most. Tops, bottoms and shoes whenever the
  closet has one. Outer, hands/head and socks/extras only on evidence.
- Cost: none.
- Recommend: as built: the runner's own runs decide when they settle it
  (with runs both ways, wearing one was dialed more often; with runs one
  way only, that way was mostly dialed); otherwise most of the cohort's
  runners wearing one decides.
- Meanwhile: `wearsGroup` in `scorer/kit.ts`. No kit-wide range is summed
  (#377).

## Q8: Should cohort cells be per garment type, not per group?

- What: design 194 says per garment group. Board C1b's "DENVER COHORT · 91%
  AT 84°" beside "Singlet" is finer than a group can say: a group cell
  cannot tell a singlet from a long-sleeve.
- Cost: per-type cells are several times as many and thinner against the
  5-runner floor.
- Recommend: decide in the cells table's design; start per group.
- Meanwhile: the cell is per group, so two pieces of one group get the
  same cohort pull and the same `cohort-share` fact.

## Q9: How is a runner's climate zone assigned?

- What: nothing decides it (a climate classification, a metro area, a grid
  cell around home).
- Cost: a product call, and likely a column on the profile.
- Recommend: decide with the cells table.
- Meanwhile: the scorer matches `climateZone` by equality and reads nothing
  into it.

## Q10: Are the shrinkage formula and its constants acceptable as a start?

- What: three layers, each pulled toward the one before it by
  `(successes + anchor × strength) / (trials + strength)`: the estimate
  prior (0.7 in range, −0.05 per °C outside, floor 0.1, 0.5 with no
  estimate), the cohort's dialed share (weight capped at 8 verdicts, prior
  strength 4), the runner's own record (strength 3).
- Cost: none; all are exported constants in `scorer/shrinkage.ts`.
- Recommend: accept as version `scorer-1` and let the replay harness tune.
- Meanwhile: as above.

## Q11: Does the verdict threshold count typed-weather verdicts?

- Answered (owner, 2026-11-26): settled by Q3. The threshold and the
  evidence count the same runs, and both agree with the teaser's ladder.
- Built: the threshold reads `history.length`, and so does everything else.

## Q12: What is a Call with no forecast?

- What: the contract says the scorer then "answers from the runner's bands
  alone". There is no band to count in, borrow for or be confident about.
- Cost: none.
- Recommend: as built.
- Meanwhile: every counted run is read, whatever its band; no cohort cell
  and no estimate is read; `personalRunsInBand` is 0; confidence is
  `probable` at best; each piece's facts name the band they are from.

## Q13: Should a verdict's direction count?

- Answered (owner, 2026-11-26): yes, as the band's lean. The feel used
  against estimates shifts by (warm − cold) / (runs in band + 3) ×
  `THERMAL_LEVEL_C`; positive means the runner ran warm, so the Call
  dresses lighter.
- Built: `bandLeanC`, `LEAN_PRIOR_STRENGTH` and `LEAN_STEP_C` in
  `scorer/shrinkage.ts`. A piece's own score still reads "dialed or not".

## Q14: Does the 5-runner floor apply to a cell's group runners too?

- Answered (owner, 2026-11-26): yes. No cohort figure, verdict share or
  `cohort-share` fact comes from fewer than 5 distinct runners who wore the
  group, as well as fewer than 5 in the band and class (D-108). The rollup
  withholds it and the scorer re-checks.
- Built: `cellsAboveFloor` needs both. A rung whose cell is thin on either
  count is backed off, like a rung with no cell.

## Q15: What does a per-item flag count for?

- What: a flag is the only thing a runner says about one piece.
- Cost: none.
- Recommend: as built, then tune in replay.
- Meanwhile: in a piece's score a flag of either kind is one more failed
  wear. In the kit rule a "too much" flag on a group's piece makes that run
  not dialed for wearing one, whatever the run's verdict.

## Q16: Should the contract carry result-level evidence?

- What: `EvidenceFact`'s `personal-band` is about the band, not a piece,
  and `CallResult` has nowhere for it but each piece's `evidence`.
- Cost: a contract change, after the sprint.
- Recommend: add `CallResult.evidence` for band-level facts.
- Meanwhile: every piece of a Call that has a band carries the band's fact,
  zeros included.

## Q17: How are ties in the ranking broken?

- What: the ranking is a total order: score, then `pieceId`. Ids compare in
  English collation (`localeCompare(…, "en")`), pinned so the order does not
  move with a machine's locale; for ULIDs it is their code-unit order.
- Cost: none.
- Recommend: as built.
- Meanwhile: as above. A replay export that renames ids changes tie order
  only.

## Q18: The shared skeleton needs one more registration, in `eslint/table-owners.ts`

- Answered (owner, 2026-11-26): `"call"` in `AREAS` is part of the shared
  skeleton, identical in all three Call lanes.
- Built: one line after `"auth",`, in a commit of its own on this branch.

## Q19: Which band does a fact name once effort shifts it?

- What: with Q5's answer, a run is counted in the band of its feel at its
  effort, and the Call's band is the band of the hour at the Call's effort.
  So a fact's `bandFloorC`, and `CallResult.bandFloorC`, name that shifted
  band: a workout on a 41 °F morning is counted, and reported, one band
  warmer than the weather the runner saw. The cohort's cells are looked up
  in the shifted band too, so the rollup has to count each run on the same
  footing or the lookup reads the wrong cell.
- Cost: wording for the evidence lines (A2), and a rule for the rollup.
- Recommend: the rollup shifts each run with the scorer's own
  `feelAtEffortC`, and the evidence lines say the band is the feel at this
  effort; if the screen should show the weather's band instead, the
  contract carries both.
- Meanwhile: every band the scorer reads or reports is the band at effort.

## Q20: Does the works-at range (#386) follow these answers?

- What: `workedRange` is a range to show beside the weather, not an input
  to the Call.
- Cost: none; it is not wired into the closet.
- Recommend: as built.
- Meanwhile: it counts typed-weather runs (Q3), and uses each run's own
  judged feel, not shifted for effort (Q5).

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

- Answered (owner, 2026-11-26): approved as v1; the strings stay marked as guesses.

- What: every `guess` and `said` entry in `evidence/words.ts`: plurals ("once", "3 times", "1 run", "more verdict"), the flag, band-runs, cohort and works-at lines, the "skip the X" sentence, the probable, borrowed and best-guess bodies, and the spoken forms of drawn lines.
- Cost: owner time, one read of one file.
- Recommend: approve or reword in one pass; the test lists them, so a change is one edit.
- Meanwhile: the guesses ship in the view model, marked.

## Q2: "Why not the X?" answers

- Answered (owner, 2026-11-26): the answers and their order stand.

- What: the board draws only the question. The branch answers, in this order: the runner's own "too much" on the asked piece ("You told us the vest was too much twice in this band."); for a left-out group, "Nothing in your verdicts says you need the vest at this hour."; else the chosen piece's record against the asked one's ("The half-zip is dialed 8 of 9 in this band. The tee, 2 of 5."), or "The half-zip ranked higher for this hour." when the chosen piece has no record here.
- Cost: owner time.
- Recommend: keep the order; reword freely.
- Meanwhile: as above.

## Q3: Which pieces are offered a "why not"

- Answered (owner, 2026-11-26): a why-not in every group, as built.

- What: in every group, the best-ranked piece the kit did not choose: the runner-up of each chosen group, and the best piece of each group the kit left out (the board's vest). A piece with no name or no answer is not offered.
- Cost: none beyond the reading.
- Recommend: this rule; the owner may want only left-out groups (fewer, closer to "not a menu").
- Meanwhile: this rule.

## Q4: How a cohort line names its source

- Answered (owner, 2026-11-26): `CLIMATE COHORT` / `ALL RUNNERS` with the band, as built.

- What: the board draws "DENVER COHORT" and "CLIMATE COHORT"; the contract's `climateZone` is an opaque id, so a place name is not available. Zone rungs show `CLIMATE COHORT`, the `everyone` rung `ALL RUNNERS`. The board also draws a temperature ("78% AT 58°") where the contract carries a band, so the band takes its place.
- Cost: naming zones on screen needs a zone-to-place table, a contract change.
- Recommend: keep these until trips (C1) need the place name.
- Meanwhile: `CLIMATE COHORT` / `ALL RUNNERS`, with the band.

## Q5: B2's "RUNNERS YOU FOLLOW · SAME CONDITIONS" block

- Answered (owner, 2026-11-26): the followed-runners block is wired from `feed` later.

- What: it is the feed's consensus, not the Call's cohort, and lives in `feed` (a design 261 zone).
- Cost: a feed change in a later lane.
- Recommend: wire it from `feed` beside the view model when B2 is built (#457).
- Meanwhile: not in the view model.

## Q6: #401's receipt sentence ("We'll stop suggesting gloves above 40°")

- Answered (owner, 2026-11-26): dropped: no receipt sentence, ever.

- What: it needs a fact saying the Call changed a threshold because of a flag; `EvidenceFact` has none, and the wiring is in `feed/noted.ts` (a 261 zone).
- Cost: a contract change (a new fact kind) and a feed change.
- Recommend: return to it with the scorer's wiring.
- Meanwhile: no template.

## Q7: Kicker words with no fact behind them

- Answered (owner, 2026-11-26): no kicker words in v1.

- What: "EASY TO SHED", "CHEAP INSURANCE, EASY TO SHED" and "UV, NOT WARMTH" give a reason no `EvidenceFact` carries. No fact kind was invented.
- Cost: a contract change if wanted.
- Recommend: leave them out of v1 of the Call.
- Meanwhile: such a piece shows its strongest counted fact, else `NO VERDICTS YET`.

## Q8: The below-threshold count needs the runner's verdict total

- Answered (owner, 2026-11-26): `verdictsSoFar` goes on `CallResult`, landing once in the scorer's PR; `b2View`'s option switches to the contract field at rebase.

- What: C0b's "7 more verdicts" is `CALL_VERDICT_THRESHOLD` minus all the runner's verdicts; `CallResult` carries only `personalRunsInBand`.
- Cost: a contract field (`verdictsSoFar` on `CallResult`), or the route passes it.
- Recommend: the route passes it, as this branch's `b2View(result, { unit, names, verdictsSoFar })` takes it.
- Meanwhile: an option on `b2View`.

## Q9: Strength order of a piece's line

- Answered (owner, 2026-11-26): the strength order stands.

- What: personal-piece, then personal-flag, then personal-band, then cohort-share, then estimate; the first of a kind in the scorer's order on a tie.
- Cost: none.
- Recommend: this order.
- Meanwhile: this order.

## Q10: The paragraph's reach

- Answered (owner, 2026-11-26, amended the same day): a warm line, "You've been too warm {times} in this band." (a guess), shown only when warm runs outnumber cold ones and the kit is lighter than what was worn on them (a group dropped, or a piece swapped for one whose range starts warmer); too warm in a kit with nothing to shed says nothing. The cold line stays as built; a tie stays cold.
- Contract addition proposed, to land with `verdictsSoFar` in the scorer's PR: what was worn on the band's too-warm runs, `{ bandFloorC: number; worn: readonly { pieceId: string; group: UiGroup; estimate?: TempRange }[] }` (`WarmRunsWorn` in `evidence/warm-runs.ts` until then). Nothing passes it yet, so the warm line never shows.

- What: only cold runs ("too cold twice"), no "too warm" mirror; the board's "the half-zip fixes it" needs a fact naming the piece that fixes it, and its "at 41° last week" needs a date and temperature the contract does not carry. Prose reads only facts in the hour's own band.
- Cost: contract fields if wanted.
- Recommend: add a warm mirror in the owner round if wanted (one template).
- Meanwhile: cold only; "in this band" in place of a date.

# Questions from sprint lane A3 (the replay harness)

The guesses this branch proceeded on. All eight are answered (issue #1105);
each entry keeps the question as asked. Design doc: `docs/designs/sprint-a3-call-replay.md`.

## Q1: Which measures are the release bar, and at what tolerance?

- **Answered** (owner, 2026-11-26: all three measures gate, coverage included, each at tolerance 0; built.)

- What: design 194 says a new scorer "must not do worse". `noWorse` holds a
  candidate to dialed agreement and direction on misses together, each on
  its own, at tolerance 0: better on one and worse on the other fails.
  Coverage is reported beside them but does not gate.
- Cost: owner time only. Gating coverage too stops a scorer that "improves"
  by answering `below-threshold` on the hard cases; it also blocks a
  scorer that deliberately raises its threshold.
- Recommend: gate all three, tolerance 0, until real logged Calls exist;
  revisit a tolerance once the log has enough verdicts for noise to matter.
- Meanwhile: `RELEASE_METRICS` is the two kit measures; a measure either
  side could not judge (no cases) is `unmeasured` and fails.

## Q2: The pseudonymised export's shape (needs the call-log tables)

- **Answered** (owner, 2026-11-26: a requirement on the call-log design (inputs by reference with a version stamp per row read; edited cases reported apart, deleted cases dropped); in the design doc, no code.)

- What: the export follows the call log, a hard stop (schema and a new D1
  binding). `ReplayCase` is a `CallRequest` plus `worn` and `verdict`, so an
  export row maps onto it if the log keeps: the full request as served
  (hour, effort, conditions, runner's thermal level and zone, the history
  run ids read, the closet with the estimates used, and the cohort cells
  read, by generation), the engine version, the ranking, the kit, and the
  linked verdict with the pieces actually worn and their flags.
- Cost: schema (call log), one D1 binding, the legal text on the log and
  its retention (design 194 §Contract touches), owner time.
- Recommend: log the request's inputs by reference (run ids, cohort
  generation) rather than by copy, and rebuild them in the export, so the
  log stays small and the 90-day ranking retention is the only big row.
- Meanwhile: the seeded personas stand in; `casesFrom` rebuilds requests
  from a runner's runs.

## Q3: Replaying v1's history is not replaying logged Calls

- **Answered** (owner, 2026-11-26: v1 history is the gate until logged Calls have verdicts; the report's `source` field says which ran; built.)

- What: the seeded cases (and any replay over v1's real verdicts) are runs
  from before a Call was served. They ask "would the scorer have picked
  what a dialed runner wore", not "did the served Call do better than the
  last version's". The two can disagree: a runner who follows the Call
  wears the kit it chose.
- Cost: owner time.
- Recommend: use v1-history replay as the release check until the log has
  verdicts on served Calls, then gate on logged Calls and keep v1 history
  as a second report.
- Meanwhile: the harness takes either; the report does not say which.

## Q4: Manual-weather runs are left out of replay entirely

- **Answered** (owner, 2026-11-26 (reversing A1's reading, #1103): manual-weather runs stay in history but are never cases; built as `isCaseRun`.)

- What: `isReplayable` drops a run with `source: 'manual'` both as a case
  and from every case's history, following A1's reading (manual weather is
  excluded from counted aggregates).
- Cost: owner time.
- Recommend: keep it; a typed feel is not a forecast to test against.
- Meanwhile: one named filter, so the ruling is a one-line change.

## Q5: The forecast rebuilt for a historic run

- **Answered** (owner, 2026-11-26: keep the rebuilt forecast; a candidate declaring `tempC` or `windKph` reads is blocked on rebuilt cases alone; built, the wiring PR supplies the declaration.)

- What: a stored run keeps its judged feel and precipitation class only.
  The rebuilt forecast uses the judged feel as both `tempC` and
  `feelsLikeC`, wind 0, and a millimetre figure inside the class (dry 0,
  damp 1, wet 5).
- Cost: none now; a scorer that reads `tempC` or wind would be replayed on
  conditions it never sees in production.
- Recommend: keep it for v1 history; the export carries the served
  forecast, so this goes away for logged Calls.
- Meanwhile: as above, pinned by a test.

## Q6: Climate zone names

- **Answered** (owner, 2026-11-26: parked with the cohort cells table; `Cfb` stays synthetic only.)

- What: `CohortCell.climateZone` is a string and nothing in the repo names
  zones yet. The personas use Köppen codes, `Cfb` (home).
- Cost: owner time; the rollup (a hard stop) will fix the vocabulary.
- Recommend: Köppen codes, resolved from the runner's region.
- Meanwhile: `Cfb` in the synthetic data only.

## Q7: The contract has no runtime list of `Confidence`

- **Answered** (owner, 2026-11-26: approved; lands once in the scorer's PR (#1103), replay switches at rebase and keeps its record until then.)

- What: `call/contract` is types only, so replay keeps its own ranking of
  the five confidences (a `Record<Confidence, number>`, so the compiler
  fails if the union changes).
- Cost: a change to the frozen shared contract, after the sprint.
- Recommend: export `CONFIDENCES` as a const tuple from `call/contract`
  and derive the type from it.
- Meanwhile: the record in `replay/metrics.ts`.

## Q8: The cohort snapshot and leakage

- **Answered** (owner, 2026-11-26: a requirement on the rollup and call-log designs (keep each generation, log which one a Call read); in the design doc, no code.)

- What: a case's cohort is one snapshot for every case, so v1-history
  replay lets the cohort layer see later runs (its own runner's included).
- Cost: owner time; the fix needs the rollup's generations (a hard stop).
- Recommend: the export carries the generation each Call read.
- Meanwhile: the synthetic cohorts are random cells, not rolled up from
  the runs, so they carry no leaked signal.

## Coordinator note

The `eslint/table-owners.ts` line (`"call",` after `"auth",` in `AREAS`) is
its own commit, byte-identical to lane A1's, as the coordinator asked and
the owner approved in this session (2026-11-26).
