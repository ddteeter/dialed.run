# What `guardrails init` reports here, and what is expected

Read this when you upgrade guardrails-core and `init --plan` reports drift.
The upgrade guide (`node_modules/guardrails-core/guidance/upgrading-guardrails.md`,
step 3) calls an edited file "a judgement call for the developer". For this
repo the owner made that call on 2026-11-11 (#556): the repo's versions
win, and `--force` is never the answer.

This file is the repo's, not guardrails'. `init` does not write it.

## What the plan shows when nothing is wrong

- **`drift`** on `.githooks/pre-push`, `.github/workflows/guardrails.yml`
  and `.claude/agents/guardrail-fixer.md`.
- **`merge`** on every shared file. The plan prints that line whether or
  not the merge would write anything.
- A warning that `core.hooksPath` is already set. The hooks are active.

Checked on 0.14.0, 0.14.1, 0.14.2, 0.15.0, 0.16.0 and 0.17.0. A different
list is not expected: stop and ask the owner.

## Why each drifted file must stay as it is

- **`.githooks/pre-push`** runs `sanctions-check` after the gate. The
  template does not, and without it a copied Stryker directive passes every
  local gate and fails CI an hour later. It also runs `npm run build`,
  `npm test` and `npm run diagrams:check` before the gate, skipping a push
  that only deletes refs (owner, 2026-11-23): they are what CI's first job
  runs and the gate does not, so a branch that skipped one spent a CI lap.
  It runs them without git's hook variables (`GIT_DIR`, `GIT_INDEX_FILE`
  and the rest), so a test's git call in a temp repo cannot write to this
  one (owner, 2026-11-23). It runs them under the machine-wide gate lock,
  re-entering itself with `GUARDRAILS_PREFLIGHT=1`, and releases the lock
  before the gate takes it, so two full test suites never run side by side
  (owner, 2026-11-24).
- **`.github/workflows/guardrails.yml`** names a full version tag on every
  action, locked in `actions.lock` (D-182), and has a concurrency group, a
  Chromium install and a MediaPipe staging step. The template has floating
  tags and none of the other three, and the job fails without them. The
  comments in the file give each reason.
- **`.claude/agents/guardrail-fixer.md`** is the template after Prettier.

`test/architecture/init-drift.test.ts` pins the lines a forced overwrite
would remove, so it fails if one goes missing. It is the list; this section
is the reasons.

## What to do at an upgrade

A template can gain something the repo wants, and the plan will still say
only "drift". So compare, every time:

1. Copy the tracked files to a scratch directory outside the repo
   (`git archive HEAD | tar -x -C <dir>`), and link `node_modules` into it.
2. Run `init --apply --force` there, never in the checkout.
3. Diff the scratch copy against the checkout.
   - A line the template **adds** that the repo lacks is new. Take it by
     hand, keeping the repo's additions.
   - A line the template **removes** is one of the repo's additions. Leave
     it.
4. Run `init --apply` (no `--force`) in a second scratch copy to see what
   the merges would write.
5. Run `init --apply` once in the checkout, revert `.codex/hooks.json`
   (below), and commit what it writes to `.guardrails/scaffold.json`.

## The one thing `--apply` writes that nobody wants

`.codex/hooks.json`: `--apply` reorders the hook entries and changes none
of them. It was reverted on the 0.11.1, 0.12.0, 0.16.0 and 0.17.0
upgrades. If you run `--apply` in the checkout, revert that file. If the diff is ever
more than a reorder, read it as a real change.

`.guardrails/scaffold.json` is the one file `--apply` in the checkout
should change. Since 0.16.0 it re-records the hash of an owned file that
already matches its template, so a file brought up to a template by hand
reads as unchanged at the next upgrade instead of as drift. It records the
new version only when it writes a hash: at 0.17.0 no template changed, so
`--apply` left the file naming 0.16.0, and that is expected.
