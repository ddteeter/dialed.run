# Wave throughput — proposal

**Status:** draft for the owner's review, 2026-11-17. Nothing in it is
approved yet. The batches (§6) set the shape; each item is its own issue
and needs its own decision. It spans this repo (the coordinator skill,
`pr-ready`, CI workflows, the e2e scripts) and
`agentic-guardrails-scaffolding` (guardrails-core).

## Why

A lane takes about 16 hours from its brief to its merge, and about 7% of
that time goes to implementing. Most of the rest is spent waiting. This
review measured where the time went in waves 9–13, from wave 9's dispatch
(2026-11-13) to 2026-11-17, and ranks changes by how many lane-hours each
would save. Wave 13 was still shipping when it ended, so its figures are
partial. Waves 11–13 include security-fix lanes; this document counts their
time and ships like any other lane's and says nothing else about them.

### Where the figures come from

Each figure below is tagged with its source:

- **[reader]**: an estimate. One model reader per session read a
  condensed transcript and classified its hours and episodes. These are
  approximate. The ones the recommendations rest on were spot-checked,
  not recounted.
- **[count]**: counted by a script from session transcripts: ship
  attempts, gate blocks, background-job durations. These are exact as
  counts, but anything they say about which wait an idle stretch was is
  approximate.
- **[CI]**: GitHub Actions run and job timings from the API, covering
  1,000 workflow runs.
- **[code]**: read in the source: guardrails-core 0.14.0 as installed,
  or this repo. §3 lists these claims.

The savings in §4 are the review's own estimates, built on the figures
above. They overlap, so they must not be added together.

## 1 · Measurements

### Where 320 lane-hours went [reader]

Twenty lane sessions, brief to merge:

| share | hours | what                                                        |
| ----- | ----- | ----------------------------------------------------------- |
| 35%   | 111   | held by the coordinator, or waiting on another lane's merge |
| 16%   | 52    | waiting on CI                                               |
| 16%   | 52    | waiting on the gate lock, or in the push gate               |
| 12%   | 40    | local verification runs                                     |
| 7%    | 24    | implementing                                                |
| 5%    | 16    | waiting on the owner                                        |
| 4%    | 12    | fixing gate findings                                        |
| 4%    | 13    | reading, design, other                                      |

### Shipping

- The 20 PRs took 61 ship attempts. Three lanes shipped once. [count]
- 11 lanes were blocked at the push gate on their first ship, every time
  by Stryker survivors. 12 lanes had at least one red CI run. [count]
- Push to all checks green: median 63 min, 90th percentile 158. Without
  the Mutation workflow it would be a median of 33 and a 90th percentile
  of 92, because the Guardrails CI job runs the gate again, Stryker
  included (median 23 min, 90th percentile 87). Why that job is so slow
  has not been investigated yet. [CI]
- Seeded push gate: about 1.5–11 min. Cold: 22–27 min or more. [count]

### What the gates caught [reader]

- Real defects, 16 episodes: 10 by the local CI-style e2e (the a11y
  checker and the screen-reader transcripts), and one each by CI e2e,
  the bundle check, a Stryker dry run, a demo video, worker tests after
  a rebase, and a lane checking an owner answer against a D-row.
- Mutation: about 27 episodes where tests got meaningfully stronger, one
  real defect, and two or three false positives. What it costs is not
  the ratchet. Its first run is the push gate, often cold, behind a
  queue.
- The commit gate (lint, types, dupes, complexity) cost about 3 h in
  total. Most of that was stylistic reshaping, and six `dupes` findings
  led to real cleanups.

### CI on PRs and on main [CI]

- Every PR push that touches covered code runs all 38 Mutation shards, at
  about 15 min each when warm: about 600 runner-minutes.
- Each merge to main starts a cold Mutation run of about 2,500
  runner-minutes over 3.5–6 h. Of 41 such runs, 8 failed and 12 were
  cancelled.
- A survivor that reached main (`KitPicker.tsx:532`) turned three PRs red
  while nobody was watching main's run.
- Flake #826 (the closet journey) failed four CI runs on three PRs before
  #836 fixed it.

## 2 · Causes

1. **Serialisation between waves and between lanes** [reader]. Each
   pattern below cost hours, and none of them needed the work itself
   to wait:
   - a blanket push hold on a new wave until the previous wave merged:
     four wave-9 lanes, about 8 h;
   - lanes held behind an unmerged PR whose scope grew after the hold
     was set (a rename was added to it): three lanes, about 6 h;
   - a lane held for a migration number: about 12 h;
   - a dispatch held about 22 h, after which four built lanes waited
     about 7 h behind one PR.
