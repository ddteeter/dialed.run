# Design: 001 e2e testing + demo videos

> Exceeds the template's one-page cap. The video layer is small; the
> foundation under it (local enablement, seeding, determinism) is the real
> work and every lane inherits it. Split on request.

## Problem

dialed is a user-facing app whose entire e2e suite is one `smoke.spec.ts`.
Per-feature end-to-end coverage is table stakes. Separately, PR review is the
hard gate and spends its attention on product correctness against
`docs/product.md` — the thing a diff shows worst. One foundation serves both:
a deterministic happy-path e2e spec per feature, recorded to video and
attached to the PR.

The demo video is a four-line addition on top. Everything below it is the
part that needs deciding.

---

## 1. Local enablement — and a bug in today's config

`playwright.config.ts` runs `npm run dev` (hardcoded `--port 3000`) with
`reuseExistingServer: true`. With four lane worktrees running concurrently:

- Lane 101 starts a dev server on 3000.
- Lane 102 runs Playwright. It finds something answering on
  `localhost:3000`, **reuses it**, and runs lane 102's tests against lane
  101's code.

That is silent cross-worktree contamination — green tests proving nothing.
It exists today, independent of demo videos.

**Fix.** Port becomes per-worktree and reuse becomes loud:

- `package.json`: `"dev": "vite dev --port ${PORT:-3000}"`
- `playwright.config.ts` resolves a port as: `DIALED_E2E_PORT` if set, else
  `3000 + N` parsed from a `lane/<N>-*` branch name, else 3000. It passes
  that through `webServer.env.PORT` and builds `baseURL` from it.
- `reuseExistingServer: false`. With unique ports per worktree there is
  nothing legitimate to reuse, and a busy port should fail loudly rather
  than silently test the wrong tree.

CI is unaffected — a fresh runner, no branch prefix, port 3000.

## 2. Seed data

Three facts constrain this:

- Vitest tests run under `@cloudflare/vitest-pool-workers` against a
  **miniflare instance seeded by `test/apply-migrations.ts`** — a different
  D1 from the one `vite dev` uses. None of that seeding transfers to e2e.
- E2E hits the dev server's local D1 under `.wrangler/state/v3/d1/…`.
- Today's only seeding is UI-driven: sign up as
  `smoke-${Date.now()}@example.com`. That cannot build a closet of 20
  garments or a feed containing other people's posts.

**Decision: seed through `getPlatformProxy()`** (wrangler 4.129.0). State
sharing with the dev server is verified in both directions: rows written from
Node are readable by `wrangler d1 execute --local`, and rows the dev server
writes (a Playwright signup) are readable from Node. Concurrent access while
the dev server is running works — no SQLite lock contention. A Node-side helper opens the *same* local
bindings the dev server uses and writes with Drizzle and the real schema:

```ts
// e2e/support/seed.ts
const { env, dispose } = await getPlatformProxy<Env>();
const db = drizzle(env.DIALED_CORE);
await db.insert(wardrobeItems).values(garmentSchema.parse(…));
await dispose();
```

Why this over the alternatives: raw `wrangler d1 execute --local` means
hand-written SQL that bypasses `garmentSchema` and rots against schema
changes; opening the `.sqlite` file directly depends on a wrangler-internal
path; a dev-only seed *route* would ship test-only code paths inside the
app. `getPlatformProxy` is a supported API, is typed, reuses the contracts,
and adds nothing to the deployed Worker.

Seeding runs in Playwright `globalSetup`, and per-feature fixtures compose
on top of it.

## 3. Auth state

Signing up through the UI in every spec is slow and re-tests signup for no
reason. A `globalSetup` signs up one user per feature suite and saves
`storageState`; specs adopt the cookie and start authenticated. The auth
demo keeps exercising the real signup path, because there it *is* the
feature under test.

## 4. Determinism

- **Weather.** `weather_observations` carries
  `UNIQUE(lat_r, lng_r, hour_bucket)` — the cache key (contracts.md §243).
  Seeding an observation at the demo's rounded lat/lng/hour makes the
  weather module hit cache and never reach Visual Crossing. No network
  stub, no quota burn, real code path. Browser-level `page.route()` cannot
  do this — the fetch happens server-side in the Worker.
