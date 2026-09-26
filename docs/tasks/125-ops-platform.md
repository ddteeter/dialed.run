# Task 125 — Ops & platform

Lane 1 of 5 building to the launch development plan. Read
`125-129-launch-development.md` first: it holds the rules every lane
shares, the migration protocol and the cross-lane seams.

The app is meant to run unattended, and today it cannot tell anyone when it
is not. Most Sentry events are probably dropped, a second day's digest is
silent, the auth rate limiter is off, and weather bills 24 times what it
uses. This lane makes the platform honest before anyone else relies on it,
and builds the two things other lanes stand on: the Desk shell and
Turnstile.

## You own

- `src/modules/ops/**`, `src/modules/weather/**`
- `src/server.ts`, `src/env/**`
- `src/routes/__root.tsx` (head tags), `src/routes/api/health.ts`
- New `src/routes/legal/**`; the legal links in `src/ui/SignedOutLayout.tsx`
  and the landing bar (additions only to those two)
- `src/routes/desk/route.tsx` (the D0 shell) and `src/routes/desk/index.tsx`
  (Today). Other lanes add sibling files under `desk/`; the directory is
  split by file, not owned whole.
- New `src/ui/Turnstile.tsx`
- `public/**` except `public/mediapipe/**`, `public/fonts/**` and `public/strava/**` (127)
- `src/modules/auth/instance.ts`; in `create-auth.ts`, the `baseURL`,
  `rateLimit` and cookie options only (126 owns the rest of the file)
- `test/bindings-conformance.test.ts`, `test/ops/**`, `test/weather/**`
- `docs/deployment.md`, `docs/architecture.md`, new
  `docs/proposals/125-ci-migrate-before-deploy.md`
- `e2e/system/` (or the demo that `Covers:` the shell), new `e2e/desk/`

## Work

**OPS-1 · Sentry delivers [F]** (finding 0.4). `reportException` keeps the
invocation alive with `waitUntil` — from `cloudflare:workers`, or by
threading the execution context — on every path: fetch, queue, cron. A
worker test proves the send is registered with `waitUntil` rather than
merely started. Record in the runbook that delivery is proven by a test
error from a **cron** as well as a fetch.

**OPS-2 · Every digest day can alert [F]** (0.5). Fingerprint the digest
event by anomaly kind and tag it, so each day's anomalies are distinguishable
and an alert rule on the tag can fire on every event. The rule itself is a
deployment step (deployment plan §5).

**OPS-3 · Cron heartbeat [F]** (§3.5). Each of the four crons checks in.
Sentry Crons (`captureCheckIn`) or an external ping; choose in the design
doc, with the free-tier allowance of whichever you pick.

