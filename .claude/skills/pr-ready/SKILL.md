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
3. **Design deltas.** Every undesigned surface you shipped is in
   `docs/design-deltas.md`'s open queue and listed under a **"Design deltas"**
   heading in the PR body (`.claude/rules/ui.md`, placeholder protocol).
4. **Schema.** A migration is named in the PR body; a destructive one says so
   explicitly (D-139). An additive column another lane may want is called out.
5. **Architecture.** If you changed module boundaries or added a
   queue/cron/binding, the diagram in `docs/architecture.md` changes in the
   same PR.
6. **Run** `npm run verify && npm test && npm run build`. `build` is a gate:
   `postbuild` runs `check:bundle`.

## Deferring is a write

If you answer anything with "flagging it", "next schema batch" or "worth
doing later", add the row to `docs/deferred.md` in the same commit and say
which item it is. A thread scrolls away; the register does not.

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
Run the push and the watch (`gh pr checks <n> --watch`) with
`run_in_background`, then end the turn; you are woken once when it exits.
Fast-forward local `main` before pushing a new branch — the gate diffs
against it. A lane dispatched by a coordinator stops at "ready to ship" and
does not push at all.

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
