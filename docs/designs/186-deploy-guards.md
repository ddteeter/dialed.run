# Design: 186 deploy guard rails and the R2 backup

## Problem

There is no staging (D-171, #419), so production deploys need guard rails:
a new Worker version is uploaded, proven by a smoke test that no runner
sees, then given traffic in steps, with a runbook for undoing it (#504).
And nothing copies garment and entry photos anywhere, so a bad delete or
overwrite loses them for good (#420, D-172: a daily copy into a second
bucket).

## Approach

**PR 1 (#504): runbook, smoke spec, workflow draft.**

- Cloudflare's docs set the order: a version override reaches only a
  version **in the current deployment** (a 0% share counts), so it is
  upload → deploy `new@0% old@100%` → smoke via
  `Cloudflare-Workers-Version-Overrides: dialed="<id>"` → `new@10%` →
  `new@100%` → `wrangler triggers deploy` (upload applies no crons).
  A failed smoke deploys `old@100%`, which undoes only the 0% share.
- `/api/health` gains `version` (the `CF_VERSION_METADATA` id). An override
  that is not applied falls back silently to the old version, so the smoke
  spec's first check is that the version it reached is the one uploaded.
- `playwright.smoke.config.ts` + `e2e/smoke/production.smoke.ts`: no web
  server, `baseURL` and the override header from env, read-only: health
  and version, the signed-out landing, log in as the seeded smoke account,
  its closet shows its garment. Log-in has no Turnstile (sign-up only).
- The job change is a draft in `docs/ops/gradual-deploy.md` for the owner
  to apply to `ci.yml`; `.github/` is not edited.
- `docs/deployment.md` §9 becomes "Deploying, rolling back and restoring".

**PR 2 (#420): `ops/media-backup.ts`, a daily-digest kind `media-backup`.**

- Lists `MEDIA` and `MEDIA_BACKUP` and diffs them, so it needs no
  checkpoint and is re-runnable (law 1). Copies an object when the backup
  lacks its key or its `sourceEtag` custom metadata differs (new or
  changed). Prefixes copied: `items/`, `entries/` only, read from the
  `src/lib` photo-key helpers. Not `quarantine/` (see Q2), `products/`
  (re-fetchable) or `health-probe`.
- A backup object whose source is gone moves to `gone/<key>` (its upload
  time then marks when it went), and a `gone/` object older than 30 days
  is deleted. A runner's deletion therefore reaches the backup within ~31
  days instead of never.
- A per-firing cap on copies; the remainder is next day's, reported.
- Unbound `MEDIA_BACKUP` (declared optional until the binding lands):
  the digest says the backup is not configured (law 5).

## Contract touches

- Schema changes: **none**.
- New route files: none.
- New bindings: **`MEDIA_BACKUP` → `dialed-media-backup`** (owner's, D-172).
  New GitHub secrets: **`SMOKE_EMAIL`, `SMOKE_PASSWORD`** (owner's).
- Screens: none. `/api/health` adds a field.

## Test plan

- vitest worker: `test/ops/health.test.ts` pins `version`;
  `test/ops/media-backup.test.ts` copy/changed/skip-quarantine/gone/expiry/cap;
  `test/bindings-conformance.test.ts` pins `MEDIA_BACKUP`; scheduled test
  for the digest kind.
- Playwright smoke spec: the one test that can only run against a deployed
  version. Not in CI's e2e projects; run once locally against preview.

## Issues

- Closes: #504 (PR 1), #420 (PR 2).
- Opens: owner questions Q1, Q2.

## Open questions

1. **Backup retention vs. the privacy policy** (guess: 30 days in `gone/`,
   plus a policy row, drafted for approval).
2. **`quarantine/`** (guess: not copied; an R2 bucket lock on that prefix
   as the owner's dashboard step instead).
3. Unverified in the docs: the upload's version id in machine form
   (`WRANGLER_OUTPUT_FILE_PATH`), and which version runs crons and queue
   consumers mid-shift. The draft marks both; laws 8 and 9 cover either.
