# Design: 194 the Call's infrastructure

> A planning record, written ahead of Epic 200 (`docs/post-mvp.md`). The epic
> is not scheduled and this doc ships no code. It records the owner's answers
> from a grilling session on 2026-11-10 and the infrastructure chosen from a
> survey of Cloudflare and outside options. Prices were read from each
> provider's public pricing page on 2026-11-10; re-check them when the epic
> opens.

## Problem

`docs/decisions.md` leaves "the call's model design" open, and that choice
decides what the Call runs on. The Call will be the product's main feature
after launch, so the engine's shape, its data rules and its running cost
should be settled before packets are written.

## Decisions (owner, 2026-11-10)

| topic             | decision                                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine            | A deterministic TypeScript scorer: counting and shrinkage over verdict rows. A trained model only once replay shows counting has plateaued.                 |
| LLM               | None in the Call's serving path. B2's evidence lines and "why not the X" are templates over counted facts.                                                  |
| Freshness         | A runner's own verdicts change their next Call. The cohort layer may lag by up to a day.                                                                    |
| Delivery          | Pull only: a Call is computed when the Call tab or B1 opens. No push, no precompute.                                                                        |
| Cohort data       | The D-108 rule: private runs count, counted fields only, 5+ distinct runners per cell, confirmed accounts, opt-out honoured, manual weather excluded.       |
| Cohort shape      | A backoff ladder per feels-like band × condition class × garment group: climate zone + thermal level, then climate zone, then everyone.                     |
| Call log          | Every served Call is stored with its conditions, candidate ranking, engine version and chosen kit, and linked to the verdict that follows.                  |
| Retention         | The candidate ranking is kept 90 days. A summary row stays while the account exists and is deleted with it.                                                 |
| Signal            | What v1 collects: the run verdict, per-item flags, `effort`, `thermal_level`. No per-garment magnitude (#400). Heart rate stays out, as `post-mvp.md` says. |
| Vision capture    | Async through a queue, capped per runner, never blocking a save. Suggestions are editable; the runner's entries are the floor.                              |
| Bulk import       | Tagged extremes only: the runner names a few memorable runs and what they wore. No bulk weather backfill.                                                   |
| Trips             | A trip's forecast is fetched on view from a cache shared by place. No daily refresh job.                                                                    |
| Engine releases   | A new scorer version is replayed over logged Calls that have verdicts, must not do worse, then ships through the normal deploy.                             |
| Replay and tuning | Offline, from a pseudonymised export, running the same TypeScript the Worker runs.                                                                          |
| Vendors           | Cloudflare first; outside only where Cloudflare has no fit (forecast data, a vision model if the eval says so).                                             |

## Approach

The whole epic was priced at 1,000 active runners and checked at 10,000, at
about one Call per runner per day.

- **Scorer**: a pure function in a new `src/modules/call/`, called from the
  route loader. Personal history is read live; the cohort is read from a
  cells table.
- **Cohort rollup**: a nightly cron, one SQL aggregate over `run_conditions`
  (D-175) into the cells table. It aggregates in SQL because D1 caps a result
  at 50 MB, and it writes a new generation and then switches to it, so a
  re-run is harmless (law 1).
- **Call log**: its own D1 database. A D1 export blocks the database while it
  runs and a database caps at 10 GB, so the log is kept apart from core. A
  Call is linked to its verdict in code, and the log write never fails a Call
  (laws 5 and 8c).
- **Forecast**: Visual Crossing behind `WeatherProvider.forecast()`, cached
  by rounded place for a few hours in the weather database. Verdicts were
  recorded against its feels-like values, so the forecast uses the same
  source. On an outage the Call serves the last cached forecast, then the
  archived spec's `NO FORECAST` path.
- **Vision**: a queue consumer shaped like enrichment. The model is chosen by
  the eval D-08 requires.

**Verified on 2026-11-10**: six test requests each returned `queryCost: 1`,
including a full 15-day forecast with 360 hourly rows. A date past the
15-day horizon returns one statistical day with no hourly rows, so a trip
day that far out needs its hour estimated from the daily range.

| line                                          | 1,000 runners       | 10,000 runners      |
| --------------------------------------------- | ------------------- | ------------------- |
| Scorer, rollup, call log, cache (D1, Workers) | inside Workers Paid | inside Workers Paid |
| Forecast, at $0.0001 per record               | about $3 a month    | about $30 a month   |
| Vision, steady state                          | under $3 a month    | under $15 a month   |

**Considered and not chosen**: a Workflow for the rollup, KV for the forecast
cache and R2 for log detail (more bindings for no gain at this size); a
second forecast provider (MET Norway stops at about nine days; Open-Meteo's
free tier bars commercial use); a decision model (Cloudflare's Clef,
TypeSafe's Jev) as the kit picker, because it returns a probability with no
rationale and B2 needs counted evidence.

## Contract touches

Nothing changes now. When the epic opens, each of these is a hard stop:

- Schema: the cohort cells table, the call-log tables, kits (D-09), trips.
- New bindings: one D1 database for the call log; a Workers AI binding if a
  Cloudflare-hosted vision model wins the eval; a vision queue.
- New cron: the nightly cohort rollup.
- Legal texts: the cohort counting private runs, the call log and its
  retention, and the vision model's provider.
- Screens: B1/B2, O2, O4, the Call tab (#457).

## Test plan

None; no code ships. For the epic: the scorer and the rollup are vitest
`worker` tests under the mutation ratchet, the 5-runner floor gets a test
that pins it to the consensus module's constant, and the replay harness is
the release check for every scorer version.

## Issues

- Closes: none.
- Opens: none yet. Informs #457, #401, #399, #386, #377 and #400. #377's
  pointer is stale: the thermal tables are in `src/lib/contracts/thermal.ts`.

## Open questions

- **The vision eval's candidates.** Proposed: Clef-flash on Workers AI
  (typed choices with a probability per option, so a field is filled only
  above a threshold), `gpt-5.6-luna` through the existing adapter, and
  Claude Haiku 5.5. Workers AI documents no guaranteed JSON mode for its
  other vision models.
- **The vision cap's numbers** wait for the eval's cost per photo.
- **Whether a decision model can re-rank the scorer's shortlist** is a
  replay experiment once the log has verdicts, not a launch dependency.
- **Design number**: 194 follows the wave-5 allocation as this session
  understood it; renumber if a lane holds it.
