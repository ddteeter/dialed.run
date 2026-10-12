# Agent wait cost — plan

**Status:** approved by the owner 2026-10-12, with `pr-ship` built as `guardrails ship`. Steps 1–2 are done (global CLAUDE.md); steps 4, 5, 5b and the ship command are in progress on guardrails `feat/agent-wait-cost`. Spans three places: the global
`~/.claude/CLAUDE.md`, this repo (CLAUDE.md + lane dispatch), and
`agentic-guardrails-scaffolding`.

## Why

Measured from the transcripts of the 2026-10-09 17:00 → 2026-10-12 18:00 window
(≈75% of a weekly limit). Weighting is API-price-proportional (input 1, 5m cache
write 1.25, cache read 0.1, output 5), a proxy for the unpublished quota formula.

| finding | evidence |
|---|---|
| Subagents cache for 5 min, root sessions for 1 h | `cache_creation.ephemeral_5m` vs `ephemeral_1h` in the transcripts; after a 6–55 min gap, subagents missed 148/148 and root sessions hit 106/106 |
| Waiting cost ≈ 27% of the week | 119 wakes on the gate lock / push log + 39 on `gh pr checks`, each rewriting a 300–540k context |
| Worst single agent: lane A, 16% of the week | woke every ~10 min (590 s foreground `until kill -0` loop) from 20:45 to 06:00 behind `~/.dialed-gate.lock` |
| One wake per wait is available today | probe: a subagent that backgrounded a 400 s job and ended its turn was woken once; cost = one rewrite (61.6k written, 0 read) |
| Context size is the other lever | calls over 400k context = 42% of the week; one root session (`ncii-policy`, 3 days, 779k peak) = 25% |
| CLAUDE.md asks for the polling | workflow expectation 7: "watch the checks (`gh pr checks <n> --watch`) … before ending your turn" |

A wake costs ~1.25 × context once the cache has expired, however long the wait
was. So the target is **zero wakes on success, one small wake on failure** — not
faster or slower polling.

Not proposed: `subagentPromptCacheTtl: 1h`. It makes every subagent cache write
2× instead of 1.25×, including the short-lived Explore and fixer agents that
never idle; after step 1 almost no wait relies on a warm cache anyway.

## Steps

Each step is independently shippable and verifiable.

### 1. Global CLAUDE.md: the waiting rule

**Builds:** a "Waiting on slow work" section in `~/.claude/CLAUDE.md`:

- Anything that can take more than ~2 minutes (push, CI, stryker, a build, a
  dev server, another agent) is started with `run_in_background` and the turn
  ends. The harness wakes you once when it exits, subagents included.
- Never wait in the foreground: no `until kill -0`/`pgrep` loops, `sleep`
  loops, `gh pr checks --watch`, or `gh run watch`. A foreground wait that times
  out means "background it and end the turn", not "run the wait again".
- Why, in one line: a subagent's cache lasts 5 minutes, so every wake after
  that re-pays its whole context.
- A coordinator never asks a subagent to wait on CI or a push gate (see step 3).

**Test:** spawn a Haiku probe with an ordinary task containing a 7-minute
command and *no* waiting instructions; read its transcript.
**Done:** the probe backgrounds the command, ends its turn, and shows exactly
one `cache_creation` rewrite after the gap.

### 2. Global CLAUDE.md: context hygiene

**Builds:** a short section:

- When a topic wraps up in a root session past ~300k context, say so and
  suggest `/clear` (or a fresh session) before starting the next topic.
- Subagent prompts carry the spec by reference (path + section), not pasted.
- A failure is handed to a *fresh* small-context fixer, not used to revive a
  large lane (≈100k fresh vs ≈625k to rewrite a 500k lane).

**Test:** review only (a rule for me, not code).
**Done:** owner has read it.

### 3. This repo: lanes stop at "ready to ship"

**Builds:**

- `~/.claude/bin/pr-ship` (personal tooling, outside the repo so knip and eslint
  do not apply). Given a worktree and a PR-body file, it:
  1. pushes, which waits for the gate lock and runs the gate;
  2. creates the PR (or finds the existing one);
  3. runs `gh pr checks --watch`;
  4. writes `<worktree>/.ship-status` with `green` / `gate-blocked` / `ci-red`
     plus the failing check names and a log tail;
  5. exits 0 on green, 1 on red.
