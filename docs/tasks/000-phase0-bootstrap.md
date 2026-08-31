# Task 000 — Phase 0 Bootstrap (SERIAL — human pairs on this)

Everything downstream depends on this. No parallel work until this merges.
Unlike feature lanes, this task runs interactively with the human present.

## Goal

A deployed, gated, empty-but-real app: auth works, the five-tab shell
renders, CI is green, the guardrails loop is live, and the contracts doc
exists as code.

## Deliverables (in order)

1. **Repo + toolchain**: npm project, strict `tsconfig`, ESLint flat config
   (strict-type-checked + unicorn + sonarjs, mirroring the guardrails repo),
   Prettier, Vitest with `@cloudflare/vitest-pool-workers`.
2. **TanStack Start on Workers**: scaffold per Cloudflare's official
   framework guide (`@cloudflare/vite-plugin`); `wrangler.jsonc` with D1 ×2
   (`dialed-core`, `dialed-weather`), R2 bucket `dialed-photos`, Queues
   `dialed-imports` + `dialed-imports-dlq` and `dialed-enrichment` +
   `dialed-enrichment-dlq`, cron placeholder. `src/env/`
   typed bindings module. Confirm SSR + a server function + a D1 read work
   deployed, not just in dev.
3. **Guardrails footprint** (pinned git-tag dependency):
   - `guardrails.config.json`, `.claude/settings.json` (PostToolUse autofix +
     Stop gate), fixer agents in `.claude/agents/`,
     `.githooks/pre-commit` + `git config core.hooksPath .githooks`,
     CI workflow running `guardrails verify`.
   - House rules replacing the old htmx bans: `no-restricted-syntax` banning
     string-literal URLs in `href`/`fetch`/`window.location` (typed
     `Link`/`navigate` only) and banning structural `as` casts on
     parsed JSON outside `lib/codecs`.
   - Achieve clean tsc + knip baseline BEFORE activating the Stop gate.
4. **Data layer**: Drizzle schema implementing `docs/contracts.md` exactly
   (including users' app columns — decide table-vs-columns for the Better
   Auth adapter and document it); initial migration generated and applied
   locally + remote.
5. **Auth**: Better Auth with Drizzle/D1 adapter; email/password + Google +
   Strava (generic OAuth). Login/signup/logout routes. Session middleware
   available to server functions.
6. **UI foundation**: `ui/Layout` with the five-tab shell (Call tab renders
   a static placeholder until 105), brand tokens per `docs/product.md`
   (`tokens.css`, Tailwind v4, Archivo/Archivo Black/IBM Plex Mono), `Mono`
   and `Bracketed` primitives, skeleton-loading primitive, sheet primitive
   (lanes 101/104 both need it). One authenticated "home" page proving the
   stack end to end.
7. **Contracts as code**: `src/lib/contracts.ts` (from contracts.md),
   `src/lib/ids.ts` (ULID), empty per-lane module + route directories with
   placeholder index files.
8. **CI/CD**: GitHub Actions — verify, test, Playwright smoke (login + home),
   `wrangler deploy --dry-run` on PR; deploy to workers.dev on main.
9. **dependency-cruiser config** encoding the module rules in
   `docs/architecture.md` (no-circular, env-only-bindings, index-only
   cross-module imports, routes-import-nothing-but-modules).
10. **Resilience floor** (see architecture.md "solo-ops posture"):
    - Queue config: `max_retries: 3`, retry delay, DLQ bound; DLQ consumer
      stub (mark failed + Sentry; lane 102 fills in the user notification).
    - `/health` route (D1 `SELECT 1` on both DBs, R2 head, build sha).
    - Sentry wired (toucan-js) for the Worker + queue consumers + crons.
    - Daily digest cron stub with the anomaly-check skeleton + the
      `cron_checkpoints` table.
    - Turnstile on signup; WAF rate-limit rules on `/auth/*` and upload
      routes (document the rules in the repo since they live in the CF
      dashboard, outside git).

## Done criteria

- `npm run verify && npm test` clean; commit gate active and passing.
- Fresh clone + documented setup steps reaches a running local dev server.
- Deployed to workers.dev; email/password signup → login → home page works
  in production.
- CI green on a trivial PR.
- A deliberately-introduced lint error in a scratch branch triggers the Stop
  gate and the fixer subagent successfully repairs it (live-loop proof on
  THIS repo).

## Explicitly out of scope

Any feature work. Resist. Empty modules with placeholder index.ts files only.