2. **Append-only shared files** [reader]. `docs/design-deltas.md` appears
   in 16 of 20 lane timelines; `stryker.conf.json`,
   `test/email/rate-limit-kinds.test.ts` and `docs/launch/deployment-plan.md`
   recur too. Each merge makes the next PR conflict, and a conflict-only
   rebase pays a full gate and CI again, about 2 h.
3. **Cold push gates** [code, count]. The local mutation seed is thrown
   away when anything in the lockfile or in `stryker.conf.json` differs
   (§3), so a dependency bump or a ratchet entry anywhere makes every
   lane's next gate cold. Two coordinators reported that no seed landed
   during their whole wave [reader].
4. **One machine-wide lock** [code, reader]. Push gates, local Stryker,
   local e2e and full test runs all queue on `~/.guardrails-gate.lock`,
   for about 35 h of lock waits in total. `lockf` does not serve
   waiters in order, so one can starve: one lane's local e2e waited more
   than 3 h and never got the lock.
5. **CI** [CI]: every shard on every PR push, and a Guardrails job that
   runs the gate again (§1).
6. **Main's Mutation run** [CI]: it is cold, long and often red or
   cancelled, and nothing raises an alarm when it is red.
7. **Blocking owner questions** [reader]. A question that ends a turn
   waits until the owner next reads it, even when the lane has other
   ready work. One lane lost 7.5 h this way, and one coordinator's
   question held a wave's dispatch for 7 h.
8. **Flakes** [CI]. #826 was retried four times before it was fixed.
9. **The stop gate does not see lane worktrees** [code]. For a root
   session it checks `CLAUDE_PROJECT_DIR`, not the hook's cwd. And
   lanes often edit through Bash scripts, so the autofix hook on
   Edit/Write never fires for them [reader].

## 3 · What was verified in code, and what was not

guardrails-core 0.14.0, as installed:

| claim                                                                                                         | where                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| For a root session, the stop gate checks `CLAUDE_PROJECT_DIR`, not the hook's cwd                             | `dist/cli.mjs`, `sessionCwd`                                                                                                          |
| Seed fingerprint = the Stryker version + the whole Stryker config + the sha256 of the whole lockfile          | `dist/chunk-U36LBATM.mjs`, `checkoutFingerprint` and the "measured under another stryker version, stryker config or lockfile" message |
| The gate's changed files are `git diff --name-only --diff-filter=ACM <base.ref>`: two-dot, against local main | `dist/chunk-U36LBATM.mjs`                                                                                                             |
| The lock is `lockf -k -s -t <wait>`                                                                           | `dist/chunk-U36LBATM.mjs`                                                                                                             |
| The decision log holds only `stop` rows with no timing, so it cannot answer any question in this document     | `.guardrails/state/decisions.jsonl`, `decision-log.d.ts`                                                                              |

In this repo:

- `stryker.conf.json`'s reporters are `clear-text` and `progress` only,
  with no JSON report to read after a run.
- `pr-ready` step 8 tells a dispatched lane not to run Stryker over its
  changed files before shipping (owner, 2026-11-13). Lanes' own working
  notes say the opposite, and they act on them inconsistently.
- `.github/workflows/mutation.yml` skips mutation when a PR touches
  nothing it covers. Otherwise it runs every shard.
- The a11y coverage noise band is `FIGURE_NOISE = 0.4` in
  `e2e/support/a11y-coverage.ts`, already widened from 0.25 in #689 to
  cover main's measured spread of 0.31. The review's transcripts came
  partly from before that change.

**Not verified:**

- That the push gate scores Stryker timeouts as survivors. `pr-ready`
  and the lanes say it does, but the cache code treats `Timeout` as a
  kept status. Lanes spent about 1.5 h [reader] hardening loops they
  had not touched because of this belief. It has to be settled before
  anything is built on it.
- Whether starting a lane session inside its worktree changes which
  memory directory loads.
- Whether guardrails-core can run the Stryker analyzer at the `ci` rung
  only.

## 4 · Recommendations, ranked

Savings are lane-hours out of the 320 measured. They overlap and must not
be added together. Effort is agent time: S is under half a day, M is one
to two days, L is more. The review's overall estimate is brief-to-merge
falling from about 16 h to about 6–8 h.

