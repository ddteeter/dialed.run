---
name: pr-ready
description: Use before opening a pull request in dialed.run, before pushing a branch for review, or when answering review comments on a PR. Covers the self-review list, the PR body's required sections, design deltas, deferring work, demo videos, the final verify/test/build, and how to push without waiting in the foreground.
---

# Getting a PR ready

## Before you open it

1. **Work through `docs/pr-self-review.md`.** It is the residue of the PR
   #2–#5 review: the findings no rule could catch, written as questions.
2. **Demo what a user would see change.** If a reviewer opening the app would
   see anything different from `main` — including a screen whose behaviour
   changed behind an unchanged UI — invoke the `pr-demo-video` skill: a
   throwaway spec in `e2e/scratch/`, scoped to the change. Work with no
   user-visible effect needs no video.
3. **Test kinds.** Check every test the branch adds against the table in
   `.claude/rules/testing.md` §Which kind of test. A new e2e spec that a
   dom test could replace gets rewritten as one. A flow the branch changed
   has its journey updated in the same branch.
4. **Design deltas.** Every undesigned surface you shipped is a Design ask:
   an issue with `kind:design-ask` in status Needs Design
   (`docs/agents/issue-tracker.md`), listed by number under a
   **"Design deltas"** heading in the PR body (`.claude/rules/ui.md`,
   placeholder protocol). A design-deltas section you write, and any
   deploy step you add, goes in a file of your own: `docs/design-deltas/`
   and `docs/launch/deployment-plan/`, each named for your design doc,
   never the shared documents (#875; each folder's README says how).
5. **Issues.** The PR body says `Closes #N` for every issue the PR
   finishes, one per line. Merging closes them and the Project marks them
   Done.
6. **Schema.** A migration is named in the PR body; a destructive one says so
   explicitly (D-139). An additive column another lane may want is called out.
7. **Architecture.** If you changed module boundaries, a cross-module
   import or a queue/cron/binding, run `npm run diagrams:generate` and
   commit the result; if you changed a drawn flow's steps, guards or
   timing, its story in `docs/diagrams/` changes in the same PR (skill
   `architecture-diagrams`). Then run `npm run diagrams:stale`: it lists
   the stories that cite a file the branch changed. For each, the PR body
   says under **"Diagrams"** whether you updated it or re-read it and it
   still holds, one line each, the view named in backticks and the line
   saying `updated` or `re-read`: the re-reads are what make a flow due
   an audit (skill `diagram-audit`). When it lists none, leave the heading out.
   **If `docs/diagrams/` changed** (by hand or by `diagrams:generate`),
   run `npm run diagrams:record`. It records every view that differs
   from the merge base, walking each story step by step with captions
   that say which steps changed and a voice that reads each changed
   step's label and note (the demo's voice, design 229 #851), and
   writes `diagrams.demo.mp4` at the repo root. Watch it with the sound
   on, then attach it
   when you ship (§Pushing). It prints the views it recorded and any the
   branch removed; a removed view cannot be shown, so name it under
   **"Diagrams"**. It needs ffmpeg and macOS, as the demo does. When it says no
   view changed (a comment or formatting edit), there is nothing to
   attach.
8. **The push runs CI's first job for you.** `.githooks/pre-push` runs
   `npm run build`, `npm test` and `npm run diagrams:check` (owner,
   2026-11-23), and the gate runs lint, typecheck and the other analyzers
   over the branch. Since guardrails-core 0.18.0 `ship` runs the gate
   itself before `git push`, so under `ship` the hook's three steps run
   after the gate, and the hook's own gate finds ship's pass and returns
   at once. Together that is what CI's "Lint,
   typecheck, test, build" job runs, so don't run them again by hand
   before shipping; run one only to work a failure. `build` is a gate
   too: `postbuild` runs `check:bundle`. A lane dispatched by a
   coordinator never runs `verify` (owner, 2026-10-24): it has no flag
   to drop its Stryker analyzer, and the push gate runs that pass in
   full. A branch that is behind main or conflicts with it is refused by
   `guardrails ship` itself before the push.
   It doesn't run Stryker over all its changed files before shipping
   (owner, 2026-11-13). The push gate mutates the same files, seeded
   from main's CI run, so a cold local pass over them costs the same
   warm-up, takes the machine-wide gate lock a second time, and can
   still score timeouts as kills that the gate calls survivors: since
   0.18.0 the gate re-tests a `Timeout` no test is named as killing once,
   alone, and one that finishes is scored as it finished. Run
   Stryker on one file only while working a survivor (skill
   `crushing-mutants`). If the gate reports survivors, fix them and
   ship again. Since guardrails-core 0.16.0 the gate mutates the whole
   function a hunk sits in, and any export whose last caller the diff
   removed, so a survivor on a line you did not touch is still yours.

## Deferring is a write

If you answer anything with "flagging it", "next schema batch" or "worth
doing later", open an issue for it before you push (labels and milestone
per `docs/agents/issue-tracker.md`; a lane may open issues within its own
scope without asking), and list its number under **"Deferred"** in the PR
body. If it waits on the owner, it is a `kind:owner-question` in Needs owner
and you ask in the turn as well (CLAUDE.md, "Stop means ask"). A thread
scrolls away; an issue does not. `docs/deferred.md` is a frozen archive and
takes no new rows.

