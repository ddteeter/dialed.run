# Task 000 — Phase 0 Bootstrap (SERIAL — human pairs on this)

Everything downstream depends on this. No parallel work until this merges.
Unlike feature lanes, this task runs interactively with the human present.

## Goal

A deployed, gated, empty-but-real app: auth works, one page renders, CI is
green, the guardrails loop is live, and the contracts doc exists as code.

## Deliverables (in order)

1. **Repo + toolchain**: npm project, strict `tsconfig`, ESLint flat config
   (strict-type-checked + unicorn + sonarjs, mirroring the guardrails repo),
   Prettier, Vitest with `@cloudflare/vitest-pool-workers`.
2. **Guardrails footprint** (copy from agentic-guardrails-scaffolding, pinned
   git-tag dependency):
   - `guardrails.config.json`, `.claude/settings.json` (PostToolUse autofix +
     Stop gate), fixer agents in `.claude/agents/`,
     `.githooks/pre-commit` + `git config core.hooksPath .githooks`,
     CI workflow running `guardrails verify`.
   - House rule: ESLint `no-restricted-syntax` banning string literals in
     `hx-get|hx-post|hx-put|hx-delete|action` JSX attributes and in `href`
     where the value starts with `/` (route-manifest enforcement).
   - Achieve clean tsc + knip baseline BEFORE activating the Stop gate.
3. **Workers skeleton**: Hono app entry, `wrangler.jsonc` with D1 x2
   (`dialed-core`, `dialed-weather`), R2 bucket `dialed-photos`, Queue
   `dialed-imports`, cron placeholder. `src/env/` typed bindings module.
4. **Data layer**: Drizzle schema implementing `docs/contracts.md` exactly;
   initial migration generated and applied locally + remote.
5. **Auth**: Better Auth with Drizzle/D1 adapter; email/password + Google +
   Strava (generic OAuth). Login/signup/logout pages. Session middleware.
6. **UI foundation**: `ui/Layout`, design tokens (CSS custom properties),
   htmx + View Transitions wired, Tailwind v4 build step. One authenticated
   "home" page proving the stack end to end.
7. **Contracts as code**: `src/lib/contracts.ts`, `src/lib/ids.ts` (ULID),
   `src/routes/manifest/` barrel with empty per-lane namespace files.
8. **CI/CD**: GitHub Actions — verify, test, Playwright smoke (login + home),
   `wrangler deploy --dry-run` on PR; deploy to workers.dev on main.
9. **dependency-cruiser config** encoding the module rules in
   `docs/architecture.md` (no-circular, env-only-bindings, index-only
   cross-module imports, routes-only-from-entry).
10. **Resilience floor** (see architecture.md "solo-ops posture"):
    - Queue config: `max_retries: 3`, retry delay, `dialed-imports-dlq`
      bound; DLQ consumer stub (mark failed + Sentry, lane 102 fills in the
      user notification).
    - `/health` route (D1 `SELECT 1` on both DBs, R2 head, build sha).
    - Sentry wired (toucan-js) for the Worker + queue consumers + crons.
    - Daily digest cron stub with the anomaly-check skeleton + a
      `cron_checkpoints` table (each cron writes a heartbeat row; the digest
      flags stale ones).
    - Turnstile on signup; WAF rate-limit rules on `/auth/*` and upload
      routes (document the rules in the repo since they live in the CF
      dashboard, outside git).

## Done criteria

- `npm run verify && npm test` clean; commit gate active and passing.
- Fresh clone + documented setup steps reaches a running local dev server.
- Deployed to workers.dev; email/password signup → login → home page works
  in production.
- CI green on a trivial PR (prove the loop end to end).
- A deliberately-introduced lint error in a scratch branch triggers the Stop
  gate and the fixer subagent successfully repairs it (live-loop proof on
  THIS repo, not just the guardrails repo).

## Explicitly out of scope

Any feature work. Resist. Empty modules with placeholder index.ts files only.
