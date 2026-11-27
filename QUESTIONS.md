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
