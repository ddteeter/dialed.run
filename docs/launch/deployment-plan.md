# Launch deployment plan

Everything that is a **dashboard, an account, a legal registration or a
config edit** — not code — that has to happen before each stage of the
rollout. Its sibling, `docs/launch/development-plan.md`, holds the code.
This sweep starts after development lands (decision D-37).

`docs/deployment.md` stays the **runbook**: the commands, in order, for
standing the Worker up. This file is the **plan**: what has to be true at
each stage and who makes it true. Where they overlap, this file points at
the runbook rather than repeating it. Task 125 (OPS-12) corrects the
runbook first, so read it after 125 merges.

Sources: the production-readiness audit
(`docs/reconciliation/2026-09-25-production-readiness-audit.md`, cited as
§N or finding 0.N) and decisions D-37 to D-52. An `R-N` is a row in
`docs/deferred.md`.

**Who** is the owner unless it says otherwise. Where a config change needs
code, the lane that writes the code is named.

**Pending additions** from lanes sit in `docs/launch/deployment-plan/`, one
file per lane, until the next wave's docs pass folds them in here (#875).
They are part of this plan until then: read that folder with this file.

---

## Order of operations

Several steps depend on others, and doing them out of order means doing
them twice:

1. **The domain first.** The app is `app.dialed.run` and the marketing
   site `dialed.run` (D-99). Google brand verification, the email sending
   domain, the CSAM tool, WAF rules, Strava's single callback domain and
   `BETTER_AUTH_URL` all need the zone in place (§3.3). Register Strava's
   webhook and Google's redirect URIs **after** the app's host answers, or
   they are redone. `wrangler.jsonc` attaches `app.dialed.run` itself on
   deploy (a Custom Domain) and sets `BETTER_AUTH_URL=https://app.dialed.run`;
   Better Auth refuses every sign-in, sign-up and sign-out from any other
   origin (403 `INVALID_ORIGIN`). There is no workers.dev host.
2. **Apply for Strava review early.** It has the longest lead time (weeks
   reported; §1.6), but the review looks at branding, so 127's official
   Connect button (STR-7) must be live when you apply. Apply as soon as the
   friends stage is up.
3. **Squash-to-baseline, if you want it, before the first deploy.** After
   the first deploy every migration is expand→contract, and decision D-41's
   `display_name` exception expires. Check that 126's ACC-1 has merged
   before deploying anything.

---

## 1. Cloudflare account and domain

