# Launch development plan

Everything that has to be **built** before dialed.run takes users, grouped by
the five lanes that build it. The source is the production-readiness audit
(`docs/reconciliation/2026-09-25-production-readiness-audit.md`, cited below
as §N or finding 0.N), the owner's decisions of 2026-09-25 (decisions
D-37 to D-52 in `docs/decisions.md`), design round 26 (`docs/design-deltas.md`,
"Answered in round 26", cited as round 26 #N), and six defects the privacy
policy's drafter found in the code (PR #109; register D-107 to D-112).

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

| task | lane             | packet                  | starts               |
| ---- | ---------------- | ----------------------- | -------------------- |
| 125  | Ops & platform   | `125-ops-platform.md`   | now                  |
| 126  | Accounts         | `126-accounts.md`       | after PR #104 merges |
| 127  | Strava & logging | `127-strava-logging.md` | now                  |
| 128  | Content & safety | `128-content-safety.md` | now                  |
| 129  | Feed             | `129-feed.md`           | after PR #102 merges |

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

| #      | item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | cites                           | stage |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ----- |
| OPS-1  | **Sentry actually delivers.** `reportException` keeps the Worker alive with `waitUntil` (from `cloudflare:workers`, or a threaded `ctx`), on fetch, queue and cron paths alike. Proven by a test error sent from a cron, not only from fetch.                                                                                                                                                                                                                                       | 0.4, §3.5                       | F     |
| OPS-2  | **Every digest day can alert.** The digest event is fingerprinted by anomaly kind and tagged, so day two is not folded into day one's issue. The alert rule itself is a deployment step.                                                                                                                                                                                                                                                                                            | 0.5                             | F     |
| OPS-3  | **Cron heartbeat.** Each cron checks in (Sentry Crons via Toucan's `captureCheckIn`, or an external ping), so a digest that never runs is noticed.                                                                                                                                                                                                                                                                                                                                  | §3.5                            | F     |
| OPS-4  | **Auth runs in production mode without relying on `NODE_ENV`.** `instance.ts` passes `baseURL` from `BETTER_AUTH_URL`; `createAuth` sets `rateLimit` explicitly (enabled, with **database** storage so it is shared across isolates, an additive auth-schema table) and the secure-cookie behaviour explicitly. `/api/health` reports a missing `BETTER_AUTH_URL`.                                                                                                                  | 0.7, §3.6                       | F     |
| OPS-5  | **Turnstile**, the verification half and a `ui/` widget. 126 places it on sign-up and request access. The widget's script origin goes into OPS-8's CSP.                                                                                                                                                                                                                                                                                                                             | §3.6                            | F     |
| OPS-6  | **Weather stops billing 24×.** One Visual Crossing day response stores all 24 hours in the cache (or the request asks for a single datetime; the lane measures which is cheaper).                                                                                                                                                                                                                                                                                                   | 0.6, §1.8                       | F     |
| OPS-7  | **The Desk shell and Today** (Operator Screens D0; decision D-35). `/desk` behind the admin check, with Today showing the digest's counts. 126 (D7 Access) and 128 (ban panel, Runners) add their pages to it. The rest of task 110 stays unscheduled.                                                                                                                                                                                                                              | decision D-35, §5, round 26 #20 | F     |
| OPS-8  | **Security headers**: CSP (report-only first; MediaPipe needs `wasm-unsafe-eval`; Turnstile needs its frame; OPS-16's renderer may need its WASM), `frame-ancestors 'none'`, Referrer-Policy, Permissions-Policy, HSTS. Set in `server.ts` around `startFetch`.                                                                                                                                                                                                                     | §3.9                            | P     |
| OPS-9  | **Icons, manifest, robots, description tags.** Now drawn (round 26 #22): "[d]" at 512/180/32/16, `favicon.svg`, `favicon.ico`, manifest 192/512 plus a 512 maskable, `theme_color` `#0B0B0E`. `robots.txt` and the default robots meta default to noindex until the owner decides (open decision 1).                                                                                                                                                                                | §6, round 26 #22                | P     |
| OPS-10 | _Moved to 126 · ACC-13._ The legal pages went with the privacy page, which the owner assigned to 126 (decision D-52).                                                                                                                                                                                                                                                                                                                                                               | —                               | —     |
| OPS-11 | **The admin digest by email** (Operator Screens D5), through 126's email module, to the owner's verified address.                                                                                                                                                                                                                                                                                                                                                                   | §3.5, §4                        | P     |
| OPS-12 | **`docs/deployment.md` corrected**: `--remote` on migrations, the four missing secrets, the two missing crons, `CLOUDFLARE_ACCOUNT_ID`, a restore runbook for D1 Time Travel across two databases. **Plus a proposed CI diff** (migrations before deploy; deploy `needs: e2e`; D-72's admin line) written for the owner, because `.github/workflows/` is a forbidden zone.                                                                                                          | §3.1, D-72                      | F     |
| OPS-13 | **`docs/architecture.md` corrected** (D-111): screening is OpenAI `omni-moderation-latest`, not Workers AI; extraction is OpenAI plus Firecrawl; photos are not served from "public bucket URLs" (they go through the Worker, and after 128 · SAF-7 through signed URLs); Turnstile and WAF are not built until OPS-5 and the zone rules; CI does not apply migrations until the proposal lands; "Admin email/notification" is true only after OPS-11; `/health` has no build info. | §8, PR #109                     | F     |
| OPS-14 | **Legacy `source='manual'` weather rows**: remove the code path that still expects them. If that means a destructive migration or a tightened constraint, stop and ask: the owner's pre-deploy exception (decision D-41) names `display_name` only.                                                                                                                                                                                                                                 | §7                              | P     |
| OPS-15 | **A FormField's focus ring on its border** (outline 2px ink, offset −1px), overriding Accessibility Contract §06 for FormFields only. In `ui/form.tsx` and `a11y.css`, which this lane owns for this item.                                                                                                                                                                                                                                                                          | round 26 #16, decision D-48     | P     |
| OPS-16 | **OG share cards rendered in the Worker**: the default card (round 26 #22) and the per-entry card (1200×630; never the photo, note, route or flags; title `@handle · {temp} {precip}, {verdict}`; private, deleted, banned or unverified entries get the default). **Measure the library's bundle and WASM cost first** and report it in the design doc. 129 adds the entry page's meta that points at it.                                                                          | round 26 #22, decision D-51     | P     |

## 126 · Accounts

| #      | item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | cites                                                | stage |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----- |
| ACC-1  | **Usernames replace `display_name`, which is dropped in the same change** (decision D-41, reaffirmed 2026-09-25 over round 26's expand→contract note). Round 26 #7: sign-up asks email and password only; everyone picks a handle at **O0**, the first onboarding step; 3–20 of `[a-z0-9_]`, not starting with `_`, unique regardless of case, lowercased as typed, checked on Next; a taken handle offers one real free suggestion; a reserved and deny list (`admin`, `dialed`, `support`, `strava`, `moderator`, …). Settings › Username changes it, and **old handles are kept** so `/@old` can say "This runner changed their name." without redirecting. Every `display_name` reader in every lane moves in this one PR; the placements' styling is 129's (FEED-10). **Must merge before the first production deploy.** | §5, §7, decision D-41, round 26 #7                   | F     |
| ACC-2  | **Email plumbing**: the `send_email` binding (owner-authorised, decision D-42) with a bindings-conformance assertion (law 10); a `modules/email` send interface; templates in React Email if it renders in workerd (verified first), otherwise typed functions producing HTML and text; a `notification_preferences` table; **List-Unsubscribe one-click** and a signed, never-expiring unsubscribe link per address and kind, with its landing page (round 26 #19). Round 26 split sending to 125; it stays here because this lane owns the email module and the binding.                                                                                                                                                                                                                                                    | §2.3, §4, decision D-42, decision D-43, round 26 #19 | F     |
| ACC-3  | **Email verification** (round 26 #11). Every email sign-up ends on "Check your email", new or registered address alike (a registered address gets "You already have a dialed.run account"); the link works once for 24 hours; resend states and the rate limit. Google skips it. **Unverified accounts save entries private, and verifying restores the default** (decision D-50; no queued state). Useful, report, email change and reset-by-email open a "Confirm your email first" sheet: this lane exports the predicate and the sheet; 129 and 128 wire their controls to it; 129 shows the nag band.                                                                                                                                                                                                                    | decision D-42, decision D-50, round 26 #11           | F     |
| ACC-4  | **Password reset** ("Forgot it?"). Waits for verification (round 26 #11).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | §2.3                                                 | F     |
| ACC-5  | **Invite codes, request access, and Desk · D7 Access** (decision D-39; round 26 #20). INVITE CODE is the sign-up form's first field, above email and Google; `/join?code=` fills it; the used and invalid messages; "No code? Request access" opens Au5 (email plus an optional 280-character note; "You're on the list" for every address). D7 Access: Requests (oldest first; Send invite mints a single-use code and emails it; Decline is silent) and Codes (`DIAL-XXXX` without 0/O/1/I, label, uses limit, used-by @handles, Copy link, Revoke with a 10 s undo). A code is consumed at account creation. The owner's account is seeded. **One flag removes the field and the request link** at public launch; whether to flip it is the owner's call at the public gate.                                               | decision D-39, round 26 #20                          | F     |
| ACC-6  | **Terms acceptance under the sign-up form**, with the minimum-age statement the owner's terms set, beside decision D-52's privacy line.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | §1.1, §1.3                                           | F     |
| ACC-7  | **Password change and sign out everywhere** (U1 Account).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | §2.4                                                 | P     |
| ACC-8  | **Email change**, confirmed from the new address, with notice to the old one. Waits for verification.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | §2.4                                                 | P     |
| ACC-9  | **Account deletion.** Claim, then delete: sessions revoked and content hidden at once; a 7-day tombstone the runner can cancel; then a purge across core, weather (cross-database, law 8c), R2 `MEDIA` and `IMPORTS`, and Better Auth, with Strava refresh-then-revoke (127) and 128's delete primitives. Shared `products` stay. An explicit exception to "retire, don't delete".                                                                                                                                                                                                                                                                                                                                                                                                                                            | §2.1, 0.9, §7                                        | P     |
| ACC-10 | **Data export**: a JSON download of profile, closet, runs, entries and photo links. Derived per-run conditions only, never raw Visual Crossing rows (licence).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | §2.2, §1.8                                           | P     |
| ACC-11 | **Settings › Notifications** (round 26 #19): per-kind email switches. Run reminders on by default; Useful reads "IN THE APP ONLY"; Account and security reads "ALWAYS SENT" with no switch. **No push column**: PWA push is out of scope (decision D-44).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | §4, decision D-43, round 26 #19                      | P     |
| ACC-12 | **Moderator force-rename** from the Desk (the profile-report "Remove" becomes a rename or a ban).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | §5, 0.3                                              | P     |
| ACC-13 | **Legal pages**: `/privacy` (round 26 #14: a reading page, sticky contents at desk, ids and "↑ Contents" on each H2) at the 620 document measure and the `lead` step (decision D-52), plus `/terms` and `/copyright` (the DMCA contact) in the same layout. Linked from the signed-out footer, under the sign-up form, from Settings › About and from every email footer; **not under the log-in form**. The text is the owner's review of PR #109's draft.                                                                                                                                                                                                                                                                                                                                                                   | D-105, §1.1, §1.2, §1.6, round 26 #14, decision D-52 | F     |
| ACC-14 | **Breached-password check (HIBP)**, if PR #104 does not land with it (it is not on #104's pushed branch as of a7255b2; D-112). Copy per round 26 #17; fails open when unreachable. Password hint and refusal copy per round 26 #18.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | round 26 #17–18, D-112                               | F     |
| ACC-15 | **The Google button** (round 26 #13): the official G, Google's colours and shape, "Continue with Google" on both forms, label in **Archivo, not Roboto** (decision D-49). **Check Google's branding rule on the label font first**, and ask if it requires Roboto. `data-part="google-button"` is exempt from the palette and icon checks; nothing else is.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | round 26 #13, decision D-49                          | F     |
| ACC-16 | **The Call teaser at 15** (round 26 #15): 15 cells, `4 OF 15 VERDICTS`, and the zero state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | round 26 #15                                         | P     |

## 127 · Strava & logging

| #      | item                                                                                                                                                                                                                                                                                                                      | cites                           | stage |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ----- |
| STR-1  | **Token refresh wired into real use**: every call needing a live access token (today, revocation) refreshes first. D-1's broken-state logic becomes reachable or is deleted as dead.                                                                                                                                      | 0.1                             | F     |
| STR-2  | **The revocation outbox can succeed**: `strava_revocations` carries what a later refresh needs, and the drain does refresh-then-revoke.                                                                                                                                                                                   | 0.1, §7                         | F     |
| STR-3  | **Athlete deauthorization handled**: `object_type: "athlete"`, `authorized: "false"` deletes our tokens and athlete id well inside 30 days, and tells the runner (in-app and a transactional email via 126).                                                                                                              | 0.2, §1.6                       | F     |
| STR-4  | **The webhook authenticates**: `subscription_id` compared with ours (a `STRAVA_SUBSCRIPTION_ID` var). Moved here from 125's scope because it is the same file as STR-3.                                                                                                                                                   | 0.10                            | F     |
| STR-5  | **Deauthorize through `POST /oauth/revoke`**, done with STR-1 because it is the same call.                                                                                                                                                                                                                                | §1.6                            | F     |
| STR-6  | **The 11th athlete gets a real message**, not a generic connect failure. The friends phase runs at the 10-athlete cap, so the eleventh friend meets this.                                                                                                                                                                 | §1.6                            | F     |
| STR-7  | **The official "Connect with Strava" button** (round 26 #21): Strava's orange asset on both themes, 48 tall, unaltered, in our `<a>`, on T1 and O3; `[ Connecting ]` beside it while OAuth is in flight; `data-part="strava-button"` exempt from the palette check. Must ship before the owner applies for Strava review. | §1.6, round 26 #21              | F     |
| STR-8  | **Round 25**: Log a run as a desk page (A1–A3 in DS1's two columns from 1040, rail read-only); "Strava reminds. You upload." (reminder copy and timing, one per run, cleared by a matching upload; T3a's status line; auto-import toggle removed; T2 retired; DS2's header).                                              | round 25                        | P     |
| STR-9  | **The Strava reminder email** (round 26 #19), through 126's interface and honouring ACC-11's switch: sent 20 minutes after the run lands, skipped if a matching file was uploaded, at most one a day with the next counting both, the drawn subject, body and footer.                                                     | §4, decision D-43, round 26 #19 | P     |
| STR-10 | **7-day prune of Strava ids** in `processed_webhook_events` and `notifications.subject`, run from the existing daily firing. Moved here from 125's scope: the tables are this lane's.                                                                                                                                     | §1.6                            | P     |
| STR-11 | **A1's start-time correction** (round 26 #1): "Change start time" opens a START TIME row; **Get weather**; the `WAS {old}` state; on failure both the time and the conditions revert.                                                                                                                                     | round 26 #1                     | P     |
| STR-12 | **R2b's sky pick** (round 26 #2): two required picks, twelve 5 °C bands in the runner's unit, Dry / Damp / Rain / Snow, "Set {band} and {sky}", the badge `SET · 41–50° · RAIN`. Needs an additive nullable column on `manual_conditions` in **`DIALED_WEATHER`**.                                                        | round 26 #2                     | P     |
| STR-13 | **US date order** (round 26 #9): one Intl-based formatter, month before day ("SAT AUG 29", "Sat, Aug 29"), used by every lane.                                                                                                                                                                                            | round 26 #9                     | P     |
| STR-14 | **Coordinate precision** (D-110): run start points and the profile fallback are stored at full precision and sent raw to Visual Crossing. Decide the precision, round before storing and before sending with one `lib` helper, and write the reason down. 129 uses the same helper in the city writer (FEED-5).           | PR #109, D-110                  | F     |

## 128 · Content & safety

This lane also owns **the closet** for this sweep, since round 26 carries
closet items and the plan had no closet lane.

| #      | item                                                                                                                                                                                                                                                                                                          | cites                      | stage |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ----- |
| SAF-1  | **EXIF stripped on the server**: every stored photo is re-encoded (Photon), entry photos included, with or without W3's blur; garment `original.*` too.                                                                                                                                                       | 0.8                        | F     |
| SAF-2  | **D-3**: the browser downscales before upload (long edge capped, e.g. 2048px, inside the existing W3 canvas step), and the server enforces a decoded-pixel cap as the backstop (decision D-45).                                                                                                               | D-3, decision D-45         | F     |
| SAF-3  | **Delete your own entry, run and entry photo**, with R2 deletion through the generic `outbox` (#101) (claim-then-delete; no reverse orphan). These are the primitives 126's account deletion reuses.                                                                                                          | 0.9, §2.5                  | F     |
| SAF-4  | **Bans that work**: sign-in blocked (Operator Screens D4), content hidden everywhere through the one visibility rule, a Desk ban control (D3), the ban notice email via 126.                                                                                                                                  | 0.3, §5                    | P     |
| SAF-5  | **A moderator's Remove deletes the bytes**, except where the NCMEC procedure requires preservation, in which case it quarantines them.                                                                                                                                                                        | 0.9, §1.10                 | P     |
| SAF-6  | **Admin takedown (DMCA)**: remove a named photo or entry from the Desk, with an audit row.                                                                                                                                                                                                                    | §1.2                       | P     |
| SAF-7  | **Public-entry photos through short-lived signed URLs**, cacheable for their TTL on the custom zone so Cloudflare's CSAM tool sees them. Private and closet photos stay `private`. Screening still gates every photo (decision D-46).                                                                         | D-71, §1.10, decision D-46 | P     |
| SAF-8  | **Content-removed notice** to the author (in-app, and an email via 126) carrying the statement of reasons the DSA asks for.                                                                                                                                                                                   | §4, §1.4                   | P     |
| SAF-9  | **D-62**: the owner sees "under review" on their own hidden entry. The safety half is here; the feed surfaces are 129's (FEED-6).                                                                                                                                                                             | D-62                       | P     |
| SAF-10 | **D-69**: a flagged garment photo tells its owner it is being checked.                                                                                                                                                                                                                                        | D-69                       | P     |
| SAF-11 | **D-84(b)**: W3's tap-to-blur has a keyboard path (buttons named by position); W3's counts are digits, always (round 26 #18).                                                                                                                                                                                 | D-84, round 26 #18         | P     |
| SAF-12 | **Blocks are enforced** (D-107): `hiddenCounterpartIds`/`isBlocked` have no callers outside safety, so a block hides nothing. Make the one visibility rule viewer-aware so a blocked pair's entries leave each other's feeds, entry detail and notifications; 129 applies it to search and profiles (FEED-7). | PR #109, D-107             | F     |
| SAF-13 | **A reporter's own hide is enforced** (D-108): W1 promises "hidden from your feed straight away" and `reportedSubjectIdsFor` has no callers. Same viewer-aware rule as SAF-12.                                                                                                                                | PR #109, D-108             | F     |
| SAF-14 | **Signed-out requests refused** (D-109): `entryDetailQuery`, `otherProfileQuery` and the entry photo route answer signed-out requests though their pages require sign-in. Require a session (the photo route: a session or, after SAF-7, a valid signature). Additions-only edits to feed's `functions.ts`.   | PR #109, D-109             | F     |
| SAF-15 | **The report sheet names the handle** ("Report @x's entry?", round 26 #7), after ACC-1.                                                                                                                                                                                                                       | round 26 #7                | P     |
| SAF-16 | **Closet: delete a garment that has runs** (round 26 #3): the drawn sheet, Retire it / Delete it and its record / Cancel, the landing and failure copy.                                                                                                                                                       | round 26 #3                | P     |
| SAF-17 | **Closet: F, garment saved and photo refused** (round 26 #4): fields go, Done, the `PHOTO NOT ADDED` band; Try again for network failures only, Pick another otherwise.                                                                                                                                       | round 26 #4                | P     |
| SAF-18 | **Closet: F at the desk** (round 26 #10): the one rail card "Already in your closet", read-only, up to five, `RETIRED` and `SAME NAME` marks.                                                                                                                                                                 | round 26 #10               | P     |
| SAF-19 | **Closet confirms** (round 26 #9): "Show retired (4)" with no count at 0; the phone's way back reads "← Closet".                                                                                                                                                                                              | round 26 #9                | P     |

## 129 · Feed

| #       | item                                                                                                                                                                                                                                                                                       | cites                       | stage |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- | ----- |
| FEED-1  | **Noindex by default** on public profiles and entries (robots meta per route, matching OPS-9's `robots.txt`). The owner has not decided whether to be indexed; default is no (open decision 1).                                                                                            | §6                          | F     |
| FEED-2  | **O1 → `resolvePlace`**, if #102/#104 have not already wired it (check first: #104's "Needs" item 1).                                                                                                                                                                                      | #104                        | F     |
| FEED-3  | **The bell counts runs awaiting a verdict**, through `runsAwaitingVerdict`, with the 14-day window gone (#102's follow-up). Its names are "Notifications" and "Notifications, 3 new" (round 26 #9).                                                                                        | #102, round 26 #9           | P     |
| FEED-4  | **D-101**: the following feed works past 92 follows (subquery on `follows`, with `EXPLAIN QUERY PLAN` evidence).                                                                                                                                                                           | D-101, §6                   | P     |
| FEED-5  | **One writer for the profile city** (`user_profiles` city/lat/lng), exported through onboarding's index, used by Your conditions and O1, rounding with STR-14's helper.                                                                                                                    | #102, D-110                 | P     |
| FEED-6  | **D-62's feed half**: the marker on the author's own entry card and entry detail, reading 128's predicate.                                                                                                                                                                                 | D-62                        | P     |
| FEED-7  | **Banned, deleting, blocked and reporter-hidden authors leave search and profiles**, using the viewer-aware rule 128 and 126 export.                                                                                                                                                       | 0.3, §2.1, D-107, D-108     | P     |
| FEED-8  | **Visual Crossing attribution on every conditions surface** (EntryDetail, the feed list, Your conditions); the audit saw it on two.                                                                                                                                                        | §1.8                        | P     |
| FEED-9  | **Round 25 on Your conditions**: "in these conditions" — the eyebrow, the line, and E1's compact line.                                                                                                                                                                                     | round 25                    | P     |
| FEED-10 | **Handle placements** (round 26 #7): `@handle` everywhere a name rendered, in one style (Archivo 600, "@" included, lowercase, never mono): feed author row, D, G, H, search, S1. `/@handle` for an old handle says "This runner changed their name." and never redirects.                 | round 26 #7                 | F     |
| FEED-11 | **Unverified runners** (round 26 #11, decision D-50): the one hairline nag band on Feed and You, no dismiss; Useful opens 126's "Confirm your email first" sheet.                                                                                                                          | round 26 #11, decision D-50 | F     |
| FEED-12 | **The typed city: Find, then Use this** (round 26 #12), on Your conditions and on O1; nothing saved until Use this; the drawn messages; `WEATHER FOR {RESOLVED}`. O1's city step is here rather than 126's (round 26 says 126) because this lane owns the place files and the one writer.  | round 26 #12                | P     |
| FEED-13 | **Round 26's feed confirms** (#9, #18): E2-lite's "No weather for {place} yet…", the consensus bars' word labels, "Find runners" as a right-aligned text link, G's settings icon button.                                                                                                   | round 26 #9, #18            | P     |
| FEED-14 | **The entry page's OG meta**, pointing at 125's card (OPS-16), with the drawn title and description. **Crawlers are signed out**, and SAF-14 makes D require a session, so the meta has to be served to a signed-out request for a public entry without the page's data (open decision 7). | round 26 #22, decision D-51 | P     |

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
| Reminder and broken-connection emails with an opt-out (§4) | 127 · STR-3, STR-9; 126 · ACC-2, ACC-11                  |
| Admin digest by email (§4)                                 | 125 · OPS-11                                             |
| Ban and removal notices (§4/§5)                            | 128 · SAF-4, SAF-8                                       |
| D-101                                                      | 129 · FEED-4                                             |
| D-84(b)                                                    | 128 · SAF-11                                             |
| The D-45 copy pass                                         | **design + owner**, not a lane (see Design dependencies) |
| Security headers (§3.9)                                    | 125 · OPS-8                                              |
| Favicon, OG and robots (§6)                                | 125 · OPS-9, OPS-16; 129 · FEED-1, FEED-14               |
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
| Notification preferences beyond the reminder | **pulled forward** by round 26 #19 into 126 · ACC-11                                                                               |
| DSA / UK OSA work                            | **pulled forward**: decision D-40 keeps EU/UK open, so the legal half is in the deployment plan and the notice half is 128 · SAF-8 |

## Round 26, mapped

Every item in `docs/design-deltas.md` "Answered in round 26":

| #   | ruling                      | lane and item                                                 |
| --- | --------------------------- | ------------------------------------------------------------- |
| 1   | A1 start-time correction    | 127 · STR-11                                                  |
| 2   | R2b sky pick                | 127 · STR-12 (weather-DB migration)                           |
| 3   | Delete a garment with runs  | 128 · SAF-16                                                  |
| 4   | F photo refused             | 128 · SAF-17                                                  |
| 5   | The swatch                  | none (design amends §AH's board)                              |
| 6   | Flags on a stranger's entry | none (the build already agrees)                               |
| 7   | Usernames                   | 126 · ACC-1; 129 · FEED-10; 128 · SAF-15                      |
| 8   | Task 120's two calls        | none                                                          |
| 9   | Round 21–23 placeholders    | 127 · STR-13 (dates); 129 · FEED-3, FEED-13; 128 · SAF-19     |
| 10  | F at the desk               | 128 · SAF-18                                                  |
| 11  | Email verification          | 126 · ACC-3 (decision D-50: private, no queue); 129 · FEED-11 |
| 12  | The typed city              | 129 · FEED-12                                                 |
| 13  | The Google button           | 126 · ACC-15 (decision D-49: Archivo)                         |
| 14  | Privacy policy              | 126 · ACC-13 (decision D-52)                                  |
| 15  | The Call at 15              | 126 · ACC-16                                                  |
| 16  | Field focus                 | 125 · OPS-15 (decision D-48)                                  |
| 17  | Breached password           | 126 · ACC-14                                                  |
| 18  | Small confirms              | 128 · SAF-11 (W3); 126 · ACC-14 (password); 129 · FEED-13 (G) |
| 19  | Notification email          | 127 · STR-9; 126 · ACC-2, ACC-11                              |
| 20  | Invite-only sign-up         | 126 · ACC-5; 125 · OPS-7 (the shell D7 sits in)               |
| 21  | Strava's Connect button     | 127 · STR-7                                                   |
| 22  | Icons and the share card    | 125 · OPS-9, OPS-16; 129 · FEED-14 (decision D-51)            |

## Design dependencies

Round 26 answered many of the first list's asks. What is still undrawn, or
where an owner decision now differs from a board and design is asked to
catch up. Lanes build placeholders under CLAUDE.md's protocol and do not
wait.

**Contract and board amendments (owner decisions of 2026-09-25)**

1. **Accessibility Contract §06**: add the FormField exception, ring on the
   border at offset −1px (decision D-48).
2. **T1's table and `icons.js`**: carry the two exemptions round 26 declared
   on a board, `data-part="google-button"` and `data-part="strava-button"`.
3. **The Google button's label is Archivo**, not Roboto (decision D-49);
   redraw it if Google's rule allows.
4. **No queued shares** (decision D-50): an unverified runner's entry saves
   private, and verifying restores the default. Redraw round 26 #11's share
   states (the "Shares when you confirm your email" sub-line and "3 runs
   shared.") to match.
5. **Privacy page type**: the 620 measure and `lead` (decision D-52).
6. **§AH rule 08** amended on the §AH board itself, not only the rulings
   board (round 26 #5).

**Accounts (126)**

7. **Password reset**: "Forgot it?", the request, check your inbox, set a new
   password, link expired.
8. **U1 Account**: change email, change password, sign out everywhere.
9. **Export**: the U1 row and what the runner gets.
10. **Delete account**: the confirm flow, the 7-day pending state, and what
    signing in during those 7 days shows.
11. **Email templates not drawn**: reset, email change (to both addresses),
    Strava broken or revoked, content removed, ban notice. (Round 26 drew
    verify, existing account, the reminder and the invite; D5 draws the
    digest.)
12. **Terms acceptance and age line** under the sign-up form beside the
    privacy line, and the **terms and copyright pages** in the privacy
    page's layout; **the Turnstile widget's place** on sign-up and Au5.
13. **Moderator force-rename**: the Desk control beside D3's ban panel, and
    what the renamed runner sees.
14. **The "Confirm your email first" sheet** is named in round 26 #11 but not
    drawn.

**Strava & logging (127)**

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
22. **Desk · Runners**, which D7's nav lists and no board draws (the ban
    panel's home).

**Already with design or the owner, not new asks**: D-45's copy pass (one
pass across every placeholder these lanes ship, owner's call 2026-09-11);
D-93's landing hero.

## Owner decisions still open

Lanes build to the default in brackets and do not wait:

1. **Indexing** of public profiles and entries [noindex].
2. **Retention on account deletion**: keep reports a deleted runner filed
   against others, anonymised? [keep, with the reporter id nulled].
3. **Flip the invite flag at public?** Round 26 #20 builds one flag that
   removes the code field [build the flag; leave it on until the owner
   flips it at the public gate].
4. **The Workers Rate Limiting binding** on upload, product-create and the
   webhook, or zone WAF rules only [WAF rules only; the binding is not
   authorised].
5. **Legacy weather rows** (OPS-14), if removing them is destructive.
6. **D-103**: fold `strava_revocations` into the generic `outbox`? 127 asks
   it with STR-2 [keep apart: its rows carry a credential].
7. **Signed-out previews of a public entry** (FEED-14 against SAF-14): serve
   the head meta alone to a signed-out request for a public entry, while the
   data stays behind sign-in [yes: meta only, no data].
8. **Coordinate precision** (STR-14) [two decimal places, about 1 km: finer
   than any weather grid we use; the lane checks the weather cache key].

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