| #   | change                                                                                                                                                                                | saving                                                   | effort · where                                                               | risk                                     | local CPU                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | **Hold pushes, not builds.** No blanket holds. No brief item that depends on an unmerged PR. Migration numbers reserved at dispatch. Tooling and dependency merges only between waves | 50–70 h                                                  | S · coordinator skill, brief template                                        | low–medium                               | fits: the held hours fell mostly where the lock was idle about two-thirds of the time |
| 2   | **A fragment file per lane** for design-deltas and the other append-only lists, assembled rather than appended                                                                        | 20–35 h                                                  | M (design-deltas, deployment-plan) · L (`stryker.conf.json`, the kinds test) | low                                      | frees 25–60 min of lock time per re-ship it avoids                                    |
| 3   | **Narrow the seed fingerprint** to what can change a verdict: the runtime-dependency digest `mutation.yml` already computes, plus the shard's own entry                               | 15–25 h                                                  | M · guardrails-core                                                          | low–medium                               | frees about 15 h of lock time                                                         |
| 4   | **Alert on a red main Mutation run.** Don't fail a PR for a survivor already on main in a file the PR doesn't touch. Cap shard time                                                   | 15–25 h                                                  | S (alert, cap) · M–L (baseline rule) · CI workflows                          | low                                      | none                                                                                  |
| 5   | **Run only the affected Mutation shards on a PR**                                                                                                                                     | 15–20 h                                                  | M · CI workflow                                                              | medium                                   | none                                                                                  |
| 6   | **Lock:** a fair queue, local e2e on its own lock, queue position shown to the waiter                                                                                                 | 5–10 h for the e2e split; the fair queue ends starvation | S (e2e) · M (queue) · guardrails-core, lane scripts                          | medium for e2e beside Stryker            | Stryker uses all 4 performance cores: measure before letting e2e run beside it        |
| 7   | **No blocking owner question while ready work is queued.** Take the stated default, keep going, and leave the question to be answered later                                           | 10–15 h                                                  | S · skill text                                                               | low                                      | none                                                                                  |
| 8   | **Run mutation before the first ship**, over exactly the gate's scope                                                                                                                 | 8–12 h                                                   | S · `pr-ready`, one script                                                   | none to quality                          | net negative until #3 lands (3–8 h more lock time)                                    |
| 9   | **Reuse the gate pass on a conflict-only rebase**, and diff from the merge-base rather than local main                                                                                | 8–12 h                                                   | M · guardrails-core                                                          | medium                                   | frees lock time                                                                       |
| 10  | **`ship` reports on the first failed required check**, and refuses to ship a branch that is behind or conflicting                                                                     | 8–10 h                                                   | S–M · guardrails-core                                                        | none                                     | none                                                                                  |
| 11  | **Main's cold Mutation run nightly** or after dependency changes, not on every merge                                                                                                  | 8–12 h                                                   | S · CI workflow                                                              | medium–high                              | none                                                                                  |
| 12  | **Fix a flake the second time it hits a PR**, with the coverage band set from main's measured spread                                                                                  | 8–10 h                                                   | S                                                                            | low                                      | none                                                                                  |
| 13  | **One `preship` script that matches CI's e2e:** both servers, a fresh D1, coverage on the final head                                                                                  | 4–6 h                                                    | S–M · `package.json`, e2e support                                            | none                                     | neutral                                                                               |
| 14  | **Stryker JSON reporter**                                                                                                                                                             | 1.5–2 h                                                  | S · one line in `stryker.conf.json`                                          | none, but one cold cycle unless #3 is in | none                                                                                  |
| 15  | **The stop gate checks the lane's worktree**                                                                                                                                          | 1–2 h                                                    | S · guardrails-core                                                          | low                                      | small                                                                                 |
| 16  | **A machine-wide gate and ship log**, with a `stats` command                                                                                                                          | enables every later decision                             | M · guardrails-core                                                          | none                                     | none                                                                                  |

Notes on the items:

- **#1** is the largest saving and costs only skill text. A lane can
  build, test and record its demo while a dependency is still open. Only
  its push has to wait. What changes is that a hold is set on a push for
  a named reason, never on a whole lane by default.
- **#2** is the same fix in four places. Where a shared file is a list
  that every lane appends to, each lane writes its own file and a
  generator or a glob reads them all.
- **#3 and #9** both change what makes a gate cold or makes it re-run.
  #3 matters most: today an unrelated dependency bump, or a ratchet entry
  in another module, makes every lane's next gate cold.
- **#4 and #5** both rely on main's run as the backstop. Do them both,
  and leave #11, which takes that backstop away.
