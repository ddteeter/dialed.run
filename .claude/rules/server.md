---
paths:
  - "src/modules/**/*.ts"
  - "src/lib/**"
  - "src/env/**"
  - "src/server.ts"
---

# Server code: D1, trust boundaries, resilience

Loaded when you touch module, `lib/` or `env/` TypeScript. Code comments that
cite "CLAUDE.md law N" or "§D1 discipline" mean the sections below.

## D1 query discipline

- **Every D1 query goes through `coreDb()`, `weatherDb()` or
  `primaryCoreDb()` from `src/env`** (design 143, D-123). Reads may come from
  a read replica, so a check that authorizes a write reads the primary:
  `primaryCoreDb()`, `verifiedUserId()`'s pin, or `pinPrimary()`.
  dependency-cruiser's `d1-handles-come-from-env` rejects a value import of
  `drizzle-orm/d1` elsewhere (`import type` is fine), and
  `test/architecture/d1-access.test.ts` rejects naming a binding.
- Every query that backs a page is covered by an index. Rows _scanned_ are
  billed, not rows returned.
- Feed and list queries: fanout-on-read with covering indexes. Never
  fanout-on-write (no per-follower insert loops).
- Batch related reads with `db.batch()` where possible.
- **Filter in SQL, not in memory.** A `.filter()` a `WHERE` could have
  expressed is billed for every row it threw away, and it breaks `LIMIT`:
  `LIMIT 200` then a filter returns "the survivors of the first 200 rows",
  not "the first 200 survivors". **The one exception** is a join D1 cannot
  express: `DIALED_CORE` and `DIALED_WEATHER` are separate databases, so
  correlating runs with observations happens in code. Say so in a comment,
  or the next reader will "fix" it.
- **D1 has no interactive transactions.** `db.batch()` is the atomicity
  primitive: one batch commits together or not at all. Separately awaited
  writes are not a transaction.
- **Default to one batch; justify splitting.** Two writes in one handler go
  in one `batch()` unless you can say why they are independent. The tells
  that they are not: a write plus the notification, log row or event that
  records it; a claim (`INSERT OR IGNORE`, a status-claim `UPDATE`) plus the
  work it authorises — the worst case, because the claim stops a retry, so a
  gap after it loses the work for good; a delete plus whatever cleans up
  after it. A batch cannot branch on its own results, so a read that decides
  what to write goes _before_ it — a reason to reorder, not to split.
- **A drizzle builder is lazy.** `db.insert(t).values(v)` assembles SQL and
  sends nothing until it is `await`ed or passed to `batch()`. A bare builder
  statement is now a lint error (`no-floating-promises` with
  `checkThenables`), but a builder held in a variable and never batched is
  not — when you move a statement into a batch, the `await` is what you
  delete, and forgetting the array entry silently drops the write.

## Trust boundaries: parse, don't validate

Everything from outside — form data, search params, webhook payloads, weather
API responses, uploaded file contents, queue messages — is `unknown` until
parsed through a zod schema in `lib/codecs/` or the owning module.
`JSON.parse(x) as T` is a violation (lint); the diff-auditor rejects new
structural casts. Server function inputs are parsed with zod validators,
always.

The garment contract is a **discriminated union on `category`** — only the
attributes valid for that category exist on the parsed type. All wardrobe
reads/writes go through `garmentSchema` in `lib/contracts/garments.ts`; never
construct a garment object outside it.

## Server functions

- **One gate per concern.** `requireUserId` (server functions) and
  `requireSession` (route loaders) in `modules/auth` are the only auth gates;
  an eslint rule rejects new ones. A write other runners can see, or one that
  trusts the address, takes `verifiedUserId()` instead (D-113): follow,
  Useful, report, email change, the Desk. Every server function and route
  handler is classified in `test/architecture/verification-class.test.ts`, so
  a new one needs a row there — and choosing the class is a product call. When
  it is not obvious from "visible to others", ask.
