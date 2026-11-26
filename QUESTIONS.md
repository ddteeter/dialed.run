# Questions from sprint lane A1 (the Call's scorer)

Each is something the sources do not settle. The scorer builds the stated
default as one named constant or function, with a test named for it, so an
answer changes one place. Design: `docs/designs/sprint-a1-call-scorer.md`.

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

- What: CLAUDE.md keeps manual weather out of consensus, published totals
  and "(later) training". The scorer's counting is read as that training.
- Cost: a runner who types their weather gets a thinner Call.
- Recommend: keep them out; a typed band is too coarse to count beside
  measured ones.
- Meanwhile: `countedRuns` drops `source: "manual"`. One function, one test.

## Q4: Does the thermal offset shift only the estimate fit?

- What: the runner's thermal level could shift the feel against estimate
  ranges, or also move which band their history is read from.
- Cost: none.
- Recommend: estimates only. A runner's own verdicts already say how the
  hour felt to them.
- Meanwhile: `effectiveFeelC` = feel − level × `THERMAL_LEVEL_C`, used in
  the prior and nowhere else.

## Q5: What does effort do to a Call?

- What: board B1 says "you run 8° warmer in a workout". That is design
  copy; nobody has ruled on a number per effort.
- Cost: an offset per effort is a product call, and a column the cohort
  cells may want.
- Recommend: the owner picks the offsets, or the replay harness fits them
  once the call log has verdicts.
- Meanwhile: `effort` is accepted and not read; a test pins that.

## Q6: What decides confidence, and where is the probable/confident cut?

- What: the ladder is `below-threshold` under `CALL_VERDICT_THRESHOLD`
  verdicts, `best-guess` with no counted run at all, `borrowed` with none
  in this band and class, then `probable`, then `confident`.
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

- What: the teaser's ladder counts every verdict toward 15, typed weather
  included. The scorer's evidence leaves those runs out (Q3).
- Cost: if the two counted differently, the teaser could say "0 more
  verdicts" while the Call still said below threshold.
- Recommend: count every verdict toward the threshold, as the teaser does.
- Meanwhile: the threshold reads `history.length`. A runner whose verdicts
  are all on typed weather is over it with nothing counted: `best-guess`.

## Q12: What is a Call with no forecast?

- What: the contract says the scorer then "answers from the runner's bands
  alone". There is no band to count in, borrow for or be confident about.
- Cost: none.
- Recommend: as built.
- Meanwhile: every counted run is read, whatever its band; no cohort cell
  and no estimate is read; `personalRunsInBand` is 0; confidence is
  `probable` at best; each piece's facts name the band they are from.

## Q13: Should a verdict's direction count?

- What: the scorer reads "dialed or not". A runner who was cold four times
  in a tee is no likelier to be offered something warmer than something
  lighter, until they have worn it.
- Cost: a learned shift needs a number for what one cold verdict is worth
  in °C, which nobody has ruled on (the same gap as Q5).
- Recommend: shift the feel used against estimates by the band's lean,
  (warm − cold) / (runs + a strength), times a step; tune it in replay.
- Meanwhile: direction is unread in the score. The band's cold, dialed and
  warm counts are still in every piece's evidence.

## Q14: Does the 5-runner floor apply to a cell's group runners too?

- What: the scorer drops a cell whose `bandRunners` is under 5. A cell can
  pass with `groupRunners` of 1 or 2, and its verdicts are then those few
  runners' runs. D-108 says 5+ distinct runners per figure.
- Cost: if yes, the rollup or the scorer withholds a group's verdicts, and
  perhaps its share, under 5 group runners.
- Recommend: the rollup zeroes a group's verdicts under 5 group runners, and
  the scorer repeats the check.
- Meanwhile: the floor is on `bandRunners` only, as the lane was briefed.

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
