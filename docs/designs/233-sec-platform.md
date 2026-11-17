# Design: 233 sec-platform

## Problem

Wave 13 lane 13d: eight items from the 2026-11-14 security audit, tracked
by id only in #756 (SA-M18, SA-M19, SA-M34, SA-M38, SA-L08, SA-L10,
SA-L18, SA-L20). This lane tightens the supply chain (the lockfile, the
Dependabot jobs, the deploy job), the speed checks' reporting, the CSP's
open-web hashes, error reporting, and where the Worker answers. Most of it
is `.github/workflows/` and `wrangler.jsonc`, edited under the owner's
one-time grant (2026-11-15).

## Approach

- **SA-M18.** `test/architecture/lockfile-shape.test.ts`: every lockfile
  entry but the root resolves to exactly
  `registry.npmjs.org/<name>/-/<base>-<version>.tgz`, an alias's real name
  comes from a pinned table, only an aliased entry may carry `name`, and
  only guardrails-core's exact URL (read from `package.json`) is off the
  registry. lockfile-lint drops the unused alias and checks integrity
  strictly. The `npm audit signatures` comment says what it verifies.
- **SA-M19.** The Dependabot review grants no Bash: releases are read
  through WebFetch, `Bash` is in `--disallowedTools`, `GH_TOKEN` goes.
- **SA-M38, SA-L10 (cooldown).** `classify` checks out main and runs
  `scripts/dependabot/classify.ts` (no PR code, no install). For every
  lockfile entry the PR adds or moves (base and head lockfiles fetched as
  data), it reads the registry and holds the PR unless the version is at
  least the cooldown old (7 days, pinned to `dependabot.yml`) and its
  publisher published an earlier version. Any read that fails holds it.
- **SA-L10 (deploy).** The `pnpm` block goes. `package.json` gains
  `allowScripts` for the packages that need theirs, and `.npmrc`
  `strict-allow-scripts=true`, behind an npm version floor. The deploy
  splits: a `build` job with no environment uploads `dist/`, and `deploy`
  installs only Wrangler's tree and runs it.
- **SA-L20.** Both review jobs run a probe straight after `harden-runner`
  and again before Claude: the job fails unless two outside hosts are
  unreachable and `sudo` is gone.
- **SA-M34.** The hourly speed findings go to Sentry capped per firing
  (guess: the first 5 per check as their own events, the rest as one event
  with the count). The rollup and the checks judge only routes the router
  knows, plus server-function names. The rollup query keeps the busiest
  rows.
- **SA-L08.**
  - Open-web pages render with a per-request marker the hasher keys on,
    so the policy hashes only scripts the framework wrote. The marker and
    the router's `csp-nonce` meta are stripped before the page leaves.
  - A server-function request that did not answer 2xx is timed under one
    shared name. A beacon may not repeat a metric name.
  - `reportException` sends a failed statement's cause and the first
    words of its SQL, never its bound values, to Sentry and the console.
    A server-function middleware does the same for the caller.
  - `wrangler.jsonc` sets `preview_urls: false` and `workers_dev`
    explicitly (guess: `true` until the sweep's route step).
  - The CSP flip stays at the public gate (decision of 2026-10-11).
    The deployment plan gets that row (guess).
- **SA-L18.** The change-email link is sent at once, not owed. The
  takedown receipt owes the request id, and the email handler mints the
  confirm token when it sends. A confirm past `dueAt` is refused.

## Contract touches

- Schema: **none**. Bindings: **none**. `wrangler.jsonc` gains two
  top-level keys, listed in `scripts/diagrams/structure.ts`.
- Workflows: `ci.yml` (deploy split, comment), `dependabot-pr.yml`,
  `a11y-review.yml` (probe). Queue wire (law 9): the takedown email keeps
  reading `confirmToken` until old rows drain.

## Test plan

All vitest (`worker` project): `lockfile-shape`, `workflow-floor` (no
Bash grant, the probe after every block fence, classify runs the script,
deploy has no `npm ci`), `install-scripts`, `dependabot-classify` (age,
publisher, fail closed, lockfile diff), `scheduled` (the cap),
`perf-checks` and `vitals-rollup` (unknown routes), `timing`, `vitals`,
`inline-script-hashes`, `sentry`, `security-headers`,
`bindings-conformance`, `takedown-requests`, `verification`.

## Issues

- Refs #756. Opens: none yet.

## Open questions (asked of coordinator-13; built on the marked guesses)

1. SA-M34 reverses design 165's "each finding its own event". The cap, and
   its number?
2. SA-L08: an enforced baseline beside 12d's `connect-src 'self'`
   (`object-src 'none'; base-uri 'self'; frame-ancestors 'none'`)?
3. SA-L08: `workers_dev` before the route step: `true` or `false`?
4. SA-L18 and the drizzle middleware touch other lanes' files
   (`safety/takedown-*`, `account/verification.ts`, `src/start.ts`).
