# Design: sprint-a4 the Call's engine, integrated

> Sprint lane A4 of Epic 200 (#1102). The coordinator numbers this doc before
> any PR. It stacks lanes A1 (scorer, #1103), A2 (evidence, #1104) and A3
> (replay, #1105) into one linear history, cut into four reviewable chunks.

## Problem

Three lanes built the Call's pure core on separate branches against one
frozen contract. The owner's answers to their questions approved three
changes to that contract, and nothing yet runs the scorer through the
evidence lines or the replay harness. This lane makes the changes once, puts
the three parts on one branch, and wires them together. Nothing ships to a
screen.

## Approach

One branch from `origin/main`, four chunks, each ending at a commit whose
`test/call/` suite passes:

1. **The scorer and the contract.** A1's commits as they are, then the
   contract changes in `call/contract/types.ts`, the only edits the shared
   contract gets (owner, 2026-11-26):
   - `CONFIDENCES`, a const tuple, narrowest knowledge first; `Confidence`
     is derived from it (#1105 Q7).
   - `CallResult.verdictsSoFar`: every verdict the runner has, the count the
     threshold reads (#1104 Q8).
   - `WarmRunsWorn` and `CallResult.warmRuns`: each piece worn on the too-warm
     runs in the Call's band and class, once, with its group and the closet's
     estimate; absent with no forecast (#1104 Q10, as amended). The scorer
     fills it in `scorer/warm-runs.ts` from the runs it already counted.
2. **Evidence.** A2's commits less the shared skeleton and `AREAS` commits,
   then one commit: `b2View` takes `{ unit, names }` and reads
   `verdictsSoFar` and `warmRuns` from the result; its local `WarmRunsWorn`
   goes.
3. **Replay.** A3's commits less the same two, then one commit: `byRank`
   reads `CONFIDENCES`' order in place of its own record.
4. **The wiring.**
   - `scorer/reads.ts`: `SCORER_READS`, the forecast fields `score` reads.
     The scorer takes its forecast through a type picked from that list, so
     an undeclared read does not compile, and a test proves it at runtime.
   - `replay/release.ts`: `releaseCheck`, the steps `eval/call/run.ts` did by
     hand (replay both, measure, probe the candidate's reads, `noWorse`, the
     report), so the guard is tested code.
   - `eval/call/run.ts` runs `score` with `SCORER_READS` as the candidate.
   - Tests under `test/call/wiring/` feed the real scorer into replay and
     into `b2View`.

Sub-modules import only `call/contract`; tests and the eval compose them
through their doors. The parent door stays `export {};`.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**. New bindings/queues/crons: **none**
- Screens implemented: **none**
- `call/contract`: the three changes above. `stryker.conf.json`, `AREAS` and
  A2's `.fallowrc.jsonc` line land once each, as the lanes wrote them.

## Test plan

All vitest `worker`; no Playwright (no screen, no server hop).

- `test/call/contract/confidences.test.ts`: the tuple pinned, and the
  scorer's ladder climbing in its order.
- `test/call/scorer/warm-runs.test.ts`, and `score.test.ts` for
  `verdictsSoFar` and `warmRuns` on the result, with and without a forecast.
- `test/call/scorer/reads.test.ts`: each declared field observed, each
  undeclared one changing no result.
- `test/call/replay/release.test.ts`: `releaseCheck` on fake scorers.
- `test/call/wiring/replay.test.ts`: the real scorer through the release
  check; an undeclared read and a `tempC` declaration both blocked.
- `test/call/wiring/evidence.test.ts`: a persona per confidence the scorer
  answers, and the lines a runner would read.

## Issues

- Closes: none (the sprint's issues are the coordinator's). Opens: none from
  a cloud lane; this lane's questions are the A4 section of `QUESTIONS.md`.

## Cut points

The last commit of each chunk, where the four pull requests are cut. Filled
in when the stack is built.

## Replay report

`scorer-1` over the seeded personas. Filled in when the wiring runs.

## Open questions

None yet; anything the stack raises goes in `QUESTIONS.md` under A4.