- **Identity.** Unique per-test users (today's `Date.now()` idea, kept) so
  parallel workers sharing one local D1 cannot collide.
- **Time.** Seed timestamps relative to run time so relative-date copy
  ("FROM 43° DAMP, AUG 14") stays stable.
- **Motion.** Demo specs disable CSS animations so recordings diff cleanly
  and don't capture mid-transition frames.

## 5. Layout and the demo spec

`e2e/<feature>/` directories named by durable product feature, **not by
lane**. Lanes are scaffolding; features outlive them. Concretely: the v1
logging loop (A1 → A2/A2b → A3) spans lanes 102 and 104, so lane
directories would split the most valuable journey in the product in half.

Each feature directory holds exactly one `*.demo.spec.ts` — the happy-path
journey, carrying real assertions, **video on** — plus any number of
`*.spec.ts` edge-case specs with **video off** (30 validation tests make an
unwatchable video).

**As built:** a demo spec holds exactly one `test()`. Playwright records one
video per test, so the first cut of `auth.demo.spec.ts` (two tests) produced
two videos and left no answer to "which one does the reviewer watch". The
standalone assertion moved to `e2e/auth/home.spec.ts`; one journey now yields
one video.

The feature set grows organically; agents add directories as needed. Seeds
from the `docs/product.md` screen inventory: `logging-loop/` (A1, A2, A2b,
A3), `closet/` (C, F), `onboarding/` (O1, O3, O5/O6, P2.5), `feed/` (E1,
E2, D, G, H), `auth/` (today's smoke test).

**Coherence guard instead of a central registry.** Each demo spec opens
with `/** Covers: <screen IDs> */`. Screen IDs are the authority; directory
names are labels and may be renamed. Before creating a new feature
directory, grep `Covers:` across `e2e/**/*.demo.spec.ts` — if a screen you
would cover is already owned, extend that demo. This is what stops four
parallel lanes from independently producing `feed/`, `social/`, and
`following/`.

Playwright gains a second project matching `**/*.demo.spec.ts` with
`video: 'on'` at 1280×720; the default project excludes it so the
edge-case suite stays fast.

## 6. Re-recording trigger

Diff-derived, not packet-derived: if `git diff --name-only origin/main...HEAD`
contains any `.tsx`, or any `.css` under `src/ui/`, the demos covering the
affected screens are re-run and re-attached. UI reaches users through
`src/ui/` and module components, not only `src/routes/`.

## 7. Delivery

The agent records locally at PR time, transcodes VP8 WebM → H.264 MP4, and
attaches with `gh pr create --body-file … --attach demo.mp4`. MP4 rather
than WebM because review is phone-friendly by design and VP8-in-WebM
playback on iOS Safari is unreliable. **CI is unchanged** — no workflow
edits, no runner `gh` dependency. Encoded in
`.claude/skills/pr-demo-video/SKILL.md`.

---

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none** (`getPlatformProxy` reads the existing
  local bindings from a Node process; nothing is added to the Worker)
- Screens implemented: none — test/workflow infrastructure
- Shared files, so a micro-task on main per workflow.md merge discipline:
  `playwright.config.ts`, `package.json`, `CLAUDE.md`, `e2e/` layout,
  possibly `knip.json`
- Host prerequisites, not code: `gh >= 2.99.0` for `--attach` (released
  2026-09-01; this machine has 2.96.0) and `ffmpeg` (not installed)

## Test plan

- `e2e/auth/auth.demo.spec.ts` — relocate today's `smoke.spec.ts`,
  assertions unchanged, `data-hydrated` marker preserved. Integration.
- `e2e/support/seed.ts` — seeds a user + garments through Drizzle; asserted
  by a throwaway spec that reads them back through the UI.
- Port resolution: two worktrees on different `lane/<N>` branches run
  concurrently and each hits its own server. Manual, once — this is the bug
  above, so it needs an explicit check.
- Weather cache seeding: an entry saves with `weather_status='attached'`
  and no outbound fetch occurs.
- `npm run demo` writes `test-results/**/video.webm`; `npm run e2e` runs the
  edge suite with no video.
- Verified already: knip's `e2e/**/*.spec.ts` entry glob covers nested
  directories; dependency-cruiser walks `src/` only, so e2e cannot trip the
  boundary gate; `.gitignore` already ignores `test-results/`.

## Open questions

1. Task id `001` is invented — there is no packet for this. Rename if you
   have a convention for cross-cutting infra.
2. `e2e/support/seed.ts` is not a `.spec.ts`, so knip's entry glob may not
   cover it. Small `knip.json` change, or name it `*.spec.ts`-adjacent —
   needs a check against the commit gate.
3. Do the four in-flight lanes backfill demos for work already underway, or
   does this apply only to PRs opened after it lands?
4. `logging-loop/` spans lanes 102 and 104. Whichever merges first creates
   the directory and the other extends it — acceptable, or should one lane
   own it?
5. The port fix is a live bug affecting lanes running right now. Land it
   ahead of the rest of this design, as its own commit?