- Lane prompts: the lane commits, writes `PR_BODY.md`, records the demo, and
  ends with "ready to ship: <worktree>". It does not push.
- The root session runs `pr-ship` with `run_in_background`, one per lane. The
  lock serializes them; the root's 1 h cache makes each notification a cheap
  read.
- On red, the root spawns a fresh fixer (`guardrail-fixer-thorough` or
  general-purpose, with the failure tail and `git diff main...`), then runs
  `pr-ship` again.
- This repo's CLAUDE.md, workflow expectation 7, is reworded to: "a push is not
  done until its checks are green — background the watch (or hand it to
  `pr-ship`), never watch in the foreground."

**Decided (owner):** `pr-ship` is built as a `guardrails ship` subcommand,
not as personal tooling, because guardrails already owns the push gate. The
machine-wide lock moves into the scaffold's `pre-push` template with it;
dialed.run's own `.githooks/pre-push` is human-managed and adopts it
separately (step 6). Either way, the
"lanes don't push" convention stays in CLAUDE.md, because the scaffold cannot
see how a coordinator dispatches its agents.

**Test:**

- dry-run `pr-ship` against a docs-only branch: green path, status file, exit 0;
- point it at a branch with a deliberate lint failure: `gate-blocked`, exit 1,
  tail present;
- one real lane round under the new dispatch, then rerun the usage analysis
  (`agg.py`).

**Done:** in the next lane round, lane subagents show no post-gap cache rewrites
and the "waiting" bucket is under 3% of the window.

### 4. guardrails-core: remember a passing push gate

**Builds:** in `runCommitGate` for profile `push`, reuse
`tree-fingerprint.ts` (tree + merge-base + package version) and store
`.guardrails/state/push-pass.json` on a clean outcome. Skip the analyzers when
the fingerprint matches, and log `cached: true`, as the stop gate already does
with `clean-tree.json`.

**Test:** unit tests in guardrails-core:

- pass, then the same tree → skipped;
- one changed byte → runs;
- a new merge-base → runs;
- a package version bump → runs.

**Done:** a re-push of an unchanged tree (e.g. after the 1 h lock timeout)
returns in seconds. Released as 0.7.x and bumped in dialed.run.

### 5. guardrails-core: `pretooluse` stops pre-running the push

**Builds:** `pretooluse` on `git push` currently runs the commit-rung gate over
the whole branch (up to 240 s, outside the lock) before `pre-push` runs a
superset of it. Skip it when the repo's `pre-push` hook invokes
`gate --mode=push`. Detection is by reading the hook file, or by a config
flag; the PR will say which and why.

**Test:** unit tests covering:

- with the hook present → allowed without running analyzers;
- without the hook → unchanged behaviour.

**Done:** `git push` in dialed.run spends no time in the pre-tool hook.

### 5b. guardrails-core: enforce the waiting rule at `pretooluse`

**Builds:** the Bash `pretooluse` hook already parses every command to find
`git commit|push`. Extend it to deny a narrow, known set of *foreground* waits:

- `gh pr checks … --watch` and `gh run watch`;
- `until … kill -0` / `pgrep` loops;
- `sleep N` where N is over the threshold.

It denies only when `tool_input.run_in_background` is not true, and says
"background it and end your turn; you will be woken once". A config key turns
it off or adjusts the threshold. This makes step 1 a block rather than a
nudge, in the scaffold's own spirit, and every adopting project gets it.

**Test:** unit tests per pattern, covering:

- foreground → deny;
- `run_in_background: true` → allow;
- a heredoc or quoted string containing the pattern → allow (reusing the
  existing heredoc stripping);
- config off → allow.

**Done:** the step 1 probe, run without the global rule, is blocked on its
first foreground wait.

### 6. Owner-only (forbidden zone): the lock ceiling

`.githooks/pre-push` gives up after 3600 s with exit 75, which made lane A push
again and go back to the end of the queue. Once waiting is free (steps 1, 3 and
4), a longer ceiling, say 3 h, is cheaper than a requeue. I will not edit
`.githooks/`; this is listed for the owner's decision.

## Order

1 and 2 first: an edit to the global CLAUDE.md, immediate effect. Then 4 and 5
(the guardrails repo PR and release), then 3, which needs a lane round to
verify, with 6 alongside if approved.