## Never put a closing keyword before another PR's number

GitHub closes `#N` when a PR whose body or commit message says "closes",
"fixes" or "resolves" (in any tense) before `#N` merges to `main`. That
includes another open PR, not only issues. On 2026-10-25 #229's
"This resolves #228's R-165" closed #228 as #229 merged. To mention a PR
or an issue, write "addresses #N", "relates to #N" or "after #N". Use a
closing keyword only for an issue this PR is meant to close.

## Pushing

The push gate takes ~26 minutes and Guardrails CI 40–45. **Never wait in the
foreground** (`docs/proposals/2026-10-12-agent-wait-cost.md` has the cost).
Ship with `npm run ship -- --body-file=<pr-body.md>` under
`run_in_background`, then end the turn. It runs the push gate, then pushes the branch
(`git push -u origin HEAD`, so it lands on the branch's own name even when
it tracks `origin/main`), finds or opens its PR, waits for CI, and writes one
status: `green`, `gate-blocked`, `lock-timeout`, `ci-red`, `behind`,
`conflicting` or `error`. You are woken once. The machine-wide gate lock
queues pushes; you never wait for another lane yourself.

- `ship` fetches `origin/main` and refuses a branch that is behind it,
  before the push and the gate lock: `behind` when the rebase would be
  clean, `conflicting` (with the files in `failing`) when it would not.
  Both mean: rebase onto `origin/main`, then ship again. The gate measures
  from the merge-base, so local `main` does not need to be current.
- `ship` titles a new PR from `--title=<t>`, or from a `# <title>` first
  line of the body file (which it strips from the body), and otherwise
  from the last commit's subject. Give the title whenever the branch has
  more than one commit, so it names the whole change, prefixed by the
  diff's main kind. `ship` warns when the last commit's type differs
  from the branch's.
- `ship` force-pushes only when asked. A branch you rebased after its first
  push ships with `npm run ship -- --body-file=<f> --force-with-lease`;
  without the flag, git's rejection comes back as `error`.
- Since 0.18.0 nothing is pushed until `ship`'s own gate passes.
  `gate-blocked` lists each finding in `failing` as
  `<file>:<line> <rule>`. Don't commit or switch branches while it runs:
  `ship` stops with `error` if HEAD moves, because the gate checked the
  working tree and HEAD is what is pushed. An `error` whose tail says the
  gate passed is a dropped connection: ship again.
- `ship` attaches demo videos itself: add `--attach=<file>` (repeatable,
  optionally `--attach=<file>#<alt text>`). It goes on a new PR as the PR
  opens, or on an open PR as one comment, posted again on each run
  (pr-demo-video). A PR with a demo and changed diagrams attaches both,
  as two files, not joined, so a reviewer can watch either alone (design
  229, step 4):

  ```bash
  npm run ship -- --body-file=pr-body.md \
    --attach=test-results/<dir>/demo.mp4 --attach=diagrams.demo.mp4
  ```

- On `gate-blocked`, fix it and ship again. On `ci-red`, the summary line
  ends with `next: …`, from the status file's `diagnosis.advice`: `fix`
  means fix it and ship again; `rebase` means `origin/main` moved since
  the commit was tested, so rebase and ship with `--force-with-lease`;
  `rerun-failed` means a failure outside the diff (the npm registry's
  "invalid json response" flake, say), so run
  `npm run ship -- --rerun-failed` under `run_in_background`. It re-runs
  the failed jobs of the pushed commit and waits for them, and pushes
  nothing. A re-run reuses the PR's old merge commit, so a mutation check
  that timed out or ran cold takes a rebase, not a re-run. A lane
  dispatched by a coordinator messages it on `green`; the coordinator
  merges and cleans up.

A push is not done until its checks are green: CI covers the client-bundle
build and browser e2e, which the local gates do not.

## Review comments are change requests

A comment on your PR is a request to change the code. The default response is
a commit — and that applies to questions too: "should this be X?" means make
it X. Answering well and leaving the code alone is a non-response.

You may push back only when the change is genuinely outside the PR's scope
and would balloon it, needs a decision only the owner can make (a product
call, a threshold, a user-visible name), or is technically wrong here and you
can show why (a query plan, a failing test, a spec, a contradicting line).
"I'd rather not" and "it's a big change" are not reasons. **When you push
back, do the part you agree with.** Read the whole comment before deciding a
fix is out of scope — and check the premise (the columns may already exist).

## Final summary

Before ending your final turn, summarize what you built, what you did not do,
and any open questions — in five sentences or fewer.
