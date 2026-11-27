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