**OPS-4 · Auth in production mode [F]** (0.7; waits for #104 to merge,
because #104 edits `create-auth.ts`). `instance.ts` passes `baseURL` from
`BETTER_AUTH_URL`. `createAuth` sets `rateLimit` explicitly — enabled,
`storage: "database"` so the count is shared across isolates, with its
table (`add_auth_rate_limit`, additive, yours) — and the secure-cookie
option explicitly, so none of it depends on `NODE_ENV`. `/api/health`
reports a missing `BETTER_AUTH_URL` by name. Tests: a sign-in attempt past the
configured limit is refused, and still refused when the next request lands
on a fresh auth instance (the count lives in D1, not the isolate); the cookie carries the `__Secure-`
prefix when the base URL is https.

**OPS-5 · Turnstile [F]** (§3.6). Server-side verification (a fetch to
`siteverify` with a timeout and a zod parse, law 4; fail closed) and a
`ui/Turnstile.tsx` widget. 126 places it on sign-up and request access; you
do not edit their forms. Tests: a missing, invalid and expired token each
refused; the upstream timing out refuses rather than hangs.

**OPS-6 · Weather stops billing 24× [F]** (0.6, §1.8). One Visual Crossing
day response currently keeps one hour. Either store all 24 hours it already
paid for, or request a single datetime; measure both against a run
spanning several hour-keys and say which costs fewer records. Test: a run
spanning six hour-keys against a cold cache makes one upstream call per
day, not six.

**OPS-7 · The Desk shell and Today [F]** (decision D-35; Operator Screens
D0). `/desk` behind the existing admin check, its own shell (always dark,
hi-viz accent, desktop-first, never linked from the runner app), with the
rail entries for the pages other lanes add. Today shows the digest's
counts. This is the minimum task 110 needs to stand on; Review, Duplicates
and Runners stay 110's or the other lanes'. Tests: a non-admin gets 404,
not 403; Today's counts come from the digest's own query.

**OPS-8 · Security headers [P]** (§3.9). CSP (ship report-only first, then
enforce; MediaPipe's WASM needs `wasm-unsafe-eval`, Turnstile needs its
frame and script origin), `frame-ancestors 'none'`, Referrer-Policy,
Permissions-Policy, HSTS. Set around `startFetch` in `server.ts`. Tests:
every HTML response carries them; the photo routes do not break (e2e).

**OPS-9 · Favicon, manifest, robots, OG [P]** (§6). `public/favicon.ico` so
it stops rendering a 404 through the Worker; a web manifest; `robots.txt`
disallowing profiles and entries while the owner has not decided on
indexing (development plan, open decision 1 — 129 adds the matching meta);
`description` and OG tags in `__root.tsx`, with per-route overrides left to
the owning lane. The icon and the OG card are design asks: placeholders.

**OPS-10 · Legal pages [F]** (D-105, §1.1, §1.2). `/legal/privacy`,
`/legal/terms`, `/legal/copyright`, linked from the signed-out shell and
the landing bar. **The text is the owner's**; ask for it, and do not write
policy prose yourself. Design ask: the layout.

**OPS-11 · The digest by email [P]** (§3.5; Operator Screens D5). Today, sent
to the owner through 126's email interface when anomalies trip. Lands after
ACC-2.

**OPS-12 · The runbook and the CI proposal [F]** (§3.1, D-72). Correct
`docs/deployment.md`: `--remote` on both migration commands (confirm with
`wrangler d1 migrations apply --help`), the four missing secrets, the two
missing crons, `CLOUDFLARE_ACCOUNT_ID`, and a D1 Time Travel restore section
that covers two databases restored independently and says that
`wrangler rollback` does not roll back migrations. Write
`docs/proposals/125-ci-migrate-before-deploy.md` as the exact diff to
`ci.yml` the owner applies: migrations before deploy, deploy `needs: e2e`,
and D-72's `ADMIN_USER_IDS` line. You do not edit `.github/workflows/`.

**OPS-13 · Stale claims [F]** (§8). In `docs/architecture.md`: "photo
screening via Workers AI" (it is OpenAI); "CI applies migrations" (not
until the proposal lands); "Turnstile… WAF rate limits… These are free" (say
what is built and what is a zone rule); "Admin email/notification" (true
after OPS-11); `/health` "build info" (drop it, or ask for the
`version_metadata` binding — it is a binding).

**OPS-14 · Legacy manual weather rows [P]** (§7). `store.ts` still expects
`source='manual'` rows in `weather_observations`. Remove what reads them.
If that needs a destructive migration or a tightened constraint, **stop and
ask**: decision D-41's pre-deploy exception names `display_name` only.

## Soon-after, yours if you finish early

The Desk's dead-letter list (D6 · Gave up; design-deltas item 10), an R2
backup story beyond 126's tombstone, a client bundle size budget.

## Tests

Worker tests for OPS-1 to OPS-6 and OPS-14; ui tests for the Turnstile
widget and the Desk shell; an e2e check of the headers and the legal links.
The mutation ratchet stays at 100% on `modules/ops`, `modules/weather` and
every `.tsx` you touch.

## Demos

- **New `e2e/desk/`**: an admin opens `/desk`, sees Today; a non-admin gets
  not-found. Needs D-72's line in CI; until the owner applies it, record
  locally with `.dev.vars` and say so in the PR.
- The signed-out shell demo (`Covers:` Au/landing) gains the legal links.