- **#8** reverses a ruling from 2026-11-13. It only pays off once seeds
  survive (#3), and it is a trade-off, so it is an owner question.
- **#12:** the coverage band is already set from main's spread (§3), so
  what remains is the flake rule.
- **#16** has to land before batch D. The existing decision log cannot
  answer any of this document's questions.

The log should write one row per gate or ship run, to a file outside any
checkout:

- lock: time queued, time held, the holder when the waiter arrived, and
  the queue depth;
- Stryker: seeded or cold and why, dry-run time, mutant count, mutant-phase
  time, timeouts and survivors;
- ship: gate, push and CI times, and the final state;
- machine: load average and free memory at the start and the end, core
  count, and the concurrency setting.

Dry-run time plotted against queue depth shows whether the machine can
afford more concurrency.

**Keep as they are:** the 100% mutation ratchet, the local e2e (it caught
10 of the 16 real defects) and the commit-gate rules.

## 5 · Local capacity [reader]

The development machine has 4 performance cores, 6 efficiency cores and
24 GB of memory, and Stryker runs at `concurrency: 4`
(`stryker.conf.json`). Over the 93-hour window, counting every session
on the machine:

- about 105 job-hours went through the gate lock, counting queue time
  and run time;
- the lock was held 57% of the time: 60–77% in the busiest part of each
  day and 33% in the quietest;
- a second job was waiting 31% of the time, and three or more jobs were
  in the system 16% of the time.

These are interval counts read from transcripts. They include time in the
queue, and a chained command counts once, under one class. Actual CPU and
memory pressure were not measured. One sample taken during wave 14 showed
a load average of about 10 with five jobs queued on the lock. #16's
machine columns are there to replace these estimates.

## 6 · Batches

Batches are timed by wave boundaries. Nothing that changes gates, CI or
`stryker.conf.json` lands while lanes are shipping, because doing that
is one of the causes in §2.

| batch                       | when                                                             | items                                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A · rules                   | now, in effect from wave 15's dispatch                           | #1, #7, #12's flake rule: edits to `.claude/skills/coordinating-a-wave/SKILL.md` and the brief template. Can share this proposal's PR |
| B · repo tooling            | the gap after wave 14 merges                                     | #2 for design-deltas and deployment-plan, #4's alert and shard cap, #14, #13. Each forbidden-zone edit gets its own grant request     |
| C · guardrails-core release | start now in that repo, adopt in the first gap after it is ready | #16, #3, #10, #9's merge-base diff, #15, and #6's fair queue (pending the owner's decision)                                           |
| D · decide with data        | after two waves have run with batch C's log                      | #5, #6's e2e lock split, #8, #9's gate reuse, #11, and running mutation at the CI rung only                                           |

Batches B and C belong to a dedicated tooling session, not to wave lanes.

### Numbers to track per wave

| number                        | waves 9–13 |
| ----------------------------- | ---------- |
| brief-to-merge hours per lane | 16         |
| ships per PR                  | 3          |
| first-ship pass rate          | 3 of 20    |
| push-to-green median          | 63 min     |

Until #16 lands, these come from the same transcript and CI reading as §1.

## 7 · Experiment on wave 14

> **Placeholder: results pending.** This section is filled in once
> wave 14 has merged.

Started 2026-11-17, with the owner's go-ahead. Its job is to test #1, #7
and part of #8 before any of them goes into the skill:

1. The wave-14 push hold was lifted for 14b, 14c and 14a. They ship one
   at a time in that order, and each starts once the one before it has
   pushed. 14d stays held behind two security-fix lanes, because its code
   depends on theirs. Wave 13 keeps priority if it has to re-ship.
2. Each lane runs its remaining pre-ship checks as one script under one
   lock acquisition. A lane that has not yet mutated its changed files
   leaves that to the ship's gate.
3. Every ship attempt and every heavy local run gets a row in a ship log
   kept for the experiment.
4. Wave 14's coordinator does not end a turn on a blocking owner question
   (#7).

**Starting state:** all four wave-14 branches merged cleanly with main,
with both open wave-13 branches and with each other (`git merge-tree`).
#836 (14b's flake fix) had already merged.

**Baseline:** wave 13. It had four built lanes, about 7 h idle before the
first push, and three ships per PR.

**Questions to answer:**

| question                                                           | answer |
| ------------------------------------------------------------------ | ------ |
| How long from "built" to merged for 14b, 14c and 14a?              | _tbd_  |
| Did lifting the hold cause re-ships? If so, which file conflicted? | _tbd_  |
| Did it slow wave 13's remaining gates?                             | _tbd_  |
| Did any lock wait exceed about 60 min?                             | _tbd_  |
| Were the gates seeded or cold, and why?                            | _tbd_  |
| Does load explain gate time for gates of similar size?             | _tbd_  |

**The test:** the hold lift worked if the three lanes merge without extra
re-ships and wave 13's remaining gates are not visibly slower. A re-ship
caused by a later merge is evidence for #2, not against #1. A lock wait
over an hour is the starvation in §2.4, and argues for doing #6's fair
queue first. Four lanes are too few to conclude anything about
pre-ship mutation (#8). The results only record who ran it before
shipping and how their first ship went.

**Result:** _tbd_

## 8 · Open questions for the owner

- Move #6's fair lock queue into batch C. Recommended, because of the
  starvation in §2.4.
- One grant for each forbidden-zone edit in batch B.
- The trade-offs in batch D, once the log has data: #5, #8, #11, and
  mutation at the CI rung only.
- Whether the push gate scores Stryker timeouts as survivors (§3). It
  should be settled before lanes harden any more code around the belief.
