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

---

## Order of operations

Several steps depend on others, and doing them out of order means doing
them twice:

1. **The custom domain first.** Google brand verification, the email
   sending domain, the CSAM tool, WAF rules, Strava's single callback
   domain and `BETTER_AUTH_URL` all need `dialed.run` in place (§3.3).
   Register Strava's webhook and Google's redirect URIs **after** it, or
   they are redone. **It is a hard prerequisite of the first deploy**:
   `wrangler.jsonc` sets `BETTER_AUTH_URL=https://dialed.run` (task 125,
   OPS-4), and Better Auth then refuses every sign-in, sign-up and
   sign-out from any other origin (403 `INVALID_ORIGIN`), workers.dev
   included, and builds OAuth `redirect_uri`s on `dialed.run`. Attach the
   domain before deploying, or set `BETTER_AUTH_URL` to the workers.dev
   origin until it is attached.
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

| step                                                                                                                                                                                                                                                                                                                             | who                                                                                                                                               | cites             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Workers Paid plan on the account (Email Sending requires it).                                                                                                                                                                                                                                                                    | owner                                                                                                                                             | decision D-42     |
| Route the Worker to `dialed.run`: a `routes` entry with `custom_domain: true` in `wrangler.jsonc` (the zone is already on Cloudflare DNS).                                                                                                                                                                                       | **the sweep**: a `wrangler.jsonc` edit, which is human-managed; no lane touches it. Rename the CI job "Deploy to workers.dev" in the same change. | §3.3              |
| Decide whether `workers.dev` stays enabled. Recommend off once the domain works, so there is one origin for cookies.                                                                                                                                                                                                             | owner                                                                                                                                             | §3.3              |
| Zone settings: Always Use HTTPS; HSTS at the zone if not sent by the Worker (125's OPS-8 sends it; do not double-set with conflicting values).                                                                                                                                                                                   | owner                                                                                                                                             | §3.9              |
| Create the D1 databases, R2 buckets and queues, replace the placeholder D1 ids. Databases and buckets take `--location enam` (`deployment.md` §1–§2; the privacy policy says North America). On `dialed-imports`, remove any whole-bucket 30-day lifecycle rule (D-110: run files are kept).                                     | owner, per `docs/deployment.md` §1–3                                                                                                              | §3.1              |
| Create the `dialed-exports` queue and its `dialed-exports-dlq` before the first deploy that binds them (any deploy of PR #132 or later).                                                                                                                                                                                         | owner, per `docs/deployment.md` §3                                                                                                                | decision D-86     |
| Add the one lifecycle rule on `dialed-imports`: prefix `exports/`, delete after 8 days, the net behind the hourly export sweep.                                                                                                                                                                                                  | owner, per `docs/deployment.md` §2                                                                                                                | decision D-85     |
| Create the `dialed-guides` bucket, and an R2 API token with read-only access to that bucket alone. Add it to the `dialed.run-site` repo as `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`.                                                                                                                                          | owner, per `docs/deployment.md` §2                                                                                                                | R-134             |
| To create, before friends: the `dialed-evidence` bucket and its three bucket locks (`ncmec/` and `takedown/` 400 days, `register/` indefinite), and an R2 API token with Object Read & Write on that bucket alone, kept by the owner, never bound to the Worker.                                                                 | owner, per `docs/deployment.md` §2                                                                                                                | D-148             |
| Create the `dialed-public-photos` bucket, connect `photos.dialed.run` as its custom domain (r2.dev URL off), and turn on the CSAM Scanning Tool for the zone with the owner's address for notifications, before the first deploy that binds `PUBLIC_PHOTOS`.                                                                     | owner, per `docs/deployment.md` §2                                                                                                                | D-151             |
| Confirm Workers Caching (`"cache": { "enabled": true }` in `wrangler.jsonc`) is available on the account's plan, and after the first deploy that a public page (`/k/<id>`) answers a second request with `cf-cache-status: HIT`. If it is not available, deploy with the setting removed: the public pages still work, uncached. | owner                                                                                                                                             | D-152, design 160 |
| Observability: tracing **off** (billable); logs at full sample (`head_sampling_rate: 1` is fine at launch volume). Carried over from the old launch-gate checklist.                                                                                                                                                              | owner                                                                                                                                             | workflow.md       |
| Usage notifications for Workers, D1, R2 and Email.                                                                                                                                                                                                                                                                               | owner                                                                                                                                             | §3.7              |

## 2. Vars and secrets

Vars go in `wrangler.jsonc` (`vars`), secrets with `wrangler secret put`.
Both are the owner's edits; the code that reads each is already written or
is written by the named lane.

| name                                                     | kind   | required       | read by / written by  | without it                                                                                                       |
| -------------------------------------------------------- | ------ | -------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_URL=https://dialed.run`                     | var    | yes            | 125 · OPS-4           | Wrong-host callbacks; no `__Secure-` cookie prefix (0.7). `/api/health` reports it.                              |
| `STRAVA_SUBSCRIPTION_ID`                                 | var    | for Strava     | 127 · STR-4           | The webhook cannot tell our events from forged ones (0.10). Set after step 5's subscription call returns the id. |
| `TURNSTILE_SITE_KEY`                                     | var    | yes            | 125 · OPS-5           | No widget on sign-up or request access.                                                                          |
| `BETTER_AUTH_SECRET`                                     | secret | yes            | auth                  | No sessions.                                                                                                     |
| `VISUAL_CROSSING_API_KEY`                                | secret | yes            | weather               | Every run falls back to manual.                                                                                  |
| `OPENAI_API_KEY`                                         | secret | **yes**        | screening, extraction | Every photo stays `pending`, so **no entry photo is ever public** (§3.1).                                        |
| `ADMIN_USER_IDS`                                         | secret | **yes**        | admin check           | The Desk and the review queue are unreachable.                                                                   |
| `TURNSTILE_SECRET_KEY`                                   | secret | yes            | 125 · OPS-5           | Sign-up and request access refuse (fail closed).                                                                 |
| `UNSUBSCRIBE_SECRET`                                     | secret | before friends | 126 · ACC-2           | Fails closed: no reminder email goes, every unsubscribe link is refused. `/api/health` reports it.               |
| `TAKEDOWN_SECRET`                                        | secret | before public  | 137 · D-118           | `/takedown` matches requesters by email alone; nothing fails.                                                    |
| `STRAVA_CLIENT_ID` / `_SECRET` / `_WEBHOOK_VERIFY_TOKEN` | secret | for Strava     | runs                  | T1 shows "not configured".                                                                                       |
| `GOOGLE_CLIENT_ID` / `_SECRET`                           | secret | optional       | auth                  | No Google sign-in; set both or neither.                                                                          |
| `SENTRY_DSN`                                             | secret | strongly       | ops                   | Terminal failures go nowhere.                                                                                    |
| `FIRECRAWL_API_KEY`                                      | secret | optional       | enrichment            | Shops that refuse a Worker (11 of 14) enrich from nothing.                                                       |

**Owner only, not a Worker secret**: the `dialed-evidence` R2 API token
(§1, D-148), to create before friends and kept in the owner's password
manager.

**GitHub**: secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts and D1 edit,
nothing more; `docs/deployment.md` §7) and **`CLOUDFLARE_ACCOUNT_ID`**,
both in the `production` environment rather than the repository, and
variable `DEPLOY_ENABLED=true` when ready. The dependency automation's App
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

**Applied (#114).** `.github/workflows/ci.yml` on `main` migrates both
databases `--remote` before `wrangler deploy`, the deploy job has
`needs: [test, e2e]`, and the e2e job writes `ADMIN_USER_IDS`. Nothing in
this section is left for the owner.

## 4. Email (Cloudflare Email Sending)

| step                                                                                                                                                                                                                      | cites               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Onboard `dialed.run` as the sending domain; publish the SPF, DKIM and DMARC records it asks for. Choose the sender address (e.g. `hello@dialed.run`).                                                                     | decision D-42, §2.3 |
| Verify the owner's address as a destination, for the digest (free to verified destinations).                                                                                                                              | §3.5                |
| Check the account's daily quota against the stage: fine for the owner and friends; confirm it before public. **Fallback vendor**: note one (e.g. Postmark or Resend) and what switching costs, since the service is beta. | §2.3                |
| The `send_email` binding itself is added by task 126 (ACC-2) with the owner's authorisation, not in this sweep.                                                                                                           | decision D-42       |

## 5. Third-party accounts

The **stage** column names the first rollout stage (§11) that needs the
step: owner, friends or public.

**Strava**

| step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | stage   | cites |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----- |
| Authorization Callback Domain → `dialed.run`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | owner   | §3.3  |
| Raise capacity from 1 (Single Player) to 10 with the self-serve step. **Stay at ≤10 for the friends stage.** It does: since 2026-06-01 a new Strava API app needs a subscription on the developer account (see the Extended Access row).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | friends | §1.6  |
| Register the webhook subscription (`docs/deployment.md` §6) after the domain; record the returned id as `STRAVA_SUBSCRIPTION_ID`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | friends | 0.10  |
| **Apply for Strava Extended Access well before public**, from the existing app, with 127's official Connect button live and the public privacy policy reachable. Start as early as the friends stage allows. Since 2026-06-01 a new Strava API app needs the developer account to hold a Strava subscription (about $11.99/mo or $79.99/yr), and there is one app per athlete account. Standard access is capped at 10 connected athletes, so it covers the friends stage only. Extended Access raises the limits and needs no subscription. The lead time is unknown, so apply early. Open question to confirm with Strava: what happens to a Standard app if the subscription lapses (undocumented). Recommended: a dedicated Strava account for the app, paid monthly until Extended Access is approved. | public  | §1.6  |
| Confirm STR-5 moved deauthorization to `/oauth/revoke` (hard deadline 1 June 2027).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | —       | §1.6  |

**Google**

| step                                                                                                                                                                             | stage   | cites |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----- |
| Authorised redirect URI on `dialed.run`.                                                                                                                                         | owner   | §3.3  |
| Friends can sign in while the consent screen is in **Testing** only if each is added as a test user (limit 100). Either add them or switch now.                                  | friends | §1.7  |
| Switch the consent screen to **In production**. Non-sensitive scopes only, so verification is not mandatory.                                                                     | public  | §1.7  |
| Brand verification (name and logo on the consent screen): homepage and privacy policy on the verified domain; Search Console ownership of `dialed.run`. Allow 2–3 business days. | public  | §1.7  |

**Open conflict:** `legal-readiness-plan.md` Step 4 says Testing mode needs
no test users for `openid email profile` (A11); owner to confirm against
Google's docs; adding test users is the safe default.

**Turnstile**: create the widget for `dialed.run` (managed mode); site key
as a var, secret as a secret. Free.

**Sentry**

| step                                                                                                                                                           | cites |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Project and DSN.                                                                                                                                               | —     |
| **Alert rules**: new issue → email (the default); **plus** a rule on the digest's tag that fires on every event, so day two alerts (125's OPS-2 sets the tag). | 0.5   |
| Cron monitors, if 125 chose Sentry Crons for OPS-3 (check the plan's monitor allowance), or a healthchecks.io account if it chose a ping.                      | §3.5  |
| **Prove delivery**: a test error from a fetch and from a cron, after 125's OPS-1.                                                                              | 0.4   |

**Uptime**: UptimeRobot (or similar) on `/api/health`.

## 6. Spend caps

| vendor          | action                                                                                                                                                                                          | cites      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| OpenAI          | Monthly budget limit on the project. Moderation is free; extraction is not.                                                                                                                     | §3.7       |
| Visual Crossing | Choose the plan. Free is 1,000 records a day. **Do not move to Metered until 125's OPS-6 has landed**; there is no documented daily spend cap, so the digest's backlog count is the only brake. | 0.6, §1.8  |
| Firecrawl       | The plan's credit cap is the limit; pick the plan.                                                                                                                                              | §3.7       |
| Cloudflare      | Usage notifications (§1 above). Email Sending: 3,000 included a month, then $0.35 per 1,000.                                                                                                    | §3.7, §2.3 |
| Anthropic       | Monthly spend limit on the workspace whose key reviews dependency majors (`docs/dependencies.md` §Setup). About $1–3 a review.                                                                  | design 156 |

## 7. Abuse controls at the zone

- **WAF rate-limiting rules** on `/api/auth/*`, the upload server
  functions, product create, request access and `/api/strava`. This is
  the default answer to §3.6 (open decision 4 in the development plan):
  zone rules need no new binding. If the owner prefers the Workers Rate
  Limiting binding, that is a `wrangler.jsonc` binding and a lane change.
- Better Auth's own limiter is turned on in code by 125 (OPS-4).

## 8. CSAM and moderation (decisions D-69, D-70)

- **Photos on PUBLIC kits are scanned by Cloudflare's CSAM Scanning Tool**
  (D-151): a copy of each is served from the `dialed-public-photos` bucket
  on `photos.dialed.run`, through the cache the tool reads (§1,
  `docs/deployment.md` §2). The bullets below are about every other photo.
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
- **R2 has no versioning or backup**, and `MEDIA` is the source of truth.
  126's 7-day deletion tombstone (ACC-9) is the mitigation for a bad bulk
  delete; a real R2 backup is soon-after. What each prefix holds, what
  losing it costs, and three options with a recommendation are in
  `docs/deployment.md` §10.

---

## 11. Rollout gates

Each gate is a checklist the owner runs. Everything in the development
plan is merged before stage 0 (decision D-37); the markers there say which
items each gate depends on if that ever slips.

### Stage 0 — the owner alone

- The custom domain serves the app; `/api/health` is all `ok`.
- Both databases migrated with `--remote`; the four crons listed under
  Triggers; the six queues have consumers.
- Every required secret and var in §2 set; `BETTER_AUTH_URL` is the domain.
- **Sentry proven** from a fetch and a cron; the digest alert rule and the
  cron heartbeat in place; uptime ping on.
- Email: the domain onboarded; a verification email and a password reset
  received end to end.
- Strava: callback domain set, webhook subscribed, `STRAVA_SUBSCRIPTION_ID`
  set; connect, disconnect and a revoke that **succeeds on Strava's side**
  (127's STR-1/2).
- Spend caps set; Visual Crossing plan chosen.
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
  code in the repo would be a public way in). Pick four characters with
  no 0/O/1/I and run, once:
  `npx wrangler d1 execute dialed-core --remote --command "INSERT INTO invite_codes (id, code, label, max_uses, created_at) VALUES ('owner-seed', 'DIAL-XXXX', 'owner', 1, unixepoch())"`.
  Sign up with it, then put the new account's id in `ADMIN_USER_IDS`;
  every later code comes from Desk D7.

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
- A photo uploaded from a phone has **no GPS in the served bytes** (128's
  SAF-1); check with an EXIF reader.

### Stage 2 — the public

Everything in stage 1, plus:

- Every **[P]** item in the development plan is on production.
- **Strava review approved** for the capacity you expect. This is the gate
  most likely to hold the date.
- Google consent screen In production; brand verification done.
- CSAM coverage decided and in place (§8's open item); the NCMEC
  procedure written and read.
- DMCA agent registered and the contact published.
- **Flip the landing page (and other public marketing pages) to index;
  profiles and entries stay noindex.** The whole site ships `noindex`
  until this gate (owner, 2026-09-26; decision D-53): the default is in
  `modules/ops/og/site-head.ts`, and a route's own `robots` meta replaces
  it.
- **Decide whether to flip the invite flag** (126 · ACC-5): leaving it on
  keeps public sign-up invite-only; flipping it removes the code field and
  the request link.
- Processor agreements executed; EU/UK representative decision made; DSA
  contact published; UK OSA assessments written.
- WAF rate-limiting rules live.
- The R-45 copy pass done with design (every placeholder string these lanes
  shipped has been read by a human).
