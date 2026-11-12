# Design: 196 CI security floor and issue forms

## Problem

The repo is public, and its workflows hold the Anthropic key, the automation
App's key and (soon) the deploy secrets. Only two of its jobs fence their
network, nothing reads the workflows for security mistakes, and a PR can add
a dependency with a known vulnerability. Separately, anyone can open a blank
public issue, including one that describes an unfixed hole (#483).

## Approach

One PR, no app code.

- **harden-runner on every job** (#546 item 3), first step, at the SHA the
  two existing uses pin. New uses start at `egress-policy: audit`. A job
  moves to `block` only once its audit run has reported a list short enough
  to keep; the two jobs already on `block` stay as they are.
- **`.github/workflows/supply-chain.yml`**, a new workflow rather than more
  jobs in `ci.yml` (which draft PR #575 also edits):
  - `zizmor`: the release binary at a pinned checksum, as `actionlint` is,
    so the allowed-actions list does not grow. Every PR and every push to
    `main`: it takes seconds, and a `paths:` filter would make it unusable
    as a required check later (the trap `mutation.yml` describes).
  - `dependency-review`: `actions/dependency-review-action` on PRs.
  - `lockfile`: `gh actions-lock --verify`, once the lockfile exists.
- **The zizmor pass** (item 4): fix what it finds in the same PR. Findings
  in `guardrails.yml` and `mutation.yml` beyond permissions go through the
  coordinator first (w6-guardrails owns the rest of those files).
- **`.github/workflows/actions.lock`** (item 6), generated with
  `gh actions-lock`. The SHA pins stay.
- **Issue forms** (#483): `.github/ISSUE_TEMPLATE/config.yml` (no blank
  issues, a contact link to private reporting) and three forms: build or
  bug, owner question, Design ask. Each has Trigger / What / Where / Links,
  presets its `kind:` label and joins the Project. A form cannot set the
  area or severity label; triage adds them.
- **`SECURITY.md`**, short, pointing at private reporting.
- **Docs**: `docs/agents/issue-tracker.md` names the forms as the human
  path; `docs/dependencies.md` gains the new checks.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Forbidden zone: `.github/workflows/` and `.github/`, approved for these
  two issues (owner, 2026-11-11, on #546 and #483).
- Screens implemented: **none**

## Test plan

- `test/architecture/workflow-floor.test.ts` (vitest, worker project; reads
  the YAML as text, like the other architecture tests):
  - every job in every workflow starts with harden-runner, so a new job
    without it fails (default-deny);
  - every `harden-runner` use is the same pinned SHA;
  - each issue form presets exactly one `kind:` label that
    `docs/agents/issue-tracker.md` lists, and joins the Project;
  - blank issues stay off.
- The workflows are exercised by this PR's own CI run: `actionlint`, the
  new `zizmor` job, and the audit reports.

## Issues

- Closes: #483, #546 (if the owner-only settings are done by merge;
  otherwise they stay open with those items).
- Opens: one for moving audited jobs to `block`, if the audit reports are
  not in hand before merge.

## Open questions

- **Owner only:** CodeQL default setup, private vulnerability reporting
  (both off today), the GitHub Mobile check, and whether `zizmor` joins the
  ruleset's required checks.
- **Licence policy (answered, owner 2026-11-11):** an allow-list of what
  AGPL-3.0, the repo's own licence, can combine with.
- **zizmor's by-design findings (answered, owner 2026-11-11):** four
  inline ignores, each with its reason, pinned by the test.
- **Guess:** dependency review fails at the action's default severity.
- **Block mode and the browser install:** every job that runs
  `playwright install --with-deps` reaches Ubuntu's apt mirrors
  (`azure.archive.ubuntu.com`, `security.ubuntu.com`), so a `block`
  allowlist for those jobs must carry them. A cached browser install would
  shorten those lists and survive a mirror outage like 2026-11-11's, but
  `--with-deps` still needs apt for system libraries, so the cache alone
  does not remove the mirrors. Not built here; a separate item if wanted.
