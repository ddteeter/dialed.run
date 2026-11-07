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
   changed behind an unchanged UI — invoke the `pr-demo-video` skill. Work with
   no user-visible effect needs no video. E2E specs are organised by product
   feature (`e2e/<feature>/`), never by lane; find the demo that already owns
   your screens by grepping `Covers:` before creating a new directory.
3. **Design deltas.** Every undesigned surface you shipped is a Design ask:
   an issue with `kind:design-ask` in status Needs Design
   (`docs/agents/issue-tracker.md`), listed by number under a
   **"Design deltas"** heading in the PR body (`.claude/rules/ui.md`,
   placeholder protocol).
4. **Issues.** The PR body says `Closes #N` for every issue the PR
   finishes, one per line. Merging closes them and the Project marks them
   Done.
5. **Schema.** A migration is named in the PR body; a destructive one says so
   explicitly (D-139). An additive column another lane may want is called out.
6. **Architecture.** If you changed module boundaries or added a
   queue/cron/binding, the diagram in `docs/architecture.md` changes in the
   same PR.
7. **Run** `npm run verify && npm test && npm run build`. `build` is a gate:
   `postbuild` runs `check:bundle`. **A lane dispatched by a coordinator
   skips `verify`** (owner, 2026-10-24): it has no flag to drop its Stryker
   analyzer, the push gate runs that pass in full, and the commit gate has
   run the other analyzers on each commit. The lane runs
   `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and
   `npx stryker run --mutate "<the changed production files>"` to 100%.

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
`run_in_background`, then end the turn. It pushes the branch
(`git push -u origin HEAD`, so it lands on the branch's own name even when
it tracks `origin/main`), finds or opens its PR, waits for CI, and writes one
status: `green`, `gate-blocked`, `lock-timeout`, `ci-red` or `error`. You
are woken once. The machine-wide gate lock queues pushes; you never wait for
another lane yourself.

- Rebase onto `origin/main` and fast-forward local `main` first: the gate
  diffs against local `main`.
- `ship` never force-pushes. A branch you rebased after its first push needs
  `git push --force-with-lease origin <branch>:<branch>` (backgrounded), then
  `npm run ship` again to watch CI.
- `ship` opens the PR from the body file and has no `--attach`. Attach demo
  videos afterwards with `gh pr comment <n> --attach <file>`
  (pr-demo-video).
- On `gate-blocked` or `ci-red`, fix it and ship again. A lane dispatched by a
  coordinator messages it on `green`; the coordinator merges and cleans up.

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
