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
§N or finding 0.N) and decisions D-37 to D-47. A bare `D-N` is a row in
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
   they are redone.
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

| step                                                                                                                                                                | who                                                                                                                                               | cites         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Workers Paid plan on the account (Email Sending requires it).                                                                                                       | owner                                                                                                                                             | decision D-42 |
| Route the Worker to `dialed.run`: a `routes` entry with `custom_domain: true` in `wrangler.jsonc` (the zone is already on Cloudflare DNS).                          | **the sweep**: a `wrangler.jsonc` edit, which is human-managed; no lane touches it. Rename the CI job "Deploy to workers.dev" in the same change. | §3.3          |
| Decide whether `workers.dev` stays enabled. Recommend off once the domain works, so there is one origin for cookies and signed photo URLs.                          | owner                                                                                                                                             | §3.3          |
| Zone settings: Always Use HTTPS; HSTS at the zone if not sent by the Worker (125's OPS-8 sends it; do not double-set with conflicting values).                      | owner                                                                                                                                             | §3.9          |
| Create the D1 databases, R2 buckets and queues, replace the placeholder D1 ids, set the `dialed-imports` 30-day lifecycle rule.                                     | owner, per `docs/deployment.md` §1–3                                                                                                              | §3.1          |
| Observability: tracing **off** (billable); logs at full sample (`head_sampling_rate: 1` is fine at launch volume). Carried over from the old launch-gate checklist. | owner                                                                                                                                             | workflow.md   |
| Usage notifications for Workers, D1, R2 and Email.                                                                                                                  | owner                                                                                                                                             | §3.7          |

## 2. Vars and secrets

Vars go in `wrangler.jsonc` (`vars`), secrets with `wrangler secret put`.
Both are the owner's edits; the code that reads each is already written or
is written by the named lane.

| name                                                     | kind   | required      | read by / written by  | without it                                                                                                       |
| -------------------------------------------------------- | ------ | ------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV=production`                                    | var    | yes           | Better Auth           | 125 makes the code explicit (OPS-4), so this is belt and braces rather than load-bearing. Set it anyway.         |
| `BETTER_AUTH_URL=https://dialed.run`                     | var    | yes           | 125 · OPS-4           | Wrong-host callbacks; no `__Secure-` cookie prefix (0.7). `/api/health` reports it.                              |
| `STRAVA_SUBSCRIPTION_ID`                                 | var    | for Strava    | 127 · STR-4           | The webhook cannot tell our events from forged ones (0.10). Set after step 5's subscription call returns the id. |
| `TURNSTILE_SITE_KEY`                                     | var    | yes           | 125 · OPS-5           | No widget on sign-up or request access.                                                                          |
| `BETTER_AUTH_SECRET`                                     | secret | yes           | auth                  | No sessions.                                                                                                     |
| `VISUAL_CROSSING_API_KEY`                                | secret | yes           | weather               | Every run falls back to manual.                                                                                  |
| `OPENAI_API_KEY`                                         | secret | **yes**       | screening, extraction | Every photo stays `pending`, so **no entry photo is ever public** (§3.1).                                        |
| `ADMIN_USER_IDS`                                         | secret | **yes**       | admin check           | The Desk and the review queue are unreachable.                                                                   |
| `TURNSTILE_SECRET_KEY`                                   | secret | yes           | 125 · OPS-5           | Sign-up and request access refuse (fail closed).                                                                 |
| `PHOTO_URL_SECRET` (name per 128's design doc)           | secret | before public | 128 · SAF-7           | Public photos cannot be signed.                                                                                  |
| `STRAVA_CLIENT_ID` / `_SECRET` / `_WEBHOOK_VERIFY_TOKEN` | secret | for Strava    | runs                  | T1 shows "not configured".                                                                                       |
| `GOOGLE_CLIENT_ID` / `_SECRET`                           | secret | optional      | auth                  | No Google sign-in; set both or neither.                                                                          |
| `SENTRY_DSN`                                             | secret | strongly      | ops                   | Terminal failures go nowhere.                                                                                    |
| `FIRECRAWL_API_KEY`                                      | secret | optional      | enrichment            | Shops that refuse a Worker (11 of 14) enrich from nothing.                                                       |
| Cache-purge token (if 128 uses purge; see §8)            | secret | before public | 128 · SAF-5, SAF-7    | Removed public photos stay cached until their TTL ends.                                                          |

**GitHub**: secret `CLOUDFLARE_API_TOKEN` (Workers, D1, R2 edit), secret
**`CLOUDFLARE_ACCOUNT_ID`** (the deploy step reads it; missing from the
runbook, §3.1), variable `DEPLOY_ENABLED=true` when ready.

## 3. CI

125 writes the proposed workflow diff (OPS-12), because
`.github/workflows/` is a forbidden zone. The owner applies it:

- **Apply migrations before deploy** (`wrangler d1 migrations apply
--remote` for both databases). Today the deploy job only builds and
  deploys, so the first schema-changing merge after launch would run
  against an unmigrated database (§3.1 item 5).
- Deploy `needs: e2e` as well as `test`.
- D-72's one line: `ADMIN_USER_IDS` in the e2e job's `.dev.vars`, so the
  admin surfaces get a demo.

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

| step                                                                                                                                                                                                           | stage   | cites |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----- |
| Authorization Callback Domain → `dialed.run`.                                                                                                                                                                  | owner   | §3.3  |
| Raise capacity from 1 (Single Player) to 10 with the self-serve step. **Stay at ≤10 for the friends stage.** Confirm whether the June 2026 Standard tier needs a Strava subscription on the developer account. | friends | §1.6  |
| Register the webhook subscription (`docs/deployment.md` §6) after the domain; record the returned id as `STRAVA_SUBSCRIPTION_ID`.                                                                              | friends | 0.10  |
| **Apply for review** to go past 10, with 127's official Connect button live and the public privacy policy reachable. Before public; start as early as the friends stage allows.                                | public  | §1.6  |
| Confirm STR-5 moved deauthorization to `/oauth/revoke` (hard deadline 1 June 2027).                                                                                                                            | —       | §1.6  |

**Google**

| step                                                                                                                                                                             | stage   | cites |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----- |
| Authorised redirect URI on `dialed.run`.                                                                                                                                         | owner   | §3.3  |
| Friends can sign in while the consent screen is in **Testing** only if each is added as a test user (limit 100). Either add them or switch now.                                  | friends | §1.7  |
| Switch the consent screen to **In production**. Non-sensitive scopes only, so verification is not mandatory.                                                                     | public  | §1.7  |
| Brand verification (name and logo on the consent screen): homepage and privacy policy on the verified domain; Search Console ownership of `dialed.run`. Allow 2–3 business days. | public  | §1.7  |

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

## 7. Abuse controls at the zone

- **WAF rate-limiting rules** on `/api/auth/*`, the upload server
  functions, product create, request access and `/api/strava`. This is
  the default answer to §3.6 (open decision 4 in the development plan):
  zone rules need no new binding. If the owner prefers the Workers Rate
  Limiting binding, that is a `wrangler.jsonc` binding and a lane change.
- Better Auth's own limiter is turned on in code by 125 (OPS-4).

## 8. CSAM and moderation (decision D-46)

- **Turn on Cloudflare's CSAM Scanning Tool** for the `dialed.run` zone,
  with the notification email set. It only scans what the cache serves,
  which is why 128 (SAF-7) serves public-entry photos through signed,
  cacheable URLs; with that landed, the toggle covers public photos.
  Private and closet photos are not cached and are not scanned by it;
  upload-time screening covers them (register D-71).
- **Write the NCMEC reporting procedure** (owner, about 2 h; §1.10). 18
  U.S.C. §2258A requires a report to NCMEC's CyberTipline on actual
  knowledge, and preservation. It should say:
  - who may look at a flagged image, and that it is never forwarded or
    downloaded;
  - how to register as an electronic service provider with NCMEC and file a
    CyberTipline report;
  - how to **quarantine rather than delete** using 128's SAF-5 control, and
    for how long (the preservation period was lengthened in 2024 — confirm
    the current figure with counsel);
  - that the account is banned (SAF-4) and the content purged from the cache.
- **Cache purge**: if 128's design needs a purge on removal (a moderator
  Remove or a takedown should not wait out the TTL), create a zone-scoped
  API token with cache-purge permission and store it as a secret.

## 9. Legal

| item                                                                                                                                                                                                                                                                                                                                                                                                                                   | stage   | cites            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------- |
| **Privacy policy text**, GDPR-grade (Strava §7.3 requires it whatever the geography): what we collect, lawful bases, retention, rights (erasure, export — 126 builds both), the processors below, the Strava paragraph (the grant and an activity id per reminder, never activity data; pruned after 7 days), the cookie paragraph (strictly necessary only; no banner while no analytics are added, §1.5). 125's OPS-10 publishes it. | friends | D-105, §1.4–§1.6 |
| **Terms of service**: content licence, acceptable use, termination (the basis for a ban), not-safety-advice disclaimer, limitation of liability, **minimum age** (13+, or 16+ for the EU if simpler). 126's ACC-6 adds acceptance to Au1.                                                                                                                                                                                              | friends | §1.1, §1.3       |
| **DMCA designated agent**: register with the Copyright Office ($6, renew every three years; set a reminder), with a contact address (decide whether a P.O. box or a registered-agent address is acceptable). The contact goes on 125's `/legal/copyright`.                                                                                                                                                                             | public  | §1.2             |
| **Processor agreements (GDPR Art. 28)**: OpenAI (execute its DPA form), Cloudflare (self-serve terms), Sentry, Visual Crossing, Firecrawl, Google, Strava, Cloudflare Email. Name each in the policy.                                                                                                                                                                                                                                  | public  | §1.4             |
| **Art. 27 EU representative and the UK equivalent**: decide with counsel whether the processing is "occasional" enough to be exempt; appoint one if not.                                                                                                                                                                                                                                                                               | public  | §1.4             |
| **EU DSA**: a single point of contact for users and authorities (a page or the policy); the notice-and-action mechanism exists (reports), and 128's SAF-8 carries the statement of reasons. Verify with counsel.                                                                                                                                                                                                                       | public  | §1.4             |
| **UK Online Safety Act**: the illegal-content risk assessment and the children's-access assessment for a user-to-user service with UK users. Keep the written record.                                                                                                                                                                                                                                                                  | public  | §1.4             |
| Counsel's read of the above. The audit's author is not a lawyer.                                                                                                                                                                                                                                                                                                                                                                       | public  | —                |

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
  delete; a real R2 backup is soon-after.

---

## 11. Rollout gates

Each gate is a checklist the owner runs. Everything in the development
plan is merged before stage 0 (decision D-37); the markers there say which
items each gate depends on if that ever slips.

### Stage 0 — the owner alone

- The custom domain serves the app; `/api/health` is all `ok`.
- Both databases migrated with `--remote`; the four crons listed under
  Triggers; the four queues have consumers.
- Every required secret and var in §2 set; `BETTER_AUTH_URL` is the domain.
- **Sentry proven** from a fetch and a cron; the digest alert rule and the
  cron heartbeat in place; uptime ping on.
- Email: the domain onboarded; a verification email and a password reset
  received end to end.
- Strava: callback domain set, webhook subscribed, `STRAVA_SUBSCRIPTION_ID`
  set; connect, disconnect and a revoke that **succeeds on Strava's side**
  (127's STR-1/2).
- Spend caps set; Visual Crossing plan chosen.
- A Time Travel restore drill done once.

### Stage 1 — invited friends

Everything in stage 0, plus:

- Every **[F]** item in the development plan is on production.
- The privacy policy and terms are published and linked; Au1 records
  acceptance.
- Invite codes issued from the Desk; request access reachable and
  Turnstile-guarded.
- Strava capacity raised to 10, and **no more than 10 friends connect
  Strava** (the eleventh sees 127's STR-6 message).
- Google: each friend added as a test user, or the consent screen switched
  to In production.
- A photo uploaded from a phone has **no GPS in the served bytes** (128's
  SAF-1); check with an EXIF reader.

### Stage 2 — the public

Everything in stage 1, plus:

- Every **[P]** item in the development plan is on production.
- **Strava review approved** for the capacity you expect. This is the gate
  most likely to hold the date.
- Google consent screen In production; brand verification done.
- CSAM tool on; public-entry photos served cacheable and signed; the NCMEC
  procedure written and read.
- DMCA agent registered and the contact published.
- Processor agreements executed; EU/UK representative decision made; DSA
  contact published; UK OSA assessments written.
- WAF rate-limiting rules live.
- The D-45 copy pass done with design (every placeholder string these lanes
  shipped has been read by a human).
