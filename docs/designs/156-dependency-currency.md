# Design: 156 Dependency currency

## Problem

Nothing keeps dialed.run's dependencies current: no Dependabot config,
alerts and security updates off, about 45 packages behind on 2026-10-25.
The owner's call (2026-10-25): use Dependabot and let updates merge
themselves wherever the tests can carry that, with a Claude impact review
on the ones that can't. A solo app with no ops team cannot rely on
someone remembering to update.

## Approach

- **`.github/dependabot.yml`**: weekly, 7-day cooldown, packages that move
  together grouped (majors included), the rest grouped prod/dev for minor
  and patch. Majors outside a family get their own PR.
- **`.github/workflows/dependabot-pr.yml`**: `classify` reads
  fetch-metadata and decides; `auto-merge` arms GitHub auto-merge with an
  App token for compatible npm updates (minor at ≥1.0, patch outside 0.0.x,
  same maintainers); `review` has Claude write a structured impact review
  of everything else; `post` screens it and comments.
- **`oss-list.yml` + `oss-list-commit.yml`**: ported from dialed.run-site.
  The build fails under CI when the open-source list (design 151) goes
  stale, so a read-only job rebuilds it and a `workflow_run` job commits it
  to the PR as the App, which starts CI without anyone approving the run.
- **CI**: `e2e` runs twice, against dev and against the built Worker
  (`E2E_SERVER=preview`); the dev leg keeps the required name `e2e`.
  `npm audit signatures` after install; `lockfile-lint` in `npm run lint`.
  Every `uses:` pinned to a commit SHA. The deploy job moves into a
  `production` environment.
- **e2e harness**: `e2e/support/server-fn.ts` names a server-function call
  in either mode. A production build hashes the function ids that two
  stubs matched by name, so five specs failed against the build.
- The security review and the operating notes are `docs/dependencies.md`.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**. New GitHub settings, an App and two
  environments, all set by the owner (docs/dependencies.md §Setup).
- Screens: none; no user-visible change.

## Test plan

- e2e, both servers, full suite: 88 tests against the build, after the
  `server-fn` helper (5 failed before it).
- The classify decision and the post screen were run locally against
  hand-made metadata and reviews (stable minor, 0.x patch and minor, 0.0.x,
  major, new maintainer, Actions, mixed groups; a fake key, a bad verdict,
  an extra field, @-mentions, table pipes). The workflows themselves can
  only run on GitHub; the first Dependabot PRs are their test.
- `npm run lint` now fails a lockfile entry from another host, without an
  integrity hash, or whose tarball names a different package.

## Open questions

- The review job's network allowlist is a best guess at what
  claude-code-action installs from. If the first review fails on a blocked
  host, the run log names it; adding it is a one-line change.
- `npm` 11.19 warns about install scripts not covered by `allowScripts`.
  An install-script allowlist would stop a new dependency's install script
  from running at all; not done here (R-166).
