# Launch development plan

Everything that has to be **built** before dialed.run takes users, grouped by
the five lanes that build it. The source is the production-readiness audit
(`docs/reconciliation/2026-09-25-production-readiness-audit.md`, cited below
as §N or finding 0.N) and the owner's decisions of 2026-09-25 (decisions
D-37 to D-47 in `docs/decisions.md`).

**Numbering.** A bare `D-N` is a row in `docs/deferred.md`. A decision-log
row is always written "decision D-NN": the two registers share a prefix,
and past D-09 the padding no longer tells them apart (register D-45 is the
copy pass; decision D-45 is the photo-size fix).

**This is the development half only** (decision D-37). Anything that is a
dashboard, an account, a legal registration or a config edit lives in
`docs/launch/deployment-plan.md`, which runs as its own sweep **after** this
one lands. Where an item here has a deployment half, the deployment plan
cites it back.

The lanes run in parallel worktrees. Their packets are
`docs/tasks/125-129-launch-development.md` (shared rules) and one packet
each:

| task | lane             | packet                  | starts                                     |
| ---- | ---------------- | ----------------------- | ------------------------------------------ |
| 125  | Ops & platform   | `125-ops-platform.md`   | now                                        |
| 126  | Accounts         | `126-accounts.md`       | after PR #104 merges                       |
| 127  | Strava & logging | `127-strava-logging.md` | now                                        |
| 128  | Content & safety | `128-content-safety.md` | now (after PR #101 merges, for the outbox) |
| 129  | Feed             | `129-feed.md`           | after PR #102 merges                       |

## How to read the markers

The rollout is staged (decision D-38): the owner alone, then invited
friends, then the public. Every item carries the first stage it must be
true for:

- **[F] before friends** — the first person who is not the owner. Friends
  are real users with real data: their photos carry GPS, their Strava
  grants are contractual, and one of them will forget a password.
- **[P] before public** — the first stranger, meaning the first person who
  got an invite code by requesting access rather than from the owner.

All of it lands before the deployment sweep starts (decision D-37). The marker is
there so the lanes know what to finish first, and so that if development
slips the sweep knows which gate it can still open.

---

## 125 · Ops & platform

| #      | item                                                                                                                                                                                                                                                                                                                                                                       | cites                   | stage |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----- |
| OPS-1  | **Sentry actually delivers.** `reportException` keeps the Worker alive with `waitUntil` (from `cloudflare:workers`, or a threaded `ctx`), on fetch, queue and cron paths alike. Proven by a test error sent from a cron, not only from fetch.                                                                                                                              | 0.4, §3.5               | F     |
| OPS-2  | **Every digest day can alert.** The digest event is fingerprinted by anomaly kind and tagged, so day two is not folded into day one's issue. The alert rule itself is a deployment step.                                                                                                                                                                                   | 0.5                     | F     |
| OPS-3  | **Cron heartbeat.** Each cron checks in (Sentry Crons via Toucan's `captureCheckIn`, or an external ping), so a digest that never runs is noticed.                                                                                                                                                                                                                         | §3.5                    | F     |
| OPS-4  | **Auth runs in production mode without relying on `NODE_ENV`.** `instance.ts` passes `baseURL` from `BETTER_AUTH_URL`; `createAuth` sets `rateLimit` explicitly (enabled, with **database** storage so it is shared across isolates, an additive auth-schema table) and the secure-cookie behaviour explicitly. `/api/health` reports a missing `BETTER_AUTH_URL`.         | 0.7, §3.6               | F     |
| OPS-5  | **Turnstile**, the verification half and a `ui/` widget. 126 places it on sign-up and request-access. The widget's script origin goes into OPS-8's CSP.                                                                                                                                                                                                                    | §3.6                    | F     |
| OPS-6  | **Weather stops billing 24×.** One Visual Crossing day response stores all 24 hours in the cache (or the request asks for a single datetime; the lane measures which is cheaper).                                                                                                                                                                                          | 0.6, §1.8               | F     |
| OPS-7  | **The Desk shell and Today** (Operator Screens D0; decision D-35). `/desk` behind the admin check, with Today showing the digest's counts. 126 and 128 add their pages to it. The rest of task 110 stays unscheduled.                                                                                                                                                      | decision D-35, §5       | F     |
| OPS-8  | **Security headers**: CSP (report-only first; MediaPipe needs `wasm-unsafe-eval`; Turnstile needs its frame), `frame-ancestors 'none'`, Referrer-Policy, Permissions-Policy, HSTS. Set in `server.ts` around `startFetch`.                                                                                                                                                 | §3.9                    | P     |
| OPS-9  | **Favicon, web manifest, `robots.txt`, OG and description tags.** Icon and OG card are design asks, so they ship as placeholders under the protocol. `robots.txt` and the default robots meta default to noindex until the owner decides (open decision 1, below).                                                                                                         | §6                      | P     |
| OPS-10 | **Legal pages and links**: `/legal/privacy`, `/legal/terms` and `/legal/copyright` (the DMCA contact), linked from the signed-out shell and the landing bar. The text is the owner's; the pages ship with it.                                                                                                                                                              | D-105, §1.1, §1.2, §1.6 | F     |
| OPS-11 | **The admin digest by email** (Operator Screens D5), through 126's email module, to the owner's verified address.                                                                                                                                                                                                                                                          | §3.5, §4                | P     |
| OPS-12 | **`docs/deployment.md` corrected**: `--remote` on migrations, the four missing secrets, the two missing crons, `CLOUDFLARE_ACCOUNT_ID`, a restore runbook for D1 Time Travel across two databases. **Plus a proposed CI diff** (migrations before deploy; deploy `needs: e2e`; D-72's admin line) written for the owner, because `.github/workflows/` is a forbidden zone. | §3.1, D-72              | F     |
| OPS-13 | **Stale claims retired** from `docs/architecture.md`: Workers AI screening, CI migrations (until the diff lands), Turnstile/WAF "free and done", "Admin email/notification" (until OPS-11), `/health` build info.                                                                                                                                                          | §8                      | F     |
| OPS-14 | **Legacy `source='manual'` weather rows**: remove the code path that still expects them. If that means a destructive migration or a tightened constraint, stop and ask: the owner's pre-deploy exception (decision D-41) names `display_name` only.                                                                                                                        | §7                      | P     |

## 126 · Accounts

| #      | item                                                                                                                                                                                                                                                                                                                                                                                                                  | cites                                  | stage |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----- |
| ACC-1  | **Usernames replace `display_name`, which is dropped in the same change** (decision D-41). Claimed at sign-up or onboarding; unique case-insensitively; a reserved and deny list (`admin`, `dialed`, `support`, `strava`, `moderator`, …) checked at claim time. Every `display_name` reader in every lane moves in this one PR. **Must merge before the first production deploy**, or the exception no longer holds. | §5, §7, decision D-41                  | F     |
| ACC-2  | **Email plumbing**: the `send_email` binding (owner-authorised, decision D-42) with a bindings-conformance assertion (law 10); a `modules/email` send interface; templates in React Email if it renders in workerd (verified first), otherwise typed functions producing HTML and text; a `notification_preferences` table.                                                                                           | §2.3, §4, decision D-42, decision D-43 | F     |
| ACC-3  | **Email verification** required for email/password accounts. Google accounts arrive verified.                                                                                                                                                                                                                                                                                                                         | decision D-42                          | F     |
| ACC-4  | **Password reset** ("Forgot it?" on Au2–Au4, Au7).                                                                                                                                                                                                                                                                                                                                                                    | §2.3                                   | F     |
| ACC-5  | **Invite codes, request access, and their Desk pages** (decision D-39). Sign-up (email and Google both) requires a valid code; codes are created and tracked in the Desk; a public request-access form (Turnstile-guarded) lists requests in the Desk.                                                                                                                                                                | decision D-39                          | F     |
| ACC-6  | **Terms acceptance on Au1**, with the minimum-age statement the owner's terms set.                                                                                                                                                                                                                                                                                                                                    | §1.1, §1.3                             | F     |
| ACC-7  | **Password change and sign out everywhere** (U1 Account).                                                                                                                                                                                                                                                                                                                                                             | §2.4                                   | P     |
| ACC-8  | **Email change**, confirmed from the new address, with notice to the old one.                                                                                                                                                                                                                                                                                                                                         | §2.4                                   | P     |
| ACC-9  | **Account deletion.** Claim, then delete: sessions revoked and content hidden at once; a 7-day tombstone the runner can cancel; then a purge across core, weather (cross-database, law 8c), R2 `MEDIA` and `IMPORTS`, and Better Auth, with Strava refresh-then-revoke (127) and 128's delete primitives. Shared `products` stay. An explicit exception to "retire, don't delete".                                    | §2.1, 0.9, §7                          | P     |
| ACC-10 | **Data export**: a JSON download of profile, closet, runs, entries and photo links. Derived per-run conditions only, never raw Visual Crossing rows (licence).                                                                                                                                                                                                                                                        | §2.2, §1.8                             | P     |
| ACC-11 | **Notification settings**: the Strava reminder email on by default with an off switch (U1 Notifications). Transactional mail has no switch.                                                                                                                                                                                                                                                                           | §4, decision D-43                      | P     |
| ACC-12 | **Moderator force-rename** from the Desk (the profile-report "Remove" becomes a rename or a ban).                                                                                                                                                                                                                                                                                                                     | §5, 0.3                                | P     |

## 127 · Strava & logging

| #      | item                                                                                                                                                                                                                                                                         | cites             | stage |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----- |
| STR-1  | **Token refresh wired into real use**: every call needing a live access token (today, revocation) refreshes first. D-1's broken-state logic becomes reachable or is deleted as dead.                                                                                         | 0.1               | F     |
| STR-2  | **The revocation outbox can succeed**: `strava_revocations` carries what a later refresh needs, and the drain does refresh-then-revoke.                                                                                                                                      | 0.1, §7           | F     |
| STR-3  | **Athlete deauthorization handled**: `object_type: "athlete"`, `authorized: "false"` deletes our tokens and athlete id well inside 30 days, and tells the runner (in-app and a transactional email via 126).                                                                 | 0.2, §1.6         | F     |
| STR-4  | **The webhook authenticates**: `subscription_id` compared with ours (a `STRAVA_SUBSCRIPTION_ID` var). Moved here from 125's scope because it is the same file as STR-3.                                                                                                      | 0.10              | F     |
| STR-5  | **Deauthorize through `POST /oauth/revoke`**, done with STR-1 because it is the same call.                                                                                                                                                                                   | §1.6              | F     |
| STR-6  | **The 11th athlete gets a real message**, not a generic connect failure. The friends phase runs at the 10-athlete cap, so the eleventh friend meets this.                                                                                                                    | §1.6              | F     |
| STR-7  | **The official "Connect with Strava" button** on T1, linking to `/oauth/authorize`. Design places it. Must ship before the owner applies for Strava review.                                                                                                                  | §1.6              | F     |
| STR-8  | **Round 25**: Log a run as a desk page (A1–A3 in DS1's two columns from 1040, rail read-only); "Strava reminds. You upload." (reminder copy and timing, one per run, cleared by a matching upload; T3a's status line; auto-import toggle removed; T2 retired; DS2's header). | round 25          | P     |
| STR-9  | **The Strava reminder email**, sent through 126's interface and honouring ACC-11's switch.                                                                                                                                                                                   | §4, decision D-43 | P     |
| STR-10 | **7-day prune of Strava ids** in `processed_webhook_events` and `notifications.subject`, run from the existing daily firing. Moved here from 125's scope: the tables are this lane's.                                                                                        | §1.6              | P     |

## 128 · Content & safety

| #      | item                                                                                                                                                                                                                                  | cites                         | stage |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----- |
| SAF-1  | **EXIF stripped on the server**: every stored photo is re-encoded (Photon), entry photos included, with or without W3's blur; garment `original.*` too.                                                                               | 0.8                           | F     |
| SAF-2  | **D-3**: the browser downscales before upload (long edge capped, e.g. 2048px, inside the existing W3 canvas step), and the server enforces a decoded-pixel cap as the backstop (decision D-45).                                       | D-3 (deferred), decision D-45 | F     |
| SAF-3  | **Delete your own entry, run and entry photo**, with R2 deletion through #101's outbox (claim-then-delete; no reverse orphan). These are the primitives 126's account deletion reuses.                                                | 0.9, §2.5                     | F     |
| SAF-4  | **Bans that work**: sign-in blocked (Operator Screens D4), content hidden everywhere through the one visibility rule, a Desk ban control (D3), the ban notice email via 126.                                                          | 0.3, §5                       | P     |
| SAF-5  | **A moderator's Remove deletes the bytes**, except where the NCMEC procedure requires preservation, in which case it quarantines them.                                                                                                | 0.9, §1.10                    | P     |
| SAF-6  | **Admin takedown (DMCA)**: remove a named photo or entry from the Desk, with an audit row.                                                                                                                                            | §1.2                          | P     |
| SAF-7  | **Public-entry photos through short-lived signed URLs**, cacheable for their TTL on the custom zone so Cloudflare's CSAM tool sees them. Private and closet photos stay `private`. Screening still gates every photo (decision D-46). | D-71, §1.10, decision D-46    | P     |
| SAF-8  | **Content-removed notice** to the author (in-app, and an email via 126) carrying the statement of reasons the DSA asks for.                                                                                                           | §4, §1.4                      | P     |
| SAF-9  | **D-62**: the owner sees "under review" on their own hidden entry. The safety half is here; the feed surfaces are 129's (FEED-6).                                                                                                     | D-62                          | P     |
| SAF-10 | **D-69**: a flagged garment photo tells its owner it is being checked.                                                                                                                                                                | D-69                          | P     |
| SAF-11 | **D-84(b)**: W3's tap-to-blur has a keyboard path (buttons named by position).                                                                                                                                                        | D-84                          | P     |

## 129 · Feed

| #      | item                                                                                                                                                                                            | cites     | stage |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----- |
| FEED-1 | **Noindex by default** on public profiles and entries (robots meta per route, matching OPS-9's `robots.txt`). The owner has not decided whether to be indexed; default is no (open decision 1). | §6        | F     |
| FEED-2 | **O1 → `resolvePlace`**, if #102/#104 have not already wired it (check first: #104's "Needs" item 1).                                                                                           | #104      | F     |
| FEED-3 | **The bell counts runs awaiting a verdict**, through `runsAwaitingVerdict`, with the 14-day window gone (#102's follow-up).                                                                     | #102      | P     |
| FEED-4 | **D-101**: the following feed works past 92 follows (subquery on `follows`, with `EXPLAIN QUERY PLAN` evidence).                                                                                | D-101, §6 | P     |
| FEED-5 | **One writer for the profile city** (`user_profiles` city/lat/lng), exported through onboarding's index and used by Your conditions.                                                            | #102      | P     |
| FEED-6 | **D-62's feed half**: the marker on the author's own entry card and entry detail, reading 128's predicate.                                                                                      | D-62      | P     |
| FEED-7 | **Banned and deleting authors leave search and profiles**, using the predicate 128 and 126 export.                                                                                              | 0.3, §2.1 | P     |
| FEED-8 | **Visual Crossing attribution on every conditions surface** (EntryDetail, the feed list, Your conditions); the audit saw it on two.                                                             | §1.8      | P     |
| FEED-9 | **Round 25 on Your conditions**: "in these conditions" — the eyebrow, the line, and E1's compact line.                                                                                          | round 25  | P     |

---

## Should-before and soon-after, triaged

The audit's §9 lists items it would do before public sign-ups without
calling them blockers ("should-before"), and items for after launch
("soon-after"). Where they went:

**Should-before** — every one is in a lane above:

| audit item                                                 | lane and item                                            |
| ---------------------------------------------------------- | -------------------------------------------------------- |
| Data export (§2.2)                                         | 126 · ACC-10                                             |
| Change password / sign out everywhere (§2.4)               | 126 · ACC-7                                              |
| Reminder and broken-connection emails with an opt-out (§4) | 127 · STR-3, STR-9; 126 · ACC-11                         |
| Admin digest by email (§4)                                 | 125 · OPS-11                                             |
| Ban and removal notices (§4/§5)                            | 128 · SAF-4, SAF-8                                       |
| D-101                                                      | 129 · FEED-4                                             |
| D-84(b)                                                    | 128 · SAF-11                                             |
| The D-45 copy pass                                         | **design + owner**, not a lane (see Design dependencies) |
| Security headers (§3.9)                                    | 125 · OPS-8                                              |
| Favicon, OG and robots (§6)                                | 125 · OPS-9; 129 · FEED-1                                |
| 7-day Strava id prune (§1.6)                               | 127 · STR-10                                             |
| Author "under review" marker (D-62)                        | 128 · SAF-9; 129 · FEED-6                                |
| Deletion runbook and Time Travel restore drill             | 125 · OPS-12 (runbook); the drill is a deployment step   |

**Soon-after** — not in this sweep unless a lane finishes early; each has
an owner for when it is picked up:

| audit item                                   | goes to                                                                                                                            |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Staging environment (§3.4)                   | deployment plan (a second Strava app, a second Worker)                                                                             |
| R2 backup beyond ACC-9's tombstone (§7)      | 125                                                                                                                                |
| Move to `/oauth/revoke`                      | **pulled forward** into 127 · STR-5 (same call as STR-1)                                                                           |
| Token encryption at the app level (§7)       | 127                                                                                                                                |
| The Desk's dead-letter list (D6 · Gave up)   | 125                                                                                                                                |
| Performance budget                           | 125                                                                                                                                |
| D-30 / D-31 icon adoption                    | a later adoption lane; `ui/` has no owner in this sweep                                                                            |
| Notification preferences beyond the reminder | 126                                                                                                                                |
| DSA / UK OSA work                            | **pulled forward**: decision D-40 keeps EU/UK open, so the legal half is in the deployment plan and the notice half is 128 · SAF-8 |

## Design dependencies

The asks that go to the design agent. Lanes build every one of these as a
placeholder under CLAUDE.md's protocol and do not wait; the design round
replaces the placeholder. Grouped by lane so the coordinator can write one
prompt.

**Accounts (126)**

1. **Usernames**: the claim field (sign-up or onboarding), taken and
   reserved errors, and `@username` everywhere a name renders. (Already
   round 24's open ask; restated so it is not lost.)
2. **Invite code on Au1**: the field, and its invalid, used and expired
   states. Where a Google sign-up enters its code.
3. **Request access**: the form, its receipt, and how a signed-out visitor
   finds it from the landing page and Au1.
4. **Desk · Invites and Desk · Requests**: create a code, see who used
   which, list requests, and act on one. Under D0's shell.
5. **Verify email**: check your inbox, verified, link expired, resend.
6. **Password reset**: "Forgot it?", the request, check your inbox, set a new
   password, link expired.
7. **U1 Account**: change email, change password, sign out everywhere.
8. **U1 Notifications**: the reminder email switch, and a line saying
   transactional mail cannot be switched off.
9. **Export**: the U1 row and what the runner gets.
10. **Delete account**: the confirm flow, the 7-day pending state, and
    what signing in during those 7 days shows.
11. **Email templates**: verify, reset, email change (to both addresses),
    Strava reminder, Strava broken or revoked, content removed, ban notice.
    D5 draws the digest; the rest are undrawn. Email-safe type fallback for
    Archivo and Plex Mono.
12. **Terms acceptance and age line on Au1**, and the Turnstile widget's
    place on Au1 and request access.
13. **Moderator force-rename**: the Desk control beside D3's ban panel, and
    what the renamed runner sees.

**Strava & logging (127)**

14. **The official Connect with Strava button on T1**: Strava's asset,
    unmodified, placed within our layout (it replaces the pink `PRIMARY`).
15. **The 11th-athlete state**: what a runner sees when Strava's capacity is
    full. Copy included.
16. **Strava disconnected from Strava's side**: the S1 row and the email.

**Content & safety (128)**

17. **Delete an entry, a run, an entry photo**: the overflow on D/E1, the run
    detail action, the confirms.
18. **Content removed**: the in-app notice and the email, with the reason.
19. **D-62's under-review marker** on the author's own card and detail.
20. **D-69's notice** on a garment whose photo is being checked.
21. **D-84(b)'s keyboard path for blur**: what focusable blur targets look
    like.

**Ops & platform (125)**

22. **Favicon and app icon set**, the manifest's colours, and **the OG card**
    for a shared entry and a shared profile.
23. **Legal pages** (privacy, terms, copyright contact): layout, and where
    the links sit in the signed-out shell and the landing bar.

**Already with design or the owner, not new asks**: D-45's copy pass (one
pass across every placeholder these lanes ship, owner's call 2026-09-11);
D-93's landing hero; round 24's other open asks.

## Owner decisions still open

Lanes build to the default in brackets and do not wait:

1. **Indexing** of public profiles and entries [noindex].
2. **Retention on account deletion**: keep reports a deleted runner filed
   against others, anonymised? [keep, with the reporter id nulled].
3. **Does "public" keep invite codes**, or open sign-up once the Strava
   review lands? [keep codes; decision D-39 does not say otherwise].
4. **The Workers Rate Limiting binding** on upload, product-create and the
   webhook, or zone WAF rules only [WAF rules only; the binding is not
   authorised].
5. **Legacy weather rows** (OPS-14), if removing them is destructive.

## Not placed, and why

- **§1.9 fonts**: compliant; the audit says no action.
- **§1.5 cookie notice**: no banner is needed; the paragraph belongs in the
  policy text, which is the owner's (deployment plan).
- **Import-failed email** (§4, "optional"): not in decision D-43's list of emails.
  In-app only.
- **D-8** (the per-item note's write half): a product call the audit did
  not put on the launch path. Stays blocked in the register.
- **D-67** (product images): dormant until a product page renders one.
- **D-84(a)/(c), D-86, D-87**: minor; the audit calls them so.
