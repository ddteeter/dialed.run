> Coordinator-verified in code on 2026-09-25: findings 0.1, 0.2, 0.4, 0.6, 0.8 and 0.10; the rest stands as the audit reported it. The plans built from it are `docs/launch/development-plan.md` and `docs/launch/deployment-plan.md`.

# dialed.run production-readiness audit

- **Date:** 2026-09-25
- **Commit audited:** `origin/main` at `be70c6d`. Open PRs #101–#104 and #106 were checked where relevant.
- **Scope:** read-only. No repo edits.
- **Web sources:** fetched on 2026-09-25 and quoted below. Most came through a summarising fetch tool, so treat the quotes as near-verbatim.
- **Legal caveat:** I am not a lawyer. Each legal item is labelled **legal requirement** (what the cited source says) or **best practice**. Anything with real exposure needs a lawyer's read.

---

## 0. Findings the docs do not know about

These contradict something the docs or code claim, and each would break production silently.

1. **The Strava refresh path is unused.** `refreshStravaToken` (`src/modules/runs/strava/oauth.ts:170`) is called only by `test/runs/strava-oauth.test.ts`. Because of that:
   - **Revocation cannot succeed.** Disconnect copies the _stored access token_ into `strava_revocations` (`oauth.ts:311-318`). Strava access tokens expire about 6 h after issue, and nothing refreshes them. So `deauthorize` gets a 401 → 3 retries → DLQ → Sentry. The daily digest then re-dispatches the row (`ops/scheduled.ts:232`) and it fails again, every day, forever. The user believes they disconnected; the grant stays live on Strava.
   - **D-1's fix never runs.** Its "broken after 3 failures / 30 min" logic (dfc1e39) is unreachable, so the `strava_broken` notification can never fire.
2. **Athlete deauthorization is ignored.** The webhook drops every non-`activity/create` event (`webhook.ts:68`), including `object_type: "athlete"` with `updates.authorized: "false"`. That leaves our tokens and athlete id in place indefinitely. Strava's API Policy §7.4 requires deletion "within thirty (30) days" of a user revoking authorization (**legal/contractual requirement**).
3. **Ban mechanics are mostly unbuilt.** `bans.ts` only writes `banned_at` and deletes sessions:
   - `banStateOf` is never called, so a banned user signs straight back in.
   - `bannedAmong` is never called, so their content stays in every feed.
   - `banUserAction` has no UI caller.
   - A reviewer's "Remove" on a _profile_ report is a deliberate no-op (`review.ts:522`, "a ban has its own path") — and that path doesn't exist.
   - Packet 106 §4 promised "content hidden everywhere, sessions revoked, sign-in blocked". One of the three exists.
4. **Most Sentry events are probably lost.** `reportException` builds `new Toucan({ dsn })` with no `context` (`ops/sentry.ts:27`). Toucan only extends the Worker's lifetime with `waitUntil` when a context is passed (`toucan-js` dist, lines 751-754).
   - Every call site either rethrows immediately (`server.ts`) or returns straight after (the digest). So the outbound fetch to Sentry is likely cancelled when the invocation ends.
   - The whole ops model ("Sentry emails on new exceptions; the digest is a Sentry event") rests on this.
   - The fix is `waitUntil` from `cloudflare:workers` (or threading `ctx`). Prove it with deployment.md §8's "send a test error" — from a **cron**, not only from fetch.
5. **Even when a digest event arrives, day two is silent.** Every digest is `captureException(new Error("daily digest anomalies"))`, so all of them group into one Sentry issue. Sentry's default alert fires on _new_ issues only, so the second day's anomalies send no email unless someone resolved the issue in between.
6. **Weather is billed 24× what we use.** `fetchTimeline` asks Visual Crossing for a whole day with `include=hours` and keeps one hour (`visual-crossing.ts:222-235`, `pickNearestHour`).
   - Visual Crossing: "A full day of hourly data at a single location would be counted as 24 records."
   - A run spans up to 6 hour-keys, so a cold-cache run can cost 144 records.
   - The free tier is "Up to 1,000 records per day", which is roughly 7–40 runs a day.
   - Metered pricing is $0.0001 per record. Fix: store all 24 hours from the one response, or request a single datetime.
7. **Better Auth's rate limiter is almost certainly off in production.**
   - `rateLimit.enabled` defaults to `isProduction`, which is `process.env.NODE_ENV === "production"` read at runtime (`@better-auth/core/dist/env/env-impl.mjs:30-32`; the built `dist/server` bundle keeps `nodeENV = env.NODE_ENV ?? ""`).
   - `wrangler.jsonc` defines no `vars`, so `NODE_ENV` is empty.
   - Even when enabled, it defaults to `storage: "memory"`, which is per isolate.
   - `isProduction` and a missing `BETTER_AUTH_URL` also decide the `__Secure-` cookie prefix (`better-auth/dist/cookies/index.mjs:23,275`).
   - `instance.ts` never passes `baseUrl`.