- **A component never imports a server function** — `functions.ts` pulls
  TanStack Start's virtual entry, so nothing that reaches it is importable by
  a test. Routes wire server functions and pass them down as props, typed
  with the server function's own shape.
- **Do not wrap `createServerFn` in a generic helper.** It looks extractable
  and is not: `ServerFnReturnType` applies `ValidateSerializableInput` to the
  handler's result, so a wrapper returning a generic `TResult` does not
  typecheck. This has been tried; don't spend the hour again.
- Input schemas live in `inputs.ts`, not `functions.ts`, so they can be
  tested.

## Resilience laws (this app has no ops team)

Laws, not suggestions. Numbering is stable because code comments cite it;
8 and 11 live in `.claude/rules/schema.md`.

1. **At-least-once mindset.** Queues redeliver and crons re-fire. Every
   consumer and cron handler is safely re-runnable from any point.
   Idempotency lives in the database (UNIQUE keys, `INSERT OR IGNORE`,
   status-claim updates), never in memory.
2. **Claim, then work.** Cron/batch handlers claim rows optimistically
   (`UPDATE … SET status='processing' WHERE status='pending'`) and operate
   only on rows the update actually claimed.
3. **No hand-rolled retry loops in request handlers.** Transient work belongs
   on the queue; redelivery + `max_retries` + the DLQ _is_ the retry
   mechanism. Request handlers do one attempt.
4. **Every outbound fetch** gets `AbortSignal.timeout(...)` (10s default) and
   a zod parse.
5. **Degrade, don't fail.** A secondary feature failing (weather, photo
   processing, notification insert) never fails the primary action. Catch,
   record status, let the retry machinery own it. The only errors a user sees
   are about the thing they asked for.
6. **Surface terminal failures.** When retries exhaust, the failure lands
   where a human eventually sees it: the user's own UI or the admin digest.
   Silent permanent failure is a bug.
7. **Errors go to Sentry** with enough context to act on (userId, entity id,
   job id) — never tokens, file contents, or request bodies.

8b. **User-initiated writes are at-least-once too.** A double-click, a
replayed POST and a retry over a flaky connection are indistinguishable
from a second submission unless the request carries a key. A server
function that **creates** a row from a form takes a client-generated
`idempotencyKey` (minted when the form mounts, resent on every retry),
backed by a UNIQUE index **scoped to the user**. On a repeat, return the
row the first call made; do not error. `createManualRun` is the worked
example.

8c. **Nothing is transactional across two systems.** `db.batch()` does not
span D1 and a queue, R2, an HTTP API — **or `DIALED_CORE` and
`DIALED_WEATHER`**, the instance people miss. Pick how it becomes
eventually true: - **Reconciliation** — when one side already carries durable "not
finished" state and something re-drives it. `runs.weather_status`
stays `pending` until an observation is linked and the hourly cron
re-runs it. Cheapest; preferred when the marker exists. - **Transactional outbox** — when it does not. Revoking a Strava grant
leaves no marker once the row is deleted, so the intent is a row
(`strava_revocations`) written in the same batch, dispatched on a fast
path, deleted only when the far side confirms, and re-dispatched by
something scheduled. An outbox nothing drains is a record of good
intentions. - **Neither** — when a failure is visible and the user can retry (a photo
upload that fails says so). The test is whether a failure leaves the
systems disagreeing _with nobody able to tell_.

9. **A queue message is a wire format between two deploys.** The new
   consumer must still parse the old shape. Add a variant to the
   discriminated union on `type`, never repurpose or tighten one; new fields
   are optional; a field stops being _written_ one deploy before it stops
   being _read_. Deleting a `type` is a two-deploy operation.
10. **Anything the platform binds, a test asserts.** Cron schedules and queue
    names live in `modules/ops/crons.ts` and `modules/ops/queues.ts`, and
    `test/bindings-conformance.test.ts` fails CI when `wrangler.jsonc`
    disagrees. Add to those registries, not a literal at the use site.
