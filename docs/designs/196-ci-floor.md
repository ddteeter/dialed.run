# Design: 196 CI security floor and issue forms

## Problem

The repo is public, and its workflows hold the Anthropic key, the automation
App's key and (soon) the deploy secrets. Only two jobs fenced their network,
nothing read the workflows for security mistakes, and a PR could add a
vulnerable dependency. Separately, anyone could open a blank public issue,
including one describing an unfixed hole (#483).

## Approach

One PR, no app code.

- **harden-runner first in every job** (#546 item 3), at the SHA already
  pinned. New uses start at `egress-policy: audit`; a job moves to `block`
  once its audit run reports a list short enough to keep (#600).
- **`.github/workflows/supply-chain.yml`**, a new workflow, not more jobs in
  `ci.yml` (draft PR #575 also edits that). On every PR: a `paths:` filter
  would make its checks unusable as required ones.
  - `zizmor`: the release binary at a pinned checksum, as `actionlint` is,
    so the allowed-actions list does not grow.
  - `dependency-review`: known vulnerabilities, and an allow-list of the
    licences AGPL-3.0, the repo's own, can combine with.
  - `lockfile`: `gh actions-lock --verify`.
- **The zizmor pass** (item 4): findings fixed in `ci.yml`, `mutation.yml`
  and `dependabot-pr.yml`. Four are by design and carry an inline ignore
  with its reason.
- **`.github/workflows/actions.lock`** (item 6). The SHA pins stay; the
  lockfile pins the same commits and what the actions use themselves.
- **Issue forms** (#483): `config.yml` (no blank issues, a link to private
  reporting) and three forms with the tracker's fields, a `kind:` label and
  the Project. Triage adds the area and severity labels.
- **`SECURITY.md`**, and the forms and checks named in
  `docs/agents/issue-tracker.md` and `docs/dependencies.md`.

## Contract touches

- Schema changes, new routes, new bindings, screens: **none**
- Forbidden zone: `.github/workflows/` and `.github/`, approved for these
  two issues (owner, 2026-11-11, on #546 and #483).

## Test plan

- `test/architecture/workflow-floor.test.ts` (vitest, worker project; reads
  the YAML as text): every job starts with harden-runner; one harden-runner
  pin; zizmor's ignores are the four reviewed ones; each form presets a
  documented `kind:` label, joins the Project and has the body fields;
  blank issues stay off.
- The workflows run on this PR's own CI: `actionlint`, `zizmor`, the
  lockfile check and the audit reports.

## Issues

- Closes: #483, #546.
- Opens: #599 (the owner-only settings), #600 (audited jobs to `block`),
  #601 (the first Dependabot action bump against the lockfile), #596 (a
  licence permission for the FIT SDK).

## Open questions

- **Owner only (#599):** CodeQL default setup, private vulnerability
  reporting, the GitHub Mobile check, and whether the new checks become
  required.
- **Block mode and the browser install:** jobs that run
  `playwright install --with-deps` reach Ubuntu's apt mirrors, so their
  allowlists must carry them. A cached browser install would not remove
  them (`--with-deps` still needs apt). Not built here.
- **Answered (owner, 2026-11-11):** the licence allow-list, the four
  ignores, and the wording of `SECURITY.md` and the forms.