8. **Entry photos keep their EXIF, including GPS.**
   - `uploadEntryPhoto` stores the uploaded bytes as-is (`feed/photos.ts:123-126`), and the photo route serves those bytes (`bytesResponse`).
   - With W3's blur off, `PhotoBlur` uploads the original file untouched (`PhotoBlur.tsx:148-151`).
   - So a phone photo on a public entry can publish the runner's home coordinates.
   - Garment photos are served as re-encoded webp, but their `original.*` is stored too.
9. **Nobody can delete what they posted.** No server function deletes an entry, a run or an entry photo, and nothing on main calls `MEDIA.delete`/`IMPORTS.delete`. A runner cannot take down a photo they regret. A moderator's "Remove" hides the bytes but never deletes them, and a DMCA takedown works the same way.
10. **The Strava webhook is unauthenticated.** `subscription_id` is parsed but never compared with ours (`webhook.ts:23`, `routes/api/strava.ts`). Anyone can POST forged `activity/create` events for any athlete id, which spams reminders and queue operations.

---

## 1. Legal and compliance

### 1.1 Terms of Service — missing

- **Missing:** no ToS page, no acceptance at sign-up, and no conduct rules to cite when banning. The auth pages carry no terms or privacy link (`src/modules/auth`, `src/routes/auth`, and PR #104's `auth-copy.ts` — searched for "terms"/"privacy").
- **Why it matters:** a UGC service needs a content licence to display and store users' photos, names and entries. It also needs acceptable-use rules and a termination right (bans), a disclaimer that dressing and weather information is not safety advice, a limitation of liability, and a minimum age.
  - No statute requires a ToS (**best practice**, and effectively mandatory).
  - Without one, a ban has no contractual basis, and the photo licence rests on implied consent.
  - The Strava review also looks for a real, public-facing app.
- **Size:** owner/lawyer text, 0.5–1 day. Page and links ride with D-105's lane (about 2 h).
- **Who:** owner (text), build lane (page and links), design agent (placement — same slot as D-105).

### 1.2 DMCA designated agent and takedown process — missing

- **Missing:** no registered agent, no public copyright contact, no documented takedown steps. Packet 106 says "DMCA tooling (contact email in the footer; manual process)", but there is no footer contact and no `mailto:` anywhere in `src`. And, per finding 0.9, there is no way to delete the bytes.
- **Why it matters:** safe harbour under 17 U.S.C. §512(c) requires a designated agent registered with the Copyright Office.
  - Copyright Office FAQ: "$6 per designation", renewed every three years; a lapse means "Service providers risk losing the safe harbor protections of section 512".
  - **Legal requirement to get the safe harbour.**
  - Exposure: user photos, plus product images copied into R2 (D-67; not served yet, so dormant).
- **Size:** 1 h of owner time (registration plus a contact address). Takedown tooling (delete object, null key, audit row) is about 0.5 day, shared with 0.9's deletion work.
- **Who:** owner (registration, and deciding whether a P.O. box or registered-agent address is acceptable); build lane.

### 1.3 Minimum age / COPPA — undecided

- **Missing:** no age statement anywhere.
- **Why it matters:** FTC: general-audience sites need not investigate ages, but once you have actual knowledge that a user is under 13, you must get parental consent or delete their data. Any age screen must "Ask age information in a neutral manner".
  - **Legal requirement** only on actual knowledge. A "13+" (or 16+ for simplicity in the EU) clause in the ToS is **best practice**.
  - Photos of children in running kit are a realistic edge case. W3's blur helps.
- **Size:** a ToS clause, plus a deletion path (which 2.1 already needs).
- **Who:** owner.

### 1.4 GDPR, the DSA and the UK Online Safety Act — decide the geography first

- **Missing:**
  - Art. 17 erasure and Art. 20 portability: no delete, no export (see §2).
  - Art. 28 processor agreements.
  - An Art. 27 EU representative decision.
- **Processors that receive personal data** — each must be named in D-105's policy and, where offered, have a DPA:
  - Cloudflare (all data).
  - OpenAI (every uploaded photo, for `omni-moderation`, plus product page text).
  - Visual Crossing (run coordinates and times — location data).
  - Firecrawl (product URLs; low sensitivity).
  - Google and Strava (OAuth).
  - Sentry (user ids).
  - Cloudflare Email once it lands.
- **Doc drift:** `architecture.md`'s "Launch gate" paragraph still says "photo screening via Workers AI". The code uses OpenAI (`architecture.md:66` explains why). The policy must name OpenAI, not Workers AI.
- **Why it matters:**
  - GDPR applies whenever EU residents are offered the service (Art. 3(2)(a)) — **legal requirement** if EU sign-ups are allowed.
  - The EU Digital Services Act's notice-and-action and statement-of-reasons duties (Arts. 16–17) apply to hosting services of any size, as I understand it. **Verify with counsel.** The ban and removal notices in §4 are what would satisfy them.
  - The UK Online Safety Act puts user-to-user services with UK users in scope (risk assessment duties).
  - A defensible option is **US-only sign-ups at launch** (geo-block via a WAF rule, or a signup-time country check). That makes most of this a later project rather than a launch blocker.
- **Size:**
  - Owner decision now.
  - If EU/UK stays open: DPAs (OpenAI requires executing its DPA form; Cloudflare's is in its self-serve terms), 1–2 days of owner time, plus the §2 work.
  - Geo-restriction: about 1 h as a WAF custom rule on the zone.
- **Who:** owner.

### 1.5 Cookie notice — not needed, with one condition

- **Why:** the only cookie is Better Auth's session cookie, and `sessionStorage`/`localStorage` hold UI conveniences (carried email, blur preference). The ICO says consent isn't needed where a cookie is "strictly necessary", and "it is still good practice to provide users with information about these cookies".
- **Action:** a paragraph in D-105's policy. No banner.
- **Condition:** this holds only while no analytics or third-party scripts are added. **Best practice.**

### 1.6 Strava API Agreement and API Policy (new terms effective 1 June 2026) — several gaps

The API Policy (https://www.strava.com/legal/api_policy) requires the following.

- **Capacity (blocks public launch):**
  - "All newly created apps will have an athlete capacity of 1, aka 'Single Player Mode'". A self-serve step raises it to 10; beyond that you must "submit your app for review", and "increased access is not a guarantee".
  - Reported turnaround is 7–10 business days (search snippet only), and community threads report weeks.
  - The June 2026 update also says "A Strava subscription will be required to access the API as a Standard Tier developer", and introduces Standard (10 athletes) and Extended Access tiers.
  - I could not confirm whether the old review form is still the route to more than 10 athletes.
  - **The owner should apply now.** It is the longest lead time on this list.
  - Also decide what the 11th athlete sees. The token exchange fails, and today that shows up as a generic connect failure.
- **Branding:**
  - The guidelines require the official "Connect with Strava" button asset linking to `/oauth/authorize`.
  - We render a custom pink "Connect Strava" `PRIMARY` button (`StravaConnect.tsx:120-124`).
  - The review checks "compliant with our branding guidelines". → design agent (T1 board) plus about 1 h of build.
- **Deletion (§7.4):** triggered by revocation or user request, within 30 days. See findings 0.1 and 0.2. Account deletion (§2.1) must also revoke and delete.
- **Cache (§6.2):** "You may not retain Strava Data in your cache for longer than seven (7) days."
  - `processed_webhook_events` and `notifications.subject` keep Strava activity ids forever.
  - Whether a bare activity id counts as "Strava Data" is arguable. A 7-day prune is about 1 h in an existing cron. **Contractual; do it.**
- **Deauthorize endpoint:** we call `/oauth/deauthorize` (`strava/api.ts:39`). Strava: `POST /oauth/revoke` "will be the only endpoint supported for deauthorization effective June 1, 2027". Not a launch blocker; fix it together with 0.1.
- **AI (§5.3):** Strava data must never reach an "AI Application", including context windows. Compliant today (only the athlete id is kept). Keep that true when the Call epic starts.
- **Privacy policy (§7.3):** it must meet "GDPR and the UK GDPR" requirements and be reachable by prominent links. D-105 covers this, but the §7.3 wording means the policy must be GDPR-grade even if we geo-restrict.

### 1.7 Google OAuth — dashboard work only

- "If your app utilizes only non-sensitive scopes, it is not mandatory for your app to complete the app verification process." (support.google.com/cloud/answer/13463073)
- **The trap is Testing status.** It is "limited to up to 100 test users". The owner must switch the consent screen to **In production**.
- **Brand verification** (needed to show the dialed.run name and logo) requires:
  - a homepage "hosted on a verified domain you own";
  - a privacy policy on that same domain;
  - Search Console ownership of every authorized domain.
- That makes it depend on the custom domain (§3.3) and D-105.
- **Size:** 1 h of owner time plus 2–3 business days if a manual review happens.
- **Who:** owner.

### 1.8 Visual Crossing — attribution fine; plan and cost are the gap

- **Attribution is required on Free, Pro and Metered:** "must prominently display the message 'Weather Data Provided by Visual Crossing'… near the data… with a clickable link".
  - `ui/WeatherAttribution.tsx` exists and renders in `ConditionsBlock` and `VerdictBacklog`.
  - Also check EntryDetail, the feed list and the consensus/Your-conditions surfaces. Every surface showing conditions needs it, and I only saw those two importers.
- **Commercial use is allowed on every plan.** "Storable for shared internal use" is ✔ on every plan, so our shared cache is fine. "Raw data can never be shared and distributed publicly for download", so no weather export — keep that in mind for the §2.2 data export.
- **Gap:** see finding 0.6. Also decide on the Metered plan before launch; I found no documented daily spend cap, so the digest's backlog check is the only brake.
- **Who:** owner (plan), build lane (the 24-hour fix, about 0.5 day).

### 1.9 Fonts — compliant

- `public/fonts/OFL.txt` ships beside the woff2 files. All three families are SIL OFL 1.1.
- The OFL FAQ counts subsetting as modification. IBM Plex has a Reserved Font Name ("Plex"), so a _subset_ Plex Mono file should not be distributed under the name Plex.
- Our files are Google Fonts' own latin and latin-ext subsets. That is common practice and low risk. Keep the licence file and don't rename. **No action.**

### 1.10 CSAM (D-71) — the dashboard toggle does not cover us, and there is a reporting duty

- **What the tool scans:** Cloudflare's docs say it compares "content served for your website through the Cloudflare cache". Our photos are Worker-served with `private` cache headers (`feed/photos.ts:312`, `closet/photo.$itemId.$size.ts:34`) on workers.dev. The docs don't mention private or uncached Worker responses, so I infer that turning the tool on scans nothing of ours.
- **Options:**
  - **(a)** Serve _screened, public_ entry photos with `Cache-Control: public` on the custom zone, so the tool sees them. The cost: purge on hide, unpublish and delete.
  - **(b)** A hash-matching service such as PhotoDNA Cloud or Thorn Safer. Paid, or free on application.
  - **(c)** Accept report-driven detection plus the OpenAI classifier. Its `sexual/minors` score is text-only per D-71, so image coverage is still zero.
- **Reporting duty:** separately, 18 U.S.C. §2258A requires providers to report apparent CSAM to NCMEC once they have actual knowledge, and to preserve it. The Cloudflare doc itself says the site owner must "file a report to NCMEC". **Legal requirement.** There is no written procedure for the admin who sees it in `/safety/review`, and no preservation step (the preservation period was lengthened in 2024 — confirm the current figure).
- **Size:**
  - Procedure doc: about 2 h of owner time.
  - Option (a): about 0.5–1 day of build, plus purge wiring.
- **Who:** owner decides; a build lane implements.

---

## 2. Account lifecycle

### 2.1 Account deletion — not built

- **Evidence:** no `deleteUser`/delete-account code in `src`. The settings page says delete "belongs to other lanes". PR #104 lists "Delete account" as "absent rather than dead".
- **What it must reach.** Core has **no foreign keys** (`grep onDelete schema-core.ts` → 0; auth has 2), so this is application code across:
  - `user_profiles`, `wardrobe_items`, `runs`, `outfit_entries` and its items, tags and photos;
  - `follows` and `blocks` in both directions, `reactions`, `notifications`;
  - `reports` (keep anonymised?), `review_queue`, `imports`, `photo_screenings`;
  - `manual_conditions` in **DIALED_WEATHER**, which is cross-database, so it needs reconciliation per law 8c;
  - R2 `MEDIA` (`entries/{userId}/…` and garment prefixes) and `IMPORTS`;
  - Strava revocation, which depends on fixing 0.1 first;
  - Better Auth `user`, `session` and `account` rows.
  - Shared `products` stay (canonical rows; the names are UGC).
- **Decision needed:** CLAUDE.md's "Retire, don't delete garments" rule needs an explicit exception for account deletion.
- **Why it matters:** GDPR Art. 17 (**legal requirement** if EU users are allowed); Strava §7.4 on user request (**contractual**); and expected by users everywhere. It is also the only way to act on a COPPA actual-knowledge case.
- **Size:** 2–3 days. It needs an outbox or claim design for the R2 and cross-database halves (a `user_deletions` claim row that a cron drains).
- **Who:** owner (retention rules — e.g. keep reports against others?), design agent (U1 "Delete account" confirm flow), build lane.

### 2.2 Data export — not built

- **Why it matters:** GDPR Art. 20 (**legal requirement** where it applies; best practice otherwise).
- **Scope:** a JSON download of profile, closet, runs, entries and photo links. Exclude raw Visual Crossing rows (licence) — derived conditions per run are probably fine; check.
- **Size:** about 1 day. **Who:** design (U1 row), build.

### 2.3 Password reset — not built

- **Evidence:** `create-auth.ts` sets `emailAndPassword: { enabled: true }` with no `sendResetPassword`. PR #104: "'Forgot it?' is absent: there is no password-reset flow."
- **Why it matters:** a stranger who forgets their password is locked out for good, or the owner hand-edits D1. **Must-before.**
- **Dependency:** the email work already planned. Cloudflare Email Service is **beta**, "New accounts start with a conservative daily quota", and costs "3,000 included per month, then $0.35 per 1,000". Its sending domain must be a Cloudflare zone, which again depends on §3.3. Keep a fallback vendor in mind.
- **Size:** 0.5–1 day on top of the email plumbing. **Who:** design (Au screens exist for reset? check), build.

### 2.4 Email change, password change, sign out everywhere — not built

- **Evidence:** PR #104 has "Account" absent. There are no `changeEmail`/`changePassword`/`revokeSessions` calls.
- **Why it matters:** best practice. The practical launch need is "change password" and "sign out other sessions" after a compromise.
- **Size:** 1 day. **Who:** design (U1 Account), build.

### 2.5 Retracting a post — not built

- See finding 0.9.
- **Why it matters:** privacy, UGC norms, and the DMCA process all assume the owner can remove content.
- **Size:** 1 day (entry delete or unpublish, photo delete with R2 cleanup via claim-then-delete).
- **Who:** design (D/E1 overflow), build.

---

## 3. Operations

### 3.1 `docs/deployment.md` is incomplete and in places wrong

1. **Migrations may land on the local database.** Step 1's `wrangler d1 migrations apply dialed-core` has no `--remote`. Wrangler 4 defaults D1 commands to local (the package's own local scripts pass `--local` explicitly; confirm with `--help`). Add `--remote`.
2. **The secrets table is missing four entries:**
   - `OPENAI_API_KEY` — without it, photos stay `pending`, which means **no entry photo is ever publicly visible**;
   - `FIRECRAWL_API_KEY`;
   - `ADMIN_USER_IDS` — without it the review queue is unreachable;
   - `BETTER_AUTH_URL`, plus a `NODE_ENV=production` var (finding 0.7). These belong in wrangler `vars`, a forbidden zone, so the owner makes the edit.
3. **Two crons are missing from the table.** §4 lists 2 crons; `wrangler.jsonc` and `ops/crons.ts` have 4 (`enrichment-retry`, `screening-retry`).
4. **A GitHub secret is missing.** §7 omits `CLOUDFLARE_ACCOUNT_ID`, which `ci.yml`'s deploy step uses.
5. **CI does not apply migrations before deploy.** `architecture.md` says it does. `ci.yml`'s `deploy` job only builds and runs `wrangler deploy`, and it `needs: test`, not `e2e`. The first schema-changing merge after launch deploys code against an unmigrated database.
6. **No restore runbook.** There are no steps for D1 Time Travel (`wrangler d1 time-travel restore <DB> --timestamp=…`, "destructive… overwrites the database in place"). The two databases restore independently, and nobody has written down what that means for cross-database consistency. `wrangler rollback` does not roll back migrations.
7. **Steps for third-party accounts are missing:** UptimeRobot, the Sentry alert rule (finding 0.5), the Turnstile key, and Google's "In production" switch.
8. **Sequencing.** The repo has never been deployed (placeholder D1 ids). Since there is no data yet, the doc's own "squash to a baseline" window — and any destructive clean-up such as the display_name drop — is **free until the first deploy**. After that, everything is expand→contract.

- **Size:** docs, 2–3 h. CI migration step, about 1 h (a forbidden zone, so the owner). **Who:** owner (config and workflow), build (docs).

### 3.2 Secrets inventory

Everything the code reads, as a checklist for the owner:

- **Required:** `BETTER_AUTH_SECRET`, `VISUAL_CROSSING_API_KEY`, `OPENAI_API_KEY`, `ADMIN_USER_IDS`.
- **Optional:** `STRAVA_CLIENT_ID`/`_SECRET`/`_WEBHOOK_VERIFY_TOKEN`, `SENTRY_DSN`, `GOOGLE_CLIENT_ID`/`_SECRET`, `FIRECRAWL_API_KEY`.
- **Vars, not secrets:** `BETTER_AUTH_URL`, `NODE_ENV`, and a proposed `STRAVA_SUBSCRIPTION_ID` (for finding 0.10).
- **Coming:** Turnstile secret, and email credentials if Cloudflare Email is not a binding.

### 3.3 Custom domain and routes — none

- **Evidence:** `wrangler.jsonc` has no `routes`/`custom_domain`. The deploy job is named "Deploy to workers.dev".
- **Why it matters:** these all need a zone we own:
  - Google brand verification and the privacy-policy-on-domain rule;
  - the email sending domain;
  - the CSAM tool;
  - WAF rules, rate-limiting rules and geo-blocking;
  - Strava's single "Authorization Callback Domain";
  - `BETTER_AUTH_URL`.
  - Put the domain in place **before** registering the Strava webhook and Google redirect URIs, or they have to be redone.
- **Size:** 1 h of owner time. **Who:** owner.

### 3.4 Staging — none

- The owner is fine without it for launch **if** CI applies migrations and gradual deployments are used.
- A second Strava app is needed for staging (deployment.md §6 notes this).
- **Soon-after.**

### 3.5 Monitoring

- **Sentry:** see findings 0.4 and 0.5.
- **Dead-man switch:** nothing alerts if crons stop firing altogether — a digest that never runs reports nothing. Add a check-in: Toucan supports `captureCheckIn` (Sentry Crons), or ping healthchecks.io/UptimeRobot from each cron.
- **Admin digest delivery:** the digest goes to Sentry only (`ops/scheduled.ts:411-426`), while architecture.md says "Admin email/notification". Cloudflare Email sends "to verified destination addresses are free", so emailing the owner the digest is essentially free once email exists.
- **Uptime:** there is no `/health` build info (architecture promises it). Minor.
- **Size:** 0.5 day. **Who:** build, plus owner dashboard steps.

### 3.6 Rate limiting, WAF and Turnstile — none built

- **Evidence:** `grep turnstile|ratelimit` finds only `architecture.md:375`. Plus finding 0.7.
- **Why it matters:** open email sign-up with no bot check lets anyone script accounts. Each account can:
  - upload photos → OpenAI calls and R2 storage;
  - create products → Firecrawl credits and OpenAI extraction tokens;
  - log runs → Visual Crossing records;
  - post UGC.
  - There are no per-user quotas anywhere (upload size caps exist; count caps are per entry only).
- **Fix:**
  - Turnstile on sign-up (free, unlimited).
  - Workers Rate Limiting binding (GA; period "10 or 60" seconds; "permissive, eventually consistent") on auth, upload, product-create and webhook routes — or zone WAF rules.
  - Set `rateLimit` explicitly in `createAuth`.
- **Size:** 1–1.5 days. The binding is a `wrangler.jsonc` edit, so the owner signs off.
- **Who:** owner (bindings), design (Turnstile placement on Au1), build.

### 3.7 Cost guardrails — none in code; set vendor caps in dashboards

- **OpenAI:** set a monthly budget limit. Moderation is free, but extraction is not.
- **Firecrawl:** its plan cap is the limit.
- **Visual Crossing:** see §1.8. There is no documented cap, so fix finding 0.6 before switching to Metered.
- **Cloudflare:** set usage notifications for Workers, D1 and R2.
- Workers AI is not used at all; the docs are stale on this.
- **Size:** 1 h of owner time.

### 3.8 Queues, DLQs and crons

- Fine as designed:
  - DLQ consumers are bound and report to Sentry (`ops/queues.ts:67-76`).
  - Crons match `wrangler.jsonc` (conformance test).
  - Import-failure DLQ handling notifies the user.
- Weak points:
  - The only human-facing channel is Sentry (see above).
  - Design-deltas item 10 (the dead-letter list on The Desk) is "drawn, not built". With findings 0.4 and 0.5 unfixed, a dead-lettered job is effectively invisible.

### 3.9 Security headers — none

- **Evidence:** no CSP, HSTS, `frame-ancestors`/X-Frame-Options, Referrer-Policy or Permissions-Policy anywhere in `src` or config.
- **Why it matters:** the auth forms can be framed (clickjacking). **Best practice.**
- **Fix:** set the headers in `server.ts` around `startFetch`, or with a zone Transform Rule.
- **Size:** 2–4 h (the CSP needs care because of the MediaPipe WASM).

---

## 4. Notifications and email

- **Today:** four notification kinds, in-app only (`notifications/service.ts:14`): `kit_reminder`, `import_failed`, `strava_reminder`, `strava_broken`. D-1's text ("emails the user") is wrong — no email path exists.
- **Recommended email set:**

| Event                                      | Email?                                                                                                  | CAN-SPAM class (FTC: transactional/relationship vs commercial)                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Verify email, password reset, email change | yes, must                                                                                               | transactional                                                                                                |
| Strava "you ran — log it"                  | yes, **opt-out default on** — the retention hook is dead in-app for anyone who isn't already in the app | likely transactional/relationship (a service they switched on). Give it an off switch anyway (best practice) |
| Strava connection broken / revoked         | yes                                                                                                     | transactional                                                                                                |
| Import failed (DLQ)                        | optional                                                                                                | transactional                                                                                                |
| Content removed / hidden, ban              | yes. Also the DSA "statement of reasons" if EU users are allowed                                        | transactional                                                                                                |
| Admin digest                               | yes (to the owner only; free to verified addresses)                                                     | n/a                                                                                                          |
| Re-engagement, "people you follow posted"  | not at launch                                                                                           | commercial → unsubscribe required. FTC: "penalties of up to $53,088" per email                               |

- **Needs:**
  - a `notification_preferences` table (additive migration);
  - one-click `List-Unsubscribe` on non-transactional mail;
  - an email wrapper with a physical address in the footer if anything is ever commercial.
- **Push:** PWA push is post-MVP (Epic 203). Nothing to do.
- **Size:** 2–3 days for the plumbing plus these kinds. **Who:** owner (which kinds, and whether reminders are default-on), design (email templates are an undesigned surface), build.

---

## 5. Trust and safety (task 106 status, verified in code)

| Packet 106 item                    | Status on main                                                                                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Photo screening                    | Built. Uses **OpenAI**, not Workers AI. Without `OPENAI_API_KEY` every photo stays `pending` and is never public. Garment-photo flags notify nobody (D-69, open). |
| Report → hide → review             | Built for entries, photos and products. The report link is on D and H (`routes/feed/entry…`, `u.$userId`). A **profile** report cannot result in any action.      |
| Link hygiene                       | Built: `ProductLink` has `rel="ugc nofollow noopener"`; denylist is enforced in `closet/service.ts`.                                                              |
| Bans                               | **Mostly unbuilt** — finding 0.3. There is also no ban notice, which the packet relies on for appeals ("email in the ban notice").                                |
| Under-review marker for the author | Missing. D-62 is open; the constant has since been deleted.                                                                                                       |
| Unblock (D-64)                     | Fixed in PR #104 (settings row → `/safety/blocked`). Closes on merge.                                                                                             |

Further gaps:

- **Usernames (in flight):**
  - Add a reserved-name list (`admin`, `dialed`, `support`, `strava`, `moderator`, …) and a denylist check at claim time.
  - Let a moderator force-rename a profile. That is what "Remove" on a profile report should do.
  - Impersonation is otherwise handled only by ban, which doesn't work (0.3).
  - About 0.5 day on top of the username lane.
- **Admin access:** reaching the review UI needs `ADMIN_USER_IDS` in production (D-72's CI line is a separate issue).
- **Admin console for a ban:** today banning means calling a server function by hand. At minimum, add a Ban control on the review row for profile reports (1 day including sign-in gate and content filter). **Who:** design (The Desk D1 already draws it?), build.

---

## 6. A stranger's first week

- **404/500:** fixed in PR #104 (`defaultNotFoundComponent`, `defaultErrorComponent`, X1/X2). On main, TanStack's bare defaults are still live.
- **Meta, OG, favicon, manifest, robots:**
  - Only `<title>[dialed.run]</title>` exists (`__root.tsx`). No description, no OG tags; a shared entry link previews as a bare title.
  - `public/` contains only `fonts/` and `mediapipe/`: no favicon (every tab shows a generic icon, and `/favicon.ico` hits the Worker as a 404 SSR render), no web manifest, no `robots.txt`.
  - Decide whether public profiles and entries should be indexable: runner names plus photos in Google is a privacy call.
  - **Size:** 0.5 day. **Who:** design (icon, OG card — undesigned surfaces), owner (indexing), build.
- **Landing hero:** open (D-93; PR #104 asks the owner).
- **Accessibility:**
  - D-84(b): tap-to-blur is canvas `onClick` with no keyboard path. The row itself says it "should not wait", and it is still open on main and in #104.
  - D-84(a)/(c), D-86 and D-87 are minor.
  - Legal: ADA Title III web claims are a real litigation pattern in the US (**risk, not a clear statutory requirement for a small app**).
- **Copy pass (D-45):** "before launch", still `ready`. Undone.
- **Icon pack adoption (D-30/D-31):** 3 files render `<Icon>`; the tab bar is still text. "Audited at the launch gate."
- **Following feed breaks past 92 follows (D-101):** waiting on the owner. For a social app this is a guaranteed launch bug for any well-connected early user. About 0.5 day plus EXPLAIN evidence.
- **Performance budgets:** no documented budget. The client bundle is guarded by `check:bundle` against server-only code, but not by size. Soon-after.

---

## 7. Data integrity

- **Expand→contract backlog:**
  - the `display_name` drop (usernames lane);
  - legacy `source='manual'` rows in `weather_observations` (`store.ts:10-13`, "still in the table").
  - Both are **free to do destructively before the first production deploy** (§3.1 item 8).
- **Outboxes:**
  - `strava_revocations` is broken by finding 0.1.
  - Its drain rides the **daily** digest (`scheduled.ts:419`). That's fine, apart from the expiring-token problem.
  - The outbox row stores a live access token in plain text. Once refresh is fixed, store the refresh token and refresh-then-revoke. Consider app-level encryption for `strava_connections` tokens (**best practice**; D1 is encrypted at rest by Cloudflare).
- **Orphans:** R2 orphans (D-27, `watch`) become more visible once deletion exists. Deletion must be claim-then-delete to avoid the reverse orphan (a row pointing at a deleted object).
- **Idempotency:** creates are covered (task 108, `test/idempotency.test.ts`). Not checked beyond that.
- **Backups:** R2 has no versioning or backup, and `MEDIA` is "the source of truth" with no point-in-time recovery. A bad bulk delete (e.g. from the new account-deletion code) is permanent. Mitigate with a delayed deletion (tombstone and a 7-day purge). Soon-after.

---

## 8. Deferred rows whose trigger is launch — real status

| Row   | Register says                                 | Real status (verified)                                                                                                                      |
| ----- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1   | blocked, "before Strava OAuth for real users" | **Stale.** Fixed in dfc1e39. But the fixed function is **never called in production** (finding 0.1), so the underlying goal is still unmet. |
| D-3   | blocked                                       | Still open (`closet/photos.ts:111`, no pixel cap). Known; fix chosen.                                                                       |
| D-4   | ready                                         | **Stale — done** in 93bb336 (webhook enqueues; `webhook.ts:72-89`).                                                                         |
| D-105 | blocked                                       | Open. Known. See §1.6 for the GDPR-grade bar Strava sets.                                                                                   |
| D-71  | blocked                                       | Open. **Insufficient as scoped** (§1.10).                                                                                                   |
| D-32  | ready, "before the launch gate for R/S/T/U"   | Largely in flight via PRs #101–#104. U1's Account, Notifications, Export and Delete rows are still unbuilt (#104's own register).           |
| D-45  | ready, "before launch"                        | Open.                                                                                                                                       |
| D-30  | ready, "audited at the launch gate"           | Open (3 files use `<Icon>`).                                                                                                                |
| D-84  | ready; (b) "should not wait"                  | Open on main and in #104.                                                                                                                   |
| D-102 | ready                                         | 3 of 11 fixed by task 120; the rest ride #101–#104. The "garment photo blur privacy gap" item is fixed.                                     |
| D-64  | ready                                         | Fixed in #104; closes on merge.                                                                                                             |
| D-62  | ready                                         | Open. The text is slightly stale (the constant is gone).                                                                                    |
| D-72  | blocked on one owner line                     | Open.                                                                                                                                       |
| D-101 | waiting on owner                              | Open. Recommend before launch.                                                                                                              |
| D-8   | blocked                                       | Open (`note` is still never sent). A product call.                                                                                          |
| D-37  | ready                                         | **Stale — done** by task 114 (`ui/Skeleton.tsx` breathes).                                                                                  |
| D-67  | blocked                                       | Dormant until a product page renders images. Needs the §1.2 takedown path when it does.                                                     |

**Stale rows to retire or correct:**

- D-1 — retire, and open a new row for finding 0.1.
- D-4 — retire.
- D-37 — retire.
- D-62 — wording.
- D-64 — retire when #104 merges.

**Stale architecture claims:**

- "photo screening via Workers AI" (launch gate paragraph);
- "CI applies migrations before deploy";
- "Turnstile on signup, WAF rate limits… These are free";
- "Admin email/notification";
- `/health` "build info".

---

## 9. Proposed ordering

### Must-before-public-sign-ups

1. **Strava capacity application** (owner, today — longest lead time) and the official Connect button (design, then build).
2. **Custom domain** (owner, 1 h). Many items below depend on it.
3. **Sentry actually delivering** (0.4, 0.5) and a cron heartbeat — 0.5 day. Otherwise everything else fails silently.
4. **deployment.md fixes, CI migration step, and `NODE_ENV`/`BETTER_AUTH_URL` vars** (§3.1, 0.7) — 0.5 day plus owner edits.
5. **Terms of Service and privacy policy** (§1.1, D-105), DMCA agent registration (§1.2), minimum-age clause (§1.3). Also the geography decision (§1.4) — owner.
6. **Email plumbing plus password reset and verification** (§2.3). Verification is already planned.
7. **Account deletion including Strava revocation**, and the Strava refresh-before-revoke and deauth-event handling (0.1, 0.2, §2.1) — about 3–4 days together.
8. **Retract your own post / photo** (0.9, §2.5) — 1 day.
9. **Strip EXIF server-side** (0.8) — about 0.5 day (photon re-encode; this pairs with the D-3 fix).
10. **Bans that work** (0.3) — 1 day. Plus reserved usernames.
11. **Turnstile, rate limits and vendor spend caps** (§3.6, §3.7) — 1.5 days plus owner.
12. **The Visual Crossing 24× fix and a plan choice** (0.6, §1.8) — 0.5 day.
13. **CSAM coverage decision and NCMEC procedure** (§1.10).
14. **Webhook `subscription_id` check** (0.10) — 1 h.
15. **Google consent screen "In production"** (§1.7) — owner.
16. Already known items: D-3 and the D-71 dashboard step.

### Should-before

- Data export (§2.2).
- Change password / sign out everywhere (§2.4).
- Strava reminder and broken-connection emails with an opt-out, and the admin digest by email (§4).
- Ban and removal notices (§4/§5).
- D-101.
- D-84(b).
- The D-45 copy pass.
- Security headers (§3.9).
- Favicon, OG and robots decision (§6).
- The 7-day Strava id prune (§1.6).
- Author "under review" marker (D-62).
- Deletion runbook and Time Travel restore drill.

### Soon-after

- Staging environment.
- R2 backup / tombstoned deletes.
- Move to `/oauth/revoke` (hard deadline 1 June 2027).
- Token encryption.
- The Desk's dead-letter list.
- Performance budget.
- D-30/D-31 icon adoption.
- Notification preferences beyond the reminder toggle.
- DSA/UK OSA work if the geography opens.

---

## Sources (fetched 2026-09-25)

- Strava API Policy (effective 1 June 2026): https://www.strava.com/legal/api_policy — §2.3, §4.1, §5.3, §6.2, §6.3, §7.3, §7.4.
- Strava API Agreement: https://www.strava.com/legal/api
- Strava rate limits: https://developers.strava.com/docs/rate-limits/ — "athlete capacity of 1".
- Strava brand guidelines: https://developers.strava.com/guidelines/
- Strava webhooks: https://developers.strava.com/docs/webhooks/
- Strava authentication (`/oauth/revoke` note): https://developers.strava.com/docs/authentication/
- Strava developer programme update: https://communityhub.strava.com/insider-journal-9/an-update-to-our-developer-program-13428
- Google OAuth verification: https://support.google.com/cloud/answer/13463073
- Google brand verification requirements: https://support.google.com/cloud/answer/13464321
- Google Testing vs production: https://support.google.com/cloud/answer/15549945
- Visual Crossing pricing and attribution: https://www.visualcrossing.com/weather-data-pricing/
- Visual Crossing record counting: https://www.visualcrossing.com/resources/documentation/weather-data/understanding-and-optimizing-the-visual-crossing-weather-pay-as-you-go-plan/
- Visual Crossing terms: https://www.visualcrossing.com/weather-services-terms/
- Cloudflare CSAM scanning: https://developers.cloudflare.com/cache/reference/csam-scanning/
- Cloudflare D1 Time Travel: https://developers.cloudflare.com/d1/reference/time-travel/
- Cloudflare Email Service: https://developers.cloudflare.com/email-service/ (plus `/platform/pricing/`, `/platform/limits/`)
- Workers Rate Limiting binding: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- Turnstile plans: https://developers.cloudflare.com/turnstile/plans/
- US Copyright Office DMCA directory FAQ: https://www.copyright.gov/dmca-directory/faq.html
- FTC COPPA FAQ: https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions
- FTC CAN-SPAM compliance guide: https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
- GDPR text: gdpr-info.eu — Arts. 3, 13, 17, 20, 27, 28.
- ICO guidance on PECR cookies.
- SIL OFL FAQ: https://openfontlicense.org/ofl-faq/
