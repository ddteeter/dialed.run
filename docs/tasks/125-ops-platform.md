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
- New `src/routes/og/**` (the share-card renderer, OPS-16)
- `src/ui/form.tsx` and `src/ui/a11y.css`, **for the focus ring only**
  (OPS-15)
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
rail entries for the pages other lanes add (126's D7 Access, 128's ban panel and Runners; round 26 #20). Today shows the digest's
counts. This is the minimum task 110 needs to stand on; Review, Duplicates
and Runners stay 110's or the other lanes'. Tests: a non-admin gets 404,
not 403; Today's counts come from the digest's own query.

**OPS-8 · Security headers [P]** (§3.9). CSP (ship report-only first, then
enforce; MediaPipe's WASM needs `wasm-unsafe-eval`, Turnstile needs its
frame and script origin), `frame-ancestors 'none'`, Referrer-Policy,
Permissions-Policy, HSTS. Set around `startFetch` in `server.ts`. Tests:
every HTML response carries them; the photo routes do not break (e2e).

**OPS-9 · Icons, manifest, robots [P]** (§6; round 26 #22, now drawn). "[d]":
pink brackets and a paper d on an ink tile, brackets only at 16. `favicon.svg`,
`favicon.ico` 16/32 (so `/favicon.ico` stops rendering a 404 through the
Worker), apple-touch 180, manifest 192/512 plus a 512 maskable, `theme_color`
`#0B0B0E`; `robots.txt`
disallowing profiles and entries while the owner has not decided on
indexing (development plan, open decision 1 — 129 adds the matching meta);
`description` and default OG tags in `__root.tsx` (pointing at OPS-16's
default card), with per-route overrides left to the owning lane.

**OPS-10 · moved to 126 (ACC-13).** The owner assigned the privacy page to
126 (decision D-52), and the terms and copyright pages went with it.

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

**OPS-13 · `docs/architecture.md` corrected [F]** (§8; D-111, found by PR
#109). Photo screening is OpenAI `omni-moderation-latest`, not Workers AI;
product extraction is OpenAI plus Firecrawl; photos are not served from
"public bucket URLs" (the Worker serves them, and after 128's SAF-7 through
signed URLs); Turnstile has no code until OPS-5; "CI applies migrations" (not
until the proposal lands); "Turnstile… WAF rate limits… These are free" (say
what is built and what is a zone rule); "Admin email/notification" (true
after OPS-11); `/health` "build info" (drop it, or ask for the
`version_metadata` binding — it is a binding).

**OPS-15 · The FormField focus ring [P]** (round 26 #16; decision D-48).
Outline 2px ink at offset −1px, on the field border, so a focused field
shows one line; error is the 2px border plus the band, and the band is what
tells error from focus. **FormFields only**: every other control keeps
Accessibility Contract §06's offset 2px. You own `ui/form.tsx` and
`a11y.css` for this change and nothing else in them. Tests: the focused
field's computed outline offset; a button's is unchanged.

**OPS-16 · OG share cards [P]** (round 26 #22; decision D-51). Render in the
Worker: the default card ("What to wear for the run you're about to do.",
titled "dialed.run") and the per-entry card, 1200×630 — wordmark, date,
conditions, verdict chip (hue plus word), distance/feels/wind, kit and
@handle; **never the photo**, note, route or flags. A private, deleted,
banned or unverified entry gets the default. **First, measure the library**
(workers-og, satori + resvg, or similar): bundle size, WASM size, cold-start
and CPU per render, against the Worker's limits; put the numbers in your
design doc and ask if they are large. Cache the rendered card. The entry
data comes through feed's index; 129 adds the page meta (FEED-14). Tests:
each excluded state gets the default; the card never contains the photo.

**OPS-14 · Legacy manual weather rows [P]** (§7). `store.ts` still expects
`source='manual'` rows in `weather_observations`. Remove what reads them.
If that needs a destructive migration or a tightened constraint, **stop and
ask**: decision D-41's pre-deploy exception names `display_name` only.

## Soon-after, yours if you finish early

The Desk's dead-letter list (D6 · Gave up; design-deltas item 10), an R2
backup story beyond 126's tombstone, a client bundle size budget.

## Tests

Worker tests for OPS-1 to OPS-6 and OPS-14; ui tests for the Turnstile
widget, the Desk shell and the focus ring; worker tests for OPS-16's card
selection; an e2e check of the headers.
The mutation ratchet stays at 100% on `modules/ops`, `modules/weather` and
every `.tsx` you touch.

## Demos

- **New `e2e/desk/`**: an admin opens `/desk`, sees Today; a non-admin gets
  not-found. Needs D-72's line in CI; until the owner applies it, record
  locally with `.dev.vars` and say so in the PR.
- The auth demo shows the FormField focus ring (OPS-15).
