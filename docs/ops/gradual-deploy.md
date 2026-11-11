# The gradual deploy job (draft for the owner)

Design 186, #504. `.github/workflows/` is human-managed, so this is the
change for the owner to apply to `ci.yml`'s `deploy` job. It replaces the
single `Deploy` step; checkout, install, build and **Apply migrations**
stay as they are and stay first (law 8: the version still serving works
against the expanded schema).

**Before applying it:** the first deploy of a new Worker must be
`wrangler deploy` (Cloudflare: "the first upload of a new Worker must use
`wrangler deploy`"), so apply this after the first deploy has run. And the
smoke account and its two secrets (`docs/deployment.md` §9) must exist,
because the smoke step fails without them. The account is a system account,
invisible to runners (design 193), so §9's steps include marking it.

## The order, and why

1. **Upload** the version. It serves nothing.
2. **Deploy it at 0%** beside the version serving now. A version override
   reaches only a version **in the current deployment**, a 0% share
   included, so an upload alone cannot be smoke-tested
   ([version overrides](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/)).
3. **Smoke** it through the override. On failure, put the old version back
   at 100%, which removes only the 0% share no runner was sent to.
4. **10%** for ten minutes, then **100%**.
5. **`wrangler triggers deploy`**: `versions upload` does not apply cron
   triggers
   ([deployment management](https://developers.cloudflare.com/workers/versions-and-deployments/deployment-management/)).

Checked against Wrangler 4.154's source: `WRANGLER_OUTPUT_FILE_PATH`
receives a `{"type":"version-upload","version_id":…}` line, and
`deployments status --json` prints the deployment, whose `versions` carry
`version_id` and `percentage`. Re-check both on a Wrangler major bump.

**Not stated in Cloudflare's docs:** which version runs crons and queue
consumers while two are deployed. Assume either can; that is safe for the
same reasons sharing D1 is: migrations are expand→contract (law 8) and a
queue message is a wire format between two deploys (law 9).

## The steps

```yaml
- name: Upload the new version (serves nothing)
  id: upload
  run: |
    out="$RUNNER_TEMP/wrangler-output.ndjson"
    WRANGLER_OUTPUT_FILE_PATH="$out" npx wrangler versions upload \
      --tag "${GITHUB_SHA::12}" --message "main ${GITHUB_SHA::12}"
    id=$(jq -r 'select(.type == "version-upload") | .version_id' "$out")
    test -n "$id"
    echo "new=$id" >> "$GITHUB_OUTPUT"
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

- name: Note the version serving now
  id: current
  run: |
    id=$(npx wrangler deployments status --json \
      | jq -r '.versions[] | select(.percentage == 100) | .version_id')
    test -n "$id"
    echo "old=$id" >> "$GITHUB_OUTPUT"
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

- name: Deploy it at 0%, reachable only by the override
  run: >
    npx wrangler versions deploy
    ${{ steps.upload.outputs.new }}@0% ${{ steps.current.outputs.old }}@100%
    --yes --message "smoke ${GITHUB_SHA::12}"
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

- name: Install Chromium for the smoke test
  run: npx playwright install --with-deps chromium

- name: Smoke-test the new version in production
  id: smoke
  # The override can take "up to a couple of seconds" to propagate.
  run: sleep 10 && npx playwright test --config playwright.smoke.config.ts
  env:
    SMOKE_BASE_URL: https://dialed.run
    SMOKE_VERSION_ID: ${{ steps.upload.outputs.new }}
    SMOKE_EMAIL: ${{ secrets.SMOKE_EMAIL }}
    SMOKE_PASSWORD: ${{ secrets.SMOKE_PASSWORD }}

- name: Take the failed version out again
  if: failure() && steps.current.outputs.old != ''
  run: >
    npx wrangler versions deploy ${{ steps.current.outputs.old }}@100%
    --yes --message "smoke failed ${GITHUB_SHA::12}"
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

- name: Shift 10%, then 100%
  run: |
    npx wrangler versions deploy \
      ${{ steps.upload.outputs.new }}@10% ${{ steps.current.outputs.old }}@90% \
      --yes --message "10% ${GITHUB_SHA::12}"
    sleep 600
    npx wrangler versions deploy ${{ steps.upload.outputs.new }}@100% \
      --yes --message "100% ${GITHUB_SHA::12}"
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

- name: Apply cron triggers (versions upload does not)
  run: npx wrangler triggers deploy
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

Notes for the owner:

- The smoke step spells Playwright's `-c` as `--config` (owner,
  2026-11-10). knip 6.44.1's npx resolver aliases `-c` to npx's `--call`
  across every word, so with `-c` the config's path was read as a command
  and the commit gate reported an unlisted binary. The two spellings are
  the same Playwright option.

- `SMOKE_BASE_URL` is the production origin (`BETTER_AUTH_URL`). Before
  the custom domain exists, use the `workers.dev` URL.
- The ten minutes at 10% are watched by nothing yet. Rolling back on
  error rate is #505, at public. Until then, the owner watches Sentry and
  rolls back by hand (`docs/deployment.md` §9).
- "Take the failed version out" also runs if the 10% step fails partway.
  That is the right undo there too.
- The job's timeout must allow the ten-minute wait. The default (six
  hours) does.
