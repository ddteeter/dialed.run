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
  entry resolves to exactly `registry.npmjs.org/<name>/-/<base>-<version>.tgz`,
  an alias's real name comes from a pinned table, only an aliased entry
  may carry `name`, only guardrails-core's exact URL is off the registry,
  and integrity is sha512. lockfile-lint drops the unused alias and checks
  integrity strictly.
- **SA-M19.** The Dependabot review grants no Bash: releases are read
  through WebFetch, `Bash` is in `--disallowedTools`, `GH_TOKEN` goes.
- **SA-M38, SA-L10 (cooldown).** `classify` checks out main and runs
  `scripts/dependabot-classify.ts` with Node's own TypeScript support and
  nothing installed. Every version the PR adds or moves in the lockfile
  (both lockfiles read through the API as data) must be at least 7 days
  old on the registry (pinned to `dependabot.yml`) and published by an
  account that published that package before; a trusted publisher counts
  as its OIDC configuration. Any read that fails holds the PR.
- **SA-L10 (install scripts).** `.npmrc` sets `strict-allow-scripts` and
  `engine-strict`; `allowScripts` names the four packages whose scripts
  run; `engines` floors npm at 11.19 and Node at 24.20; every
  `setup-node` takes `check-latest`. Limit: the entries are bare names, so
  any later version of a named package runs its script (a pinned entry
  would fail every esbuild or workerd bump), and nothing here covers code
  the build loads.
- **SA-L10 (deploy).** A `bundle` job with no environment builds and
  uploads `dist/` and the plugin's deploy config; `deploy` downloads it,
  runs `npm ci --ignore-scripts` on the same lockfile, and runs only
  Wrangler with the token. Code the build loads can still change the
  bundle; it never shares a job with the token.
- **SA-L20.** Both review jobs run a probe straight after `harden-runner`
  and again before Claude: two hosts off the list must be unreachable and
  `sudo` gone, or the job stops.
- **SA-M34.** The `:30` firing sends each check's first 5 findings as their
  own events and the rest as one event with the count (guess Q1). The
  hourly checks and the daily rollup keep only route names the router has,
  plus server functions and `unmatched` (`knownRoutes`); the queries order
  by sample count so the 10,000-row cut keeps the busiest.
- **SA-L08.**
  - A server function that did not answer `2xx` is timed as
    `serverFn:failed`. Not done: refusing a beacon that repeats a metric
    name, because the real client repeats LCP for two soft navigations to
    one route.
  - `reportException` sends a failed statement's first words and the
    database's reason, never its bound values or cause, to Sentry and the
    console. `lib/statement-scrub`, first in `start.ts`'s
    `functionMiddleware`, does the same for a server function's caller (a
    handler's error never reaches request middleware as a throw). Limit:
    the wiring test reads the registered list and drives the middleware's
    server half; no e2e makes a real statement fail.
  - `wrangler.jsonc` sets `preview_urls: false` and `workers_dev: true`
    until the sweep's route step, which now also turns it off (guess Q3).
  - After 12d (#816) merges: open-web pages render with a per-request
    marker the hasher keys on, so the policy hashes only scripts the
    framework wrote; the enforced baseline (guess Q2); the deployment-plan
    row for the CSP flip at the public gate (decision of 2026-10-11).
- **SA-L18.** The change-email link is sent straight after the answer,
  like `verify_email`; the taken-address email still rides the outbox, so
  neither the answer nor its timing says which. The takedown receipt owes
  its request id, and the email handler mints the token as it sends,
  writing only the hash, only while the request still waits. A confirm
  past `dueAt` answers `not_found` (guess Q7).
  - **At-least-once** (coordinator-13, 2026-11-16): each send mints anew,
    and only the last token works. A send the provider took whose mark
    never landed goes twice (the handler's accepted case), and the second
    carries the live link. The requester holds only a dead link only if
    every retry fails until `dueAt`; the outbox never drops an email row,
    and filing again needs no account. Keeping the previous hash would
    need a second column (a schema change) for a window one crash wide.
    Pinned by "works only as the last one minted" and the drain's
    sent-row tests.

## Contract touches

- Schema: **none**. Bindings: **none**. `wrangler.jsonc` gains two
  top-level keys, listed in `scripts/diagrams/structure.ts`.
- Workflows: `ci.yml`, `dependabot-pr.yml`, `a11y-review.yml`,
  `actions.lock`. Queue wire (law 9): the takedown email keeps reading
  `confirmToken` until old rows drain.

## Test plan

All vitest (`worker`): `lockfile-shape`, `install-scripts`,
`workflow-floor` (no Bash grant, the probes, classify runs the script, the
deploy's jobs), `scripts/dependabot-classify`, `bindings-conformance`,
`timing`, `speed-hourly`, `vitals-rollup`, `perf-checks`, `scheduled`,
`lib/statement-error`, `lib/statement-scrub`, `sentry`,
`takedown-abuse`, `public-photo-retractions`, `verification`.

## Issues

- Refs #756. Opens: none.

## Open questions (batched by coordinator-13 for the owner)

1. SA-M34: the cap reverses design 165's "each finding its own event";
   its number (guess 5).
2. SA-L08: an enforced `object-src 'none'; base-uri 'self';
   frame-ancestors 'none'` beside 12d's `connect-src 'self'` (guess yes).
3. SA-L08: `workers_dev` before the route step (guess `true`).
4. SA-L10: the deploy split and the install-script allowlist; Node 24
   below 24.20 now fails `npm ci` (guess yes).
5. SA-M38, SA-L10: holding a PR for any moved version under 7 days old or
   from a new publisher (guess yes).
6. lockfile-lint's config is changed (coordinator: not a forbidden zone).
7. SA-L18: a confirm past `dueAt` says the link doesn't match a request
   (guess: no new wording).
