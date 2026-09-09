# Design: 027 modules mutation paydown

## Problem

`src/lib` is at 100% mutation score and held there by `break: 100`.
`src/modules` is at **43.98%** — 1,793 mutants that survive or are never
covered at all. That is the number that decides whether the guardrails
commit-gate analyzer can ever be turned on: it scopes to every changed
TypeScript file, so switching it on today blocks the next commit touching a
module with a hundred findings it did not cause (D-40).

The debt also grows with every PR. Paying it down module by module, with a
ratchet behind each one, is what stops that.

## Approach

**One module per PR, worst first, each ending with the module inside the
ratchet.** This PR is `modules/weather` (121 of the 1,793).

The ratchet is `stryker.conf.json`'s `mutate` array. A glob is only added
once that scope is at 100%, and `break: 100` then fails CI the moment
anything drops it. `.github/workflows/mutation.yml` **reads that array**
and runs one shard per entry — there is no second list to keep in step, and
the shards keep wall-clock flat as the array grows.

```
stryker.conf.json  "mutate": [ "src/lib/**/*.ts", "src/modules/weather/**/*.ts" ]
                                    |                     |
   .github/workflows/mutation.yml   +---- one CI shard ---+   (fromJSON, matrix)
```

Three source changes came out of the survivors rather than the tests:

- `attachObservation` **returns its outcome** instead of `void`. Three of
  the six outcomes are degradations (law 5), and a caller that cannot tell
  `attached` from `pending` cannot report one. The strings were unkillable
  because nothing could observe them.
- `isResolved(status)` replaces the `=== "attached" || === "manual"` check
  written out twice (derive, don't mirror).
- `observationsForRuns` drops location-less runs with a `flatMap` instead
  of a type-guard `filter`, which is what makes the drop observable:
  `cacheKeyFor` *rounds*, so a null coordinate keys to `0,0` rather than
  throwing. Skipping the check hands a run the weather at Null Island.

Four mutants are genuinely equivalent and carry a `// Stryker disable`
with the proof at the site: two unreachable guards that exist for the
compiler, and two early returns whose only effect is saving a query.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Screens implemented: **none** — no user-visible change, so no demo video
- Human-managed files touched: `stryker.conf.json`,
  `.github/workflows/mutation.yml` (the ratchet itself)

## Test plan

Unit/integration, all in `test/weather/`:

- attach: run-not-found, already-resolved via `manual`, indoor-only,
  latitude-only and longitude-only runs, provider failure → `pending`,
  cached-manual → `manual`, and the warn each degradation emits
- attach: hour *N* gets hour *N*'s temperature (not just its bucket), and
  only the starting hour carries the run id
- retry cron: exact `{claimed, attached, failed}`, the five-hour boundary
  at the second, and the exhaustion warning firing only when it should
- store: `fetched_at` in seconds not milliseconds; a manual row's sentinels
- read: refusals for each half-located run, with an observation planted at
  exactly the half-key a dropped check would produce
- provider: the URL it builds (`unitGroup=metric` above all), the abort
  signal, and the message of every failure mode

## Open questions

- The glob is `**/*.ts`, so `components/WeatherAttribution.tsx` is outside
  the ratchet. `src/ui` and every module component are in the same
  position. Worth its own decision once the `.ts` debt is gone — noted as
  a register item rather than guessed at here.
- `src/modules/*/functions.ts` (375 uncovered mutants) **cannot** be
  mutation tested: importing one in the workers pool fails on
  `Missing "#tanstack-router-entry" specifier`. The plan is to move their
  input schemas and their few branches into testable siblings and leave
  the TanStack shell outside the ratchet. That decision lands with the
  first module that has one — weather has none.
