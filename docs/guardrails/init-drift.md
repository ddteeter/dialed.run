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

Checked on 0.14.0 and 0.14.1. A different list is not expected: stop and
ask the owner.

## Why each drifted file must stay as it is

- **`.githooks/pre-push`** runs `sanctions-check` after the gate. The
  template does not, and without it a copied Stryker directive passes every
  local gate and fails CI an hour later.
- **`.github/workflows/guardrails.yml`** pins its actions to commit SHAs (a
  repository setting requires that), and has a concurrency group, a
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

## The one thing `--apply` writes that nobody wants

`.codex/hooks.json`: `--apply` reorders the hook entries and changes none
of them. It was reverted on the 0.11.1 and 0.12.0 upgrades. If you run
`--apply` in the checkout, revert that file. If the diff is ever more than
a reorder, read it as a real change.

`.guardrails/scaffold.json` still names the version whose templates were
last written. `--force` is the only thing that rewrites it, so it lags the
pin, and that is expected too.