| step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | who                                          | cites             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------- |
| Workers Paid plan on the account (Email Sending requires it).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | owner                                        | decision D-42     |
| The app's host (D-99; owner, 2026-11-16): `wrangler.jsonc` routes the Worker to `app.dialed.run` as a Custom Domain, with `workers_dev` and `preview_urls` off; Cloudflare creates the DNS record and certificate on the first deploy. Before it, make sure `app.dialed.run` has **no CNAME record** (a Custom Domain cannot be created on one) and nothing else you want kept: a deploy from CI replaces any other record on that hostname without asking. Nothing here touches `dialed.run`, the marketing site.                                                                          | owner (check only; the route is in the repo) | §3.3, D-99        |
| The deploy token and the Custom Domain. Cloudflare's API reference lists **Workers Scripts Write** for `PUT /workers/domains`; no page we read states the zone-level scopes Wrangler's domain calls need, so they are unverified. If the first deploy fails at the domain step with an authentication error, either add **Zone: Read** and **Workers Routes: Edit** for the `dialed.run` zone to `CLOUDFLARE_API_TOKEN`, or attach `app.dialed.run` once in the dashboard (Workers → `dialed` → Settings → Domains & Routes) and deploy again.                                              | owner, per `docs/deployment.md` §7           | §3.3              |
| Zone settings: Always Use HTTPS; HSTS at the zone if not sent by the Worker (125's OPS-8 sends it; do not double-set with conflicting values).                                                                                                                                                                                                                                                                                                                                                                                                                                              | owner                                        | §3.9              |
| Create the D1 databases (core, weather and ops), R2 buckets and queues, replace the placeholder D1 ids. Databases and buckets take `--location enam` (`deployment.md` §1–§2; the privacy policy says North America). On `dialed-imports`, remove any whole-bucket 30-day lifecycle rule (D-110: run files are kept).                                                                                                                                                                                                                                                                        | owner, per `docs/deployment.md` §1–3         | §3.1              |
| Create the `dialed-exports` queue and its `dialed-exports-dlq` before the first deploy that binds them (any deploy of PR #132 or later).                                                                                                                                                                                                                                                                                                                                                                                                                                                    | owner, per `docs/deployment.md` §3           | decision D-86     |
| Add the one lifecycle rule on `dialed-imports`: prefix `exports/`, delete after 8 days, the net behind the hourly export sweep.                                                                                                                                                                                                                                                                                                                                                                                                                                                             | owner, per `docs/deployment.md` §2           | decision D-85     |
| Create the `dialed-guides` bucket, and an R2 API token with read-only access to that bucket alone. Add it to the `dialed.run-site` repo as `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`.                                                                                                                                                                                                                                                                                                                                                                                                     | owner, per `docs/deployment.md` §2           | R-134             |
| To create, before friends: the `dialed-evidence` bucket and its three bucket locks (`ncmec/` and `takedown/` 400 days, `register/` indefinite), and an R2 API token with Object Read & Write on that bucket alone, kept by the owner, never bound to the Worker.                                                                                                                                                                                                                                                                                                                            | owner, per `docs/deployment.md` §2           | D-148             |
| Create the `dialed-public-photos` bucket, connect `photos.dialed.run` as its custom domain (r2.dev URL off), and turn on the CSAM Scanning Tool for the zone with the owner's address for notifications, add a response-header Transform Rule setting `X-Robots-Tag: noindex` on `photos.dialed.run`, add the Cache Rule that makes every photo on `photos.dialed.run` eligible for cache with its TTLs from the origin (without it no photo is cached, so none is scanned), and register with NCMEC as an electronic service provider, before the first deploy that binds `PUBLIC_PHOTOS`. | owner, per `docs/deployment.md` §2           | D-153             |
| Confirm Workers Caching (`"cache": { "enabled": true }` in `wrangler.jsonc`) is available on the account's plan, and after the first deploy that a public page (`/kit/<id>`) answers a second request with `cf-cache-status: HIT`, a signed-in page (`/feed`) never shows `HIT`, and making that kit private shows `/kit/<id>`'s not-public page within a minute (Sentry's `edge purge refused` says when a purge was not taken). If it is not available, deploy with the setting removed: the public pages still work, uncached.                                                           | owner                                        | D-154, design 163 |
| After the first deploy, confirm a purge started outside a request lands: delete a test account that has a `world` kit (the account-deletion cron purges it) and check `/kit/<id>` stops answering `HIT` within a minute. A cron or queue handler may not count as the same entrypoint as `fetch` for a Workers Cache purge (design 163); if it does not, retracted public pages last until their 60 s TTL.                                                                                                                                                                                  | owner                                        | design 163, D-154 |
| Create the `dialed-media-backup` bucket (`--location enam`) **before the first deploy that binds `MEDIA_BACKUP`**: the binding is already in `wrangler.jsonc`, and a deploy whose bucket does not exist fails. On `dialed-media`, add the bucket lock for prefix `quarantine/`, 365 days, in place of a backup copy (#530; owner, 2026-11-09).                                                                                                                                                                                                                                              | owner, per `docs/deployment.md` §10          | D-172, design 186 |
| Observability: tracing **on** (design 165: the 2026-12-01 pricing includes 50 GB of ingest on Workers Paid; check D1 spans first, `deployment.md` §8); logs at full sample (`head_sampling_rate: 1` is fine at launch volume).                                                                                                                                                                                                                                                                                                                                                              | owner                                        | workflow.md       |
| Usage notifications for Workers, D1, R2 and Email.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | owner                                        | §3.7              |

## 2. Vars and secrets

Vars go in `wrangler.jsonc` (`vars`), secrets with `wrangler secret put`.
Both are the owner's edits; the code that reads each is already written or
is written by the named lane.

**Every name here, and in a §2 table in `docs/launch/deployment-plan/`,
is in `src/modules/ops/desk/deployment-config.ts`** (design 237), with its kind
and its "required" level, and a test holds the two together: a row added
here without an entry there fails, and so does the reverse. `/api/health` shows an operator every name as set or missing,
never a value, and the daily digest names each missing one that is
required or needed by a stage. Write each name in full, one per backtick
pair, so the test can read it.

| name                                                                        | kind   | required       | read by / written by  | without it                                                                                                                                               |
| --------------------------------------------------------------------------- | ------ | -------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_URL=https://app.dialed.run`                                    | var    | yes            | 125 · OPS-4           | Wrong-host callbacks; no `__Secure-` cookie prefix (0.7). `/api/health` reports it.                                                                      |
| `TURNSTILE_SITE_KEY`                                                        | var    | yes            | 125 · OPS-5           | No widget on sign-up or request access.                                                                                                                  |
| `CF_ACCOUNT_ID`                                                             | var    | strongly       | 165 · speed rollup    | The daily speed rollup has no SQL API to ask; the digest says so daily.                                                                                  |
| `BETTER_AUTH_SECRET`                                                        | secret | yes            | auth                  | The Worker does not start.                                                                                                                               |
| `VISUAL_CROSSING_API_KEY`                                                   | secret | yes            | weather               | Every run falls back to manual.                                                                                                                          |
| `OPENAI_API_KEY`                                                            | secret | **yes**        | screening, extraction | Every photo stays `pending`, so **no entry photo is ever public** (§3.1).                                                                                |
| `ADMIN_USER_IDS`                                                            | secret | **yes**        | admin check           | The Desk and the review queue are unreachable.                                                                                                           |
| `TURNSTILE_SECRET_KEY`                                                      | secret | yes            | 125 · OPS-5           | Sign-up and request access refuse (fail closed).                                                                                                         |
| `UNSUBSCRIBE_SECRET`                                                        | secret | before friends | 126 · ACC-2           | Fails closed: no reminder email goes, every unsubscribe link is refused. `/api/health` reports it.                                                       |
| `TAKEDOWN_SECRET`                                                           | secret | before public  | 137 · D-118           | `/takedown` matches requesters by email alone; nothing fails.                                                                                            |
| `CLOSED_ADDRESS_SECRET`                                                     | secret | before friends | 228                   | a closed account's address is not remembered; sign-up cannot refuse it.                                                                                  |
| `MODERATION_THRESHOLDS`                                                     | secret | before friends | 183 · safety          | Fails closed: every report hides at once and screening pauses. Value in the private deploy notes, not the repo.                                          |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` / `STRAVA_WEBHOOK_VERIFY_TOKEN` | secret | for Strava     | runs                  | T1 shows "not configured".                                                                                                                               |
| `STRAVA_WEBHOOK_PATH_SECRET`                                                | secret | for Strava     | 227 · SA-M6           | The webhook answers 404 to everything; the subscription call in step 5 fails its handshake. Set before that call: it is the callback URL's last segment. |
| `STRAVA_SUBSCRIPTION_ID`                                                    | secret | for Strava     | 127 · STR-4           | Every webhook event is dropped (fail closed), so no reminder goes. Set it after step 5's subscription call returns the id (D-208).                       |
| `GARMIN_API_KEY` / `GARMIN_OWNER_USER_ID`                                   | secret | owner only     | 160 · runs            | "Import from Garmin" is not drawn. The key expires on a date the owner picks: renew it before then.                                                      |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`                                 | secret | optional       | auth                  | No Google sign-in; set both or neither.                                                                                                                  |
| `SENTRY_DSN`                                                                | secret | strongly       | ops                   | Terminal failures go nowhere.                                                                                                                            |
| `ANALYTICS_SQL_TOKEN`                                                       | secret | strongly       | 165 · speed rollup    | Speed data is gone after Analytics Engine's ~3 months. Account Analytics Read only.                                                                      |
| `FIRECRAWL_API_KEY`                                                         | secret | optional       | enrichment            | Shops that refuse a Worker (11 of 14) enrich from nothing.                                                                                               |

**Owner only, not a Worker secret**: the `dialed-evidence` R2 API token
(§1, D-148), to create before friends and kept in the owner's password
manager.

**GitHub**: secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts and D1 edit,
nothing more; `docs/deployment.md` §7) and **`CLOUDFLARE_ACCOUNT_ID`**,
both in the `production` environment rather than the repository, and
variable `DEPLOY_ENABLED=true` when ready. Before applying the gradual
deploy job (`docs/ops/gradual-deploy.md`, design 186): **`SMOKE_EMAIL`**
and **`SMOKE_PASSWORD`**, the production smoke account's, in the same
environment. The account itself is the owner's to create after the first
deploy, as a **system account**, invisible to runners (design 193, #533):
`docs/deployment.md` §9's eight steps, including the one
`wrangler d1 execute` that sets `user_profiles.system_account` before
the address is confirmed. Handle `smoke_test`, "Count my runs in anonymous
totals" off, one garment with no brand, never a run. The owner's steps
are tracked as #574. **The job itself is draft PR #575** (`ci/gradual-deploy`),
exactly as `docs/ops/gradual-deploy.md` drafts it: the owner merges it only
after the first `wrangler deploy` and once #574 is done, because a new
Worker's first upload must be `wrangler deploy` and the smoke step fails
without the account. The dependency automation's App
key and Anthropic key go in their own environments
(`docs/dependencies.md` §Setup).

## 3. CI

125 writes the proposed workflow diff (OPS-12), because
`.github/workflows/` is a forbidden zone. The owner applies it:

- **Apply migrations before deploy** (`wrangler d1 migrations apply
--remote` for both databases). Today the deploy job only builds and
  deploys, so the first schema-changing merge after launch would run
  against an unmigrated database (§3.1 item 5).
- Deploy `needs: e2e` as well as `test`.
- R-72's one line: `ADMIN_USER_IDS` in the e2e job's `.dev.vars`, so the
  admin surfaces get a demo.

**Applied (#114).** `.github/workflows/ci.yml` on `main` migrates every
database `--remote` before `wrangler deploy` (core and weather since #114,
ops since design 165), the deploy job has
`needs: [test, e2e]`, and the e2e job writes `ADMIN_USER_IDS`. Nothing in
this section is left for the owner.

## 4. Email (Cloudflare Email Sending)

| step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | cites               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Onboard `dialed.run` as the sending domain; publish the SPF, DKIM and DMARC records it asks for. Choose the sender address (e.g. `hello@dialed.run`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | decision D-42, §2.3 |
| Verify the owner's address as a destination, for the digest (free to verified destinations).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | §3.5                |
| **Inbound mail**: every `@dialed.run` address forwards to the owner (D-62), and the app names three (`src/lib/contracts/contact.ts`: `hello@` is the From line, `desk@` the appeal address and moderation Reply-To, `copyright@` the DMCA contact). Onboard `dialed.run` onto **Email Routing** (Email Service → Email Routing → Onboard Domain, which adds its MX and SPF records on `dialed.run` itself; Email Sending's sit on `cf-bounce.dialed.run`, and Cloudflare manages the two separately). Then turn on the **catch-all rule**, Send to an email, to the owner's verified address. Check: a message to each of the three arrives. | D-62                |
| Check the account's daily quota against the stage: fine for the owner and friends; confirm it before public. **Fallback vendor**: note one (e.g. Postmark or Resend) and what switching costs, since the service is beta.                                                                                                                                                                                                                                                                                                                                                                                                                    | §2.3                |
| The `send_email` binding itself is added by task 126 (ACC-2) with the owner's authorisation, not in this sweep.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | decision D-42       |

## 5. Third-party accounts

The **stage** column names the first rollout stage (§11) that needs the
step: owner, friends or public.

**Strava**

| step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | stage   | cites |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----- |
| Authorization Callback Domain → `app.dialed.run` (D-99).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | owner   | §3.3  |
| Raise capacity from 1 (Single Player) to 10 with the self-serve step. **Stay at ≤10 for the friends stage.** It does: since 2026-06-01 a new Strava API app needs a subscription on the developer account (see the Extended Access row).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | friends | §1.6  |
| Register the webhook subscription (`docs/deployment.md` §6) after the domain, at `/api/strava/<STRAVA_WEBHOOK_PATH_SECRET>`; set the returned id as the secret `STRAVA_SUBSCRIPTION_ID` (D-208).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | friends | 0.10  |
| **Apply for Strava Extended Access well before public**, from the existing app, with 127's official Connect button live and the public privacy policy reachable. Start as early as the friends stage allows. Since 2026-06-01 a new Strava API app needs the developer account to hold a Strava subscription (about $11.99/mo or $79.99/yr), and there is one app per athlete account. Standard access is capped at 10 connected athletes, so it covers the friends stage only. Extended Access raises the limits and needs no subscription. The lead time is unknown, so apply early. Open question to confirm with Strava: what happens to a Standard app if the subscription lapses (undocumented). Recommended: a dedicated Strava account for the app, paid monthly until Extended Access is approved. | public  | §1.6  |
| Confirm STR-5 moved deauthorization to `/oauth/revoke` (hard deadline 1 June 2027).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | —       | §1.6  |

**Google**

| step                                                                                                                                                                             | stage   | cites |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----- |
| Authorised redirect URI `https://app.dialed.run/api/auth/callback/google`, and `https://app.dialed.run` as an authorised JavaScript origin (D-99).                               | owner   | §3.3  |
| Friends can sign in while the consent screen is in **Testing** only if each is added as a test user (limit 100). Either add them or switch now.                                  | friends | §1.7  |
| Switch the consent screen to **In production**. Non-sensitive scopes only, so verification is not mandatory.                                                                     | public  | §1.7  |
| Brand verification (name and logo on the consent screen): homepage and privacy policy on the verified domain; Search Console ownership of `dialed.run`. Allow 2–3 business days. | public  | §1.7  |

**Open conflict:** `legal-readiness-plan.md` Step 4 says Testing mode needs
no test users for `openid email profile` (A11); owner to confirm against
Google's docs; adding test users is the safe default.

**Turnstile**: create the widget (managed mode); site key as a var,
secret as a secret. Free. Its Hostnames list must hold the app's host,
`app.dialed.run`, and the marketing site's `dialed.run`: the site's
request-access form is solved there and posted to the app (#367,
`docs/deployment.md` §8's one-time steps).

**Sentry**

| step                                                                                                                                                           | cites |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Project and DSN.                                                                                                                                               | —     |
| **Alert rules**: new issue → email (the default); **plus** a rule on the digest's tag that fires on every event, so day two alerts (125's OPS-2 sets the tag). | 0.5   |
| Cron monitors, if 125 chose Sentry Crons for OPS-3 (check the plan's monitor allowance), or a healthchecks.io account if it chose a ping.                      | §3.5  |
| **Prove delivery**: a test error from a fetch and from a cron, after 125's OPS-1.                                                                              | 0.4   |

**Uptime**: UptimeRobot (or similar) on `/api/health`.

## 6. Spend caps

| vendor          | action                                                                                                                                                                                                                              | cites      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| OpenAI          | Monthly budget limit on the project, set to block, not only alert. Moderation is free; extraction is not.                                                                                                                           | §3.7       |
| Visual Crossing | Choose the plan. Free is 1,000 records a day. **Do not move to Metered until 125's OPS-6 has landed**; a metered plan cannot be capped and there is no documented daily spend cap, so the digest's backlog count is the only brake. | 0.6, §1.8  |
| Firecrawl       | The plan's credit cap is the limit; pick the plan, and set the pay-as-you-go limit if the plan has one.                                                                                                                             | §3.7       |
| Cloudflare      | A **Workers spending limit of $25 overage a month** (below), plus usage notifications for what it doesn't cover (§1 above). Email Sending: 3,000 included a month, then $0.35 per 1,000.                                            | §3.7, §2.3 |
| OpenRouter      | A credit limit on the key enrichment uses.                                                                                                                                                                                          | design 239 |
| Anthropic       | Monthly spend limit on the workspace whose key reviews dependency majors (`docs/dependencies.md` §Setup). About $1–3 a review.                                                                                                      | design 156 |

### Cloudflare Workers spending limit

Cloudflare's Spend Management (beta, launched 2026-11-13) puts a monthly
dollar limit on Workers usage. Set it before the first deploy that serves
friends. The owner chose **$25 a month of overage** (owner, 2026-11-13).

- **What it counts:** Workers overage only. The $5 Workers Paid fee and the
  plan's included requests and CPU time are deducted first. It's account-wide,
  not per Worker. It doesn't cover D1, R2, KV, Queues storage, Email Sending
  or anything else, so the §1 usage notifications stay.
- **What happens when it trips:** Cloudflare rejects every new Worker
  invocation on the account: the whole app, the queue consumers and the
  crons. Static assets still serve. It stays that way until the owner raises
  the limit above current spend, turns it off or removes it, or the billing
  period renews (on the subscription date, not the 1st). The crons are
  re-runnable and the queues keep their messages (resilience law 1), so
  raising the limit is the whole recovery. Do it the same day, inside the
  queues' message retention.
- **Alerts:** a limit with a notification email sends mail at 80% and 100%.
  A limit set in the dashboard has no email by default, so set it with the
  CLI or the API, with the owner's address.
- **Not a hard ceiling:** blocking isn't instant and the invoice can overshoot
  a little. Enforcement reaches Cloudflare's nodes asynchronously.
- **Setting it:** Billing > Spend Management > Workers > Edit the spending
  limit. With the CLI:
  `cf billing spend-policies create --name 'Workers $25 overage' --product-id workers --enabled true --threshold-cents 2500 --action usage_block`,
  plus the notification email. Through the API, use
  `POST /accounts/{account_id}/billing/spend-policies`. Either way it needs
  permission to edit billing.
- **Revisit before public:** $25 is sized for friends, where the overage
  should be about $0. A real spike at public launch could trip it and take
  the site down.

#### What the Workers limit doesn't cover

The limit stops Worker invocations only. Every other paid service below
bills on its own, keeps running after the Workers limit trips, and has its
own brake or none. A Worker that is blocked stops calling most of them, but
it stops nothing already stored or queued.

| service                             | billed for                                                                            | brake                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Cloudflare D1 (core, weather, ops)  | rows read and written, storage                                                        | §1 usage notifications only. No spending limit yet.                       |
| Cloudflare R2 (every bucket)        | storage and operations                                                                | §1 usage notifications only. No spending limit yet.                       |
| Cloudflare Queues                   | queue operations (the consumer's invocations count under Workers)                     | None of its own; check its usage in the dashboard. No spending limit yet. |
| Cloudflare Email Sending            | messages past the included 3,000 a month                                              | §1 usage notifications only. No spending limit yet.                       |
| Cloudflare Workers Analytics Engine | data points written and queried, where Cloudflare bills them (check its pricing page) | None of its own. No spending limit yet.                                   |
| Cloudflare Workers Observability    | logs and traces past the plan's included volume (design 165)                          | The sampling rate in `wrangler.jsonc`. No spending limit yet.             |
| OpenAI                              | extraction calls (moderation is free)                                                 | The project's monthly budget limit (table above).                         |
| Visual Crossing                     | weather records                                                                       | The plan; Metered has no daily cap (table above).                         |
| Firecrawl                           | product-link scrapes                                                                  | The plan's credit cap (table above).                                      |
| Anthropic                           | dependency-major reviews and the a11y transcript review in CI                         | The workspace's monthly spend limit (table above).                        |
| Sentry                              | events and cron monitors past the plan's quota                                        | The plan's quota.                                                         |

Cloudflare says more products are coming to Spend Management. When D1, R2
or Email Sending gain a limit, add one here.

Sources:

- [changelog](https://developers.cloudflare.com/changelog/post/2026-11-13-spend-management/)
- [Spend Management guide](https://developers.cloudflare.com/billing/manage/spend-management/)
- [announcement](https://blog.cloudflare.com/spend-management)

## 7. Abuse controls at the zone

- **WAF rate-limiting rules** on `/api/auth/*`, the upload server
  functions, product create, request access, `/api/strava` and
  `/api/vitals` (60 a minute per IP; design 165). This is
  the default answer to §3.6 (open decision 4 in the development plan):
  zone rules need no new binding. If the owner prefers the Workers Rate
  Limiting binding, that is a `wrangler.jsonc` binding and a lane change.
- Better Auth's own limiter is turned on in code by 125 (OPS-4).

## 8. CSAM and moderation (decisions D-69, D-70)

- **Photos on PUBLIC kits are scanned by Cloudflare's CSAM Scanning Tool**
  (D-153): a copy of each is served from the `dialed-public-photos` bucket
  on `photos.dialed.run`, through the cache the tool reads (§1,
  `docs/deployment.md` §2). The tool emails matches once a day and does
  not report to NCMEC: the owner reads each email the day it arrives, and
  files the CyberTipline report and quarantines the kit the same day
  (§2258A, "as soon as reasonably possible" after actual knowledge). The
  bullets below are about every other photo.
- **Every other photo is private behind sign-in, and none reaches
  Cloudflare's cache** (D-69). Cloudflare's CSAM Scanning Tool compares only "content
  served for your website through the Cloudflare cache"
  ([docs](https://developers.cloudflare.com/cache/reference/csam-scanning/)),
  and a response a Worker builds never enters it, so turning the tool on
  today scans nothing of ours. What every photo has is upload-time
  screening (task 106) and the quarantine below.
- **Decided (D-129): PhotoDNA, with Thorn's Safer as the fallback.** The
  two candidates were:
  - **A separate public R2 bucket on a custom domain, with caching on**
    ([R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)),
    so public-entry photos are served from Cloudflare's cache where the
    tool can scan them, with access kept to signed-in viewers by a WAF
    token-authentication rule
    ([WAF token authentication](https://developers.cloudflare.com/waf/custom-rules/use-cases/configure-token-authentication/));
    a bucket, a domain and a zone rule, so a `wrangler.jsonc` and dashboard
    change.
  - **PhotoDNA**, by application to Microsoft
    ([PhotoDNA](https://www.microsoft.com/en-us/photodna)), matched at
    upload beside the classifier.
- **Quarantine is silent and preserves for a year** (D-70). Remove as
  suspected CSAM sends the uploader nothing, hides the content at once,
  and keeps the rows (entry, items, tags, photos, uploader, upload time)
  in `quarantined_content` and the bytes under `quarantine/` for 365 days,
  readable only by an admin. The daily digest's firing purges each record
  and its copies once `retain_until` passes (task 128 PR 2b), silently. A
  record that must be kept longer (a legal hold) needs its `retain_until`
  moved on by hand before then.
- **The owner reports to NCMEC's CyberTipline by hand**, following the
  procedure below. 18 U.S.C. §2258A requires a report on actual knowledge,
  and preservation.
- **Write the NCMEC reporting procedure** (owner, about 2 h; §1.10). It
  should say:
  - who may look at a flagged image (an admin, through the review route
    only), and that it is never forwarded or downloaded;
  - how to register as an electronic service provider with NCMEC and file a
    CyberTipline report, from the `quarantined_content` record;
  - that quarantine rather than delete is the control (SAF-5, D-70), kept a
    year — confirm the figure with counsel;
  - that the account is banned (SAF-4).

## 9. Legal

The owner's legal-readiness items (LLC publication, EIN and bank account,
the Google Voice number, NCMEC ESP registration, the DMCA designation in
the LLC's name, PhotoDNA, the Sentry DPA, the Strava 9,999 request, Google
brand verification, the trademark knockout search, the UK OSA
assessments) are listed by stage in
[`legal-readiness-plan.md`](legal-readiness-plan.md) step 4, with the
decisions behind them (D-125 to D-139). The table below is the earlier
audit's list; where the two differ, the plan is current.

| item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | stage   | cites            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------- |
| **Privacy policy text**, GDPR-grade (Strava §7.3 requires it whatever the geography): what we collect, lawful bases, retention, rights (erasure, export — 126 builds both), the processors below, the Strava paragraph (the grant and an activity id per reminder, never activity data; pruned after 7 days), the cookie paragraph (strictly necessary only; no banner while no analytics are added, §1.5). 126's ACC-13 publishes it. **A draft exists** (`docs/legal/privacy-policy.md`, PR #109) with every factual claim mapped to code; the owner's job is the `[OWNER: …]` blanks (no lawyer's read, D-122) and re-checking the claims the launch lanes change (deletion, export, blocks, coordinates).                                                                                                                                                                                                                                                                                                       | friends | R-105, §1.4–§1.6 |
| **Terms of service**: content licence, acceptable use, termination (the basis for a ban), not-safety-advice disclaimer, limitation of liability, **minimum age** (18+, D-114; the date of birth is asked at sign-up and not kept). 126's ACC-6 adds acceptance under the sign-up form.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | friends | §1.1, §1.3       |
| **DMCA designated agent**: register with the Copyright Office ($6, renew every three years; set a reminder), with a contact address (decide whether a P.O. box or a registered-agent address is acceptable). The contact goes on 126's `/copyright` page (ACC-13).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | public  | §1.2             |
| **Processor agreements (GDPR Art. 28)**, checked 2026-10-17 (D-122). Already in force by accepting the terms: Cloudflare (customer DPA in the Self-Serve Subscription Agreement: SCCs, UK Addendum, DPF; covers Email and Turnstile), OpenAI (DPA incorporated in the Services Agreement, SCCs and UK Addendum; not DPF-certified), Google (independent controller for sign-in; DPF and controller terms via the Google APIs Terms). Strava (independent controller of the runner's own account; it receives only the connect and revoke requests the runner starts). **To do: accept Sentry's DPA** (sentry.io/legal/dpa): its terms forbid sending personal data until one is in place, and its DPF certification covers the transfer once it is. No DPA exists or is needed while they receive nothing identifying: Visual Crossing (rounded places and dates, sent from the Worker), Firecrawl (product links; its free plan has no DPA), Have I Been Pwned (a 5-character hash prefix). The policy names each. | public  | §1.4             |
| **Art. 27 EU representative and the UK equivalent**: decided, none appointed (D-115, an accepted risk; no counsel, D-122).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | public  | §1.4             |
| **EU DSA**: a single point of contact for users and authorities (a page or the policy); the notice-and-action mechanism exists (reports), and 128's SAF-8 carries the statement of reasons. Verify with counsel.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | public  | §1.4             |
| **UK Online Safety Act**: the illegal-content risk assessment and the children's-access assessment for a user-to-user service with UK users. Keep the written record.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | public  | §1.4             |
| Counsel's read of the above. The audit's author is not a lawyer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | public  | —                |

## 10. Backups and recovery

- **D1 Time Travel** is on by default (30-day point in time). Record, in the
  runbook 125 writes (OPS-12), that `restore` overwrites in place, that
  `dialed-core` and `dialed-weather` restore independently (so pick one
  timestamp for both, and expect weather rows newer than core to be
  harmless cache), and that `wrangler rollback` does not roll back
  migrations.
- **Do a restore drill** on a scratch database once before friends.
- **A data export too large to build** (PR #1033): the digest names the
  runner, and the screen promises a copy made by hand. The script and the
  way the copy reaches the runner are #1180, before public.
- **Deploys are gradual** after the first one (design 186, #504): upload,
  0% plus a production smoke test through the version override, then
  100% (no 10% soak until #505 can watch one; owner, 2026-11-10). Rolling
  back is one command. The job, the smoke account and
  the rollback steps are in `docs/deployment.md` §9, and the job draft is
  `docs/ops/gradual-deploy.md`, which the owner applies to `ci.yml`.
- **R2 has no versioning**, so the daily digest copies garment and entry
  photos into `dialed-media-backup` (D-172, design 186), and a deleted
  photo's copy leaves 30 days later (#529). `quarantine/` is locked with
  an R2 bucket lock instead of copied (#530). The bucket and
  the lock are the owner's steps, before friends: `docs/deployment.md`
  §10.

---

## 11. Rollout gates

Each gate is a checklist the owner runs. Everything in the development
plan is merged before stage 0 (decision D-37); the markers there say which
items each gate depends on if that ever slips.

From the first deploy on, every merged security fix is deployed at once
(D-204; `docs/deployment.md` §9, "Security fixes").

### Stage 0 — the owner alone

- `app.dialed.run` serves the app; `/api/health` is all `ok`.
- Both databases migrated with `--remote`; the four crons listed under
  Triggers; the six queues have consumers.
- Every required secret and var in §2 set; `BETTER_AUTH_URL` is the domain.
- **Sentry proven** from a fetch and a cron; the digest alert rule and the
  cron heartbeat in place; uptime ping on.
- Email: the domain onboarded; a verification email and a password reset
  received end to end; a message to `hello@`, `desk@` and `copyright@`
  each reaches the owner (§4, D-62).
- Strava: callback domain set, webhook subscribed, `STRAVA_SUBSCRIPTION_ID`
  set; connect, disconnect and a revoke that **succeeds on Strava's side**
  (127's STR-1/2).
- Spend caps set, including the Workers spending limit with its
  notification email (§6); Visual Crossing plan chosen.
- **Change password's CPU time measured** on the deployed Worker (D-98,
  R-124): it checks the current password twice, once for the per-runner
  count and once inside Better Auth's endpoint, so it is the most
  expensive request the app serves. Change a password a few times and
  read the request's CPU time in the Worker's logs. If it is near the
  plan's per-request CPU limit, raise it with the owner before friends.
- A Time Travel restore drill done once.
- **The owner's account, through the invite gate** (126 · ACC-5). Sign-up
  needs a code from the start, and there is no Desk before there is an
  operator, so the first code is a deployment step, not a migration (a
  code in the repo would be a public way in). A code is `DIAL-` and two
  groups of four (design 225), so pick eight characters from
  `INVITE_ALPHABET` (`src/lib/contracts/access.ts`), upper case, and
  store them with both hyphens, as `normalizeInviteCode` writes a code:
  sign-up refuses any other shape. Run, once:
  `npx wrangler d1 execute dialed-core --remote --command "INSERT INTO invite_codes (id, code, label, max_uses, created_at) VALUES ('owner-seed', 'DIAL-XXXX-XXXX', 'owner', 1, unixepoch())"`.
  Sign up with it, then put the new account's id in `ADMIN_USER_IDS`;
  every later code comes from Desk D7.

#### Platform checks at the first deploy

Each reads one thing the local runtime cannot show, and is noted where the
owner keeps the deploy record. Lane 15a listed them (2026-11-18).

- **A public photo is served from the cache.** Make one kit public, open
  one of its photos at `photos.dialed.run` twice, and read the second
  answer's `cf-cache-status`: it is `HIT`. Anything else (`DYNAMIC`,
  `BYPASS`) means the Cache Rule (`docs/deployment.md` §2, step 6) is
  missing or does not match, and the CSAM Scanning Tool scans no photo
  until it does. Note its `cache-control` too: `public, max-age=60`. Then
  make the kit private, and within a minute the photo's URL answers 404.
- **What a stored log line holds** (#902, design 244). Request any page
  with a query string, `/?probe=1`, and read its line in Workers Logs: the
  URL is there without `?probe=1` (`observability.redact_query_string`).
  Note what else the line holds.
- **A refused send carries a `code`** (#902, design 244).
  `deliverOwedEmail` (`src/modules/email/deliver.ts`) reads a string `code`
  on the error Cloudflare's send throws, and the tests make that error by
  hand. To produce one, sign up a test account (a code from D7) at an
  address that does not exist on a domain the owner controls (not
  `dialed.run`, whose catch-all takes everything), so its verification
  email bounces, then ask for the verification email again. Once
  Cloudflare has suppressed the address, the send
  throws `E_RECIPIENT_SUPPRESSED`. Read the error in Workers Logs and note
  its `code` and message. If the address is never suppressed, the first
  real refusal is the check: the outbox reports it with the sender's code.
  Delete the test account afterwards.
- **One Garmin import** (PR #275). With `GARMIN_API_KEY` and
  `GARMIN_OWNER_USER_ID` set, import one run from Garmin as the owner and
  note whether it lands credited to Garmin. Every path to Garmin has run
  only locally so far.
- **Secrets before the first upload.** Cloudflare runs the Worker's start-up
  code on upload and rejects a failure with code 10021; the auth instance is
  built at start-up and needs `BETTER_AUTH_SECRET`. Set §2's secrets first,
  and on a 10021 read which value start-up found missing.
- **Email sending quota.** Read the account's daily sending quota in the
  Email Service dashboard; Cloudflare publishes no number.
- **One cron firing.** In Workers Logs, the `:30` firing's subrequest count
  and how many Sentry events it sent.
- **Strava rate limits.** Whether token exchanges count toward the app's
  rate limit, and whether a disconnected athlete still counts toward its
  capacity.
- **Desk Review's slowest query** at production size, against D1's
  30-second limit.
- **One email sign-in's CPU time** (one password hash), from its invocation
  log.
- **D1's stored-value limit.** Production refuses a value over 2 MB with the
  same error local D1 gives (local's own limit is 2.2 MB).
- **Weather with no data.** What the provider answers for a place or date it
  has no data for.
- **Sentry volume.** The plan's event volume and retention against a normal
  day's events.
- **The first Dependabot security PR.** Its body carries the phrase the
  classify step reads, and the metadata step outputs the dependency group.
- **One run of each review job.** The egress probe's result after
  `harden-runner` starts.

The owner's private deploy checklist holds the rest of the run-at-deploy
checks; run it beside this list.

### Stage 1 — invited friends

Everything in stage 0, plus:

- Every **[F]** item in the development plan is on production.
- The privacy policy and terms are published and linked; the sign-up form
  records acceptance.
- Invite codes issued from the Desk; request access reachable and
  Turnstile-guarded. The owner's own account is seeded (126 · ACC-5).
- Strava capacity raised to 10, and **no more than 9 friends connect
  Strava**: the owner's own connection is the tenth (D-128), and the next
  sees 127's STR-6 message.
- Google: each friend added as a test user, or the consent screen switched
  to In production. (Open conflict with `legal-readiness-plan.md` Step 4;
  see §5's Google table.)
- **D1's replicas serve reads** (design 143). During the first friends
  week, read the per-region metrics of `dialed-core` and `dialed-weather`
  in the D1 dashboard: some reads are served by a replica, not all by the
  primary. If none are, check read replication is on (`docs/deployment.md`
  §1).
- A photo uploaded from a phone has **no GPS in the served bytes** (128's
  SAF-1); check with an EXIF reader.
- The **VoiceOver checklist** (`docs/launch/voiceover-checklist.md`, plan 161) run on a real iPhone, its run recorded there, and each failure fixed
  or deferred with the owner's decision.

### Stage 2 — the public

Everything in stage 1, plus:

- Every **[P]** item in the development plan is on production.
- **Strava review approved** for the capacity you expect. This is the gate
  most likely to hold the date.
- Google consent screen In production; brand verification done.
- CSAM coverage decided and in place (§8's open item); the NCMEC
  procedure written and read.
- DMCA agent registered and the contact published.
- **Turn on the marketing site's `SITE_INDEXABLE`** (D-99, amending D-53):
  the marketing host, `dialed.run`, becomes indexable; the app,
  `app.dialed.run`, is never indexed, so its own `noindex` default
  (`modules/ops/public-web/og/site-head.ts`) stays as it is.
- **Decide whether to flip the invite flag** (126 · ACC-5): leaving it on
  keeps public sign-up invite-only; flipping it removes the code field and
  the request link.
- Processor agreements executed; EU/UK representative decision made; DSA
  contact published; UK OSA assessments written.
- WAF rate-limiting rules live.
- **Enforce the Content-Security-Policy** (decision of 2026-10-11, recorded
  in `docs/launch/before-public-plan.md`): once the friends stage's CSP
  reports are clean, a one-line PR renames `CSP_HEADER` in
  `modules/ops/edge/security-headers.ts` to `Content-Security-Policy` and the
  matching line in `public/_headers`, folding in the four directives
  already enforced beside it. Until then the report-only policy reports to
  `/api/csp-report`, so the friends stage needs `SENTRY_DSN` set to see
  them.
- The R-45 copy pass done with design (every placeholder string these lanes
  shipped has been read by a human).
- The VoiceOver checklist run again, on the build going public.
