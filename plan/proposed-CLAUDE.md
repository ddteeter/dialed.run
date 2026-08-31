# Dialed — CLAUDE.md

Dialed (dialed.run) is a social run-wardrobe app: runners log their gear, attach outfits to
runs, share them in a feed, and (later) get outfit recommendations from
history + weather. SSR web app on Cloudflare Workers.

You are one of several agents working in parallel worktrees. Your task packet
in `docs/tasks/` defines what you own. **Do not touch files outside your
packet's ownership list** — another agent owns them.

## Stack (fixed — do not substitute)

- **Language**: TypeScript, strict. No `any`, no `as` casts at trust boundaries.
- **Runtime**: Cloudflare Workers. Hono app, JSX SSR (`hono/jsx`).
- **Client interactivity**: htmx + View Transitions. No SPA framework. No
  client-side state libraries.
- **Data**: D1 via Drizzle ORM. Migrations via drizzle-kit.
- **Storage**: R2 for photos. **Queues** for async work (imports, webhooks).
  **Cron Triggers** for scheduled work.
- **Auth**: Better Auth (email/password, Google, Strava OAuth).
- **Validation**: zod at every trust boundary (see below).
- **Tests**: Vitest with `@cloudflare/vitest-pool-workers`. Playwright smoke
  tests run in CI only.

## Architecture rules (enforced by dependency-cruiser — the gate will block you)

Module layout under `src/`:

```
src/
  env/        # ONLY module that reads bindings/env. Everything else imports from here.
  db/         # Drizzle schema + migrations. See "Schema changes" below.
  routes/
    manifest/ # Typed path builders, one file per lane (wardrobe.ts, runs.ts, ...)
  modules/    # Feature modules. Public API = the module's index.ts only.
    auth/  wardrobe/  runs/  weather/  feed/
  ui/         # Layout, shared components, design tokens.
  lib/        # Pure shared utilities, zod codecs.
```

- A module may import: `db`, `env`, `lib`, `ui`, and **other modules only via
  their `index.ts`**. Never deep-import another module's internals.
- Nothing imports from `routes/` except the app entry.
- No circular imports.
- Only `src/env/` touches `process.env` or Workers bindings directly.

## Trust boundaries: parse, don't validate

Every piece of data entering from outside — form bodies, query params, webhook
payloads, weather API responses, uploaded file contents, queue messages — is
`unknown` until parsed through a zod schema in `lib/codecs/` or the owning
module. `JSON.parse(x) as T` is a violation; the diff-auditor will reject new
structural casts.

```ts
// WRONG
const payload = (await c.req.json()) as StravaEvent;

// RIGHT
const payload = stravaEventSchema.parse(await c.req.json());
```

## Routing and htmx: no string-literal URLs

All URLs come from the typed route manifest. Writing a path as a string
literal in `hx-get`/`hx-post`/`href`/`action`/fetch is a lint error.

```tsx
import { routes } from "@/routes/manifest";

// WRONG
<button hx-post="/wardrobe/items/123/delete">

// RIGHT
<button hx-post={routes.wardrobe.deleteItem(item.id)}>
```

Every htmx endpoint returns a typed JSX fragment component from
`modules/<lane>/fragments/`. Full pages compose fragments.

## Schema changes (serialized — the one shared resource)

`src/db/schema.ts` and `src/db/migrations/` are **not owned by any lane**.
If your task requires a schema change not already in the contracts doc:

1. STOP implementation.
2. Write the proposed change as a short note in your design doc.
3. End your turn and ask for human review.

Never run `drizzle-kit generate` inside a feature branch unless your packet
explicitly says the migration is yours.

## D1 query discipline

- Every query that backs a page or fragment must be covered by an index.
  Rows *scanned* are billed, not rows returned.
- Feed and list queries: fanout-on-read with covering indexes. Never
  fanout-on-write (no per-follower insert loops).
- Batch related reads with `db.batch()` where possible.

## Guardrails (the enforcement loop)

This repo runs `guardrails` (agentic-guardrails-scaffolding):

- **Stop gate**: when you try to end a turn, `guardrails gate --mode=stop`
  runs eslint + tsc on your diff. If it blocks with a pointer to a manifest,
  spawn the named fixer subagent as instructed — do not read the manifest
  yourself, and do not argue with the gate.
- **Never** add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `as any`,
  `.skip`, or `.only`. The diff-auditor rejects them and the turn will not end.
- **Commit gate**: knip + dependency-cruiser run at commit. Dead code and
  boundary violations block the commit. Delete dead code; don't ignore it.
- Fix the code, not the rule. If a rule seems genuinely wrong, note it in your
  design doc for human review instead of suppressing it.

## Workflow expectations

1. At session start: read this file, then your task packet in `docs/tasks/`,
   then `docs/architecture.md` and `docs/contracts.md`.
2. **Design doc first**: write `docs/designs/<task-id>-<name>.md` using
   `docs/design-doc-template.md`. Commit it. Then STOP and ask for review
   before implementing (unless your packet says otherwise).
3. Implement in small commits. Each commit passes the commit gate.
4. Tests are part of done, not an afterthought. Match the test expectations
   in your packet.
5. If you change module boundaries or add a queue/cron/binding, update the
   relevant diagram in `docs/architecture.md` in the same PR.
6. Before ending your final turn: run `npm run verify && npm test`, then
   summarize what you built, what you did not do, and any open questions —
   in five sentences or fewer.

## Resilience rules (all lanes — this app has no ops team)

Dialed must run unattended. These are laws, not suggestions:

1. **At-least-once mindset.** Queues redeliver and crons re-fire. Every queue
   consumer and every cron handler must be safely re-runnable from any point.
   Idempotency lives in the database (UNIQUE keys, `INSERT OR IGNORE`,
   status-claim updates), never in memory.
2. **Claim, then work.** Cron/batch handlers claim rows optimistically
   (`UPDATE ... SET status='processing' WHERE status='pending'` and operate
   only on rows the update actually claimed) so overlapping invocations
   cannot double-process.
3. **No hand-rolled retry loops in request handlers.** If work can fail
   transiently, it belongs on the queue; queue redelivery + `max_retries` +
   the DLQ *is* the retry mechanism. Request handlers do one attempt.
4. **Every outbound fetch** gets `AbortSignal.timeout(...)` (10s default) and
   a zod parse. A slow or weird upstream must never wedge a request or a
   consumer.
5. **Degrade, don't fail.** A secondary feature failing (weather, photo
   processing, notification insert) must never fail the primary action that
   triggered it. Catch, record status, let the retry machinery own it. The
   only errors a user sees are about the thing they asked for.
6. **Surface terminal failures.** When retries exhaust, the failure must land
   somewhere a human eventually sees: the user's own UI (their import failed)
   or the admin digest (system-level). Silent permanent failure is a bug.
7. **Errors go to Sentry** with enough context to act on (userId, entity id,
   job id) — but never tokens, file contents, or request bodies.
8. **Migrations are expand→contract.** Additive change deploys first; code
   stops reading old shape; destructive change ships in a later migration.
   Never rename/drop in the same PR that changes code.

## Forbidden zones (all lanes)

- `wrangler.toml` / `wrangler.jsonc` bindings — human-managed.
- `.github/workflows/`, `.githooks/`, `guardrails.config.json`, ESLint/DC
  configs — human-managed.
- `src/db/schema.ts` + migrations — see schema protocol.
- Another lane's `src/modules/<lane>/` directory.
- Secrets: never write a secret, token, or key into any file. Bindings only.
