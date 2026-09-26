# Proposal 125: CI migrates before it deploys

**For the owner to apply.** `.github/workflows/` is a forbidden zone for
lanes, so task 125 (OPS-12) writes the change here as an exact diff and does
not make it.

## What is wrong today

Audit §3.1 item 5, confirmed against `ci.yml` on `main`:

1. **The deploy job never applies migrations.** It builds and runs
   `wrangler deploy`. The first schema-changing merge after launch deploys
   code against a database that does not have its columns yet.
   `docs/architecture.md` said CI did this; it now says it does not.
2. **Deploy waits for the unit job only** (`needs: test`). A merge whose
   browser e2e fails still deploys.
3. **The admin surfaces cannot be tested in CI** (register D-72).
   `ADMIN_USER_IDS` is read from `.dev.vars` and nowhere else locally, and
   the e2e job writes a `.dev.vars` without it — so the Desk and the review
   queue answer not-found to every e2e account, and `e2e/desk/`'s operator
   journey cannot run.
4. **Turnstile fails closed** (OPS-5), so once task 126 puts the widget on
   sign-up, an e2e job with no Turnstile secret refuses every sign-up.
   Cloudflare publishes test keys that always pass, for exactly this.

## The diff

```diff
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ e2e job @@
       - run: npm run stage:mediapipe
-      - run: echo "BETTER_AUTH_SECRET=ci-only-secret" > .dev.vars
+      # ADMIN_USER_IDS: the Desk's operator in e2e/desk (register D-72).
+      # The TURNSTILE_* pair are Cloudflare's documented always-pass test
+      # keys, so sign-up works in CI once the widget is on it (OPS-5).
+      # BETTER_AUTH_URL: overrides the production var in wrangler.jsonc so
+      # local sign-in keeps working (OPS-4). The STRAVA_* values are fake
+      # placeholders so lane 127's webhook demo runs (owner, 2026-09-26);
+      # nothing real is ever called with them.
+      - run: |
+          {
+            echo "BETTER_AUTH_SECRET=ci-only-secret"
+            echo "ADMIN_USER_IDS=e2e-desk-operator"
+            echo "TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA"
+            echo "TURNSTILE_SITE_KEY=1x00000000000000000000AA"
+            echo "BETTER_AUTH_URL=http://localhost:3000"
+            echo "STRAVA_CLIENT_ID=0"
+            echo "STRAVA_CLIENT_SECRET=ci-placeholder-not-a-secret"
+            echo "STRAVA_SUBSCRIPTION_ID=1"
+          } > .dev.vars
       - run: npx wrangler d1 migrations apply dialed-core --local
       - run: npx wrangler d1 migrations apply dialed-weather --local
       - run: npx playwright test

   deploy:
     name: Deploy to workers.dev
-    needs: test
+    # Both gates: a merge whose browser journeys fail does not ship.
+    needs: [test, e2e]
     if: github.event_name == 'push' && vars.DEPLOY_ENABLED == 'true'
     runs-on: ubuntu-latest
     steps:
@@ deploy job @@
       - name: Build
         run: npm run build

+      # Before the deploy, and core before weather, the order
+      # docs/deployment.md §1 gives. `--remote` is required: Wrangler 4
+      # applies to the local database by default, and succeeds doing it.
+      # Safe to run first because migrations are expand→contract (law 8):
+      # the version still serving works against the expanded schema, and
+      # if the deploy below fails, nothing needs undoing.
+      - name: Apply migrations
+        run: |
+          npx wrangler d1 migrations apply dialed-core --remote
+          npx wrangler d1 migrations apply dialed-weather --remote
+        env:
+          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
+          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
+
       - name: Deploy
         run: npx wrangler deploy
         env:
```

**Approved by the owner on 2026-09-26**, including the placeholder Strava
values, to be applied by task 125 as its own small PR once #104 has merged.

## What it needs besides the diff

- `CLOUDFLARE_API_TOKEN` gains D1 edit, because it now applies migrations
  (`docs/deployment.md` §7).
- `CLOUDFLARE_ACCOUNT_ID` must exist as a repository secret; the deploy step
  already reads it and §7 did not list it.
- `wrangler d1 migrations apply` in a non-interactive shell skips its
  confirmation and still takes a backup (its own `--help`), so the step does
  not hang waiting for a keypress.

## What it does not do

It does not add a staging environment or gradual deployments; both are
deployment-sweep decisions (audit §3.4). It does not change the unit job.
