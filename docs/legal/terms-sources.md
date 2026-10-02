# Terms and copyright notice: where each claim comes from

`terms.md` and `copyright.md` are only true while the code, decisions and
outside terms below stay as they are. This file maps each claim to what
makes it true, as of `origin/main` at `2b7a57b` (2026-09-29), plus PR 2b-2
(`feat/126-accounts-2b2` at `1bfb2b8`, not yet merged) where a claim says
so. **A change to any file named here should come with a check of the
matching line**, and a change to the terms should come with a check of the
code. It is the same method as `privacy-policy-sources.md`.

Paths are relative to the repo root. Web sources give the date they were
read.

## Owner decisions these texts carry

| Decision                                                                     | Where it is recorded                                                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 16 and over                                                                  | `docs/decisions.md` D-71                                                                                |
| Handles never released, even after deletion                                  | D-56; D-72(6)                                                                                           |
| Appeals have no deadline                                                     | Owner, for this draft (2026-09-29). Not yet in `decisions.md`; **conflicts with the ban email** (below) |
| Quarantine: silent, preserved 1 year, then purged                            | D-70                                                                                                    |
| Public by default, per-entry toggle; "public" means signed-in runners        | D-19, D-58                                                                                              |
| Link previews show a generic card                                            | Owner, for this draft; see "Who sees what" below                                                        |
| Retire, don't delete garments referenced by entries                          | `CLAUDE.md` "Product rules"; see the garment row below for what the code now also allows                |
| Strava activity data never stored, displayed or used                         | D-14, D-33, D-54; `CLAUDE.md` "Product rules"                                                           |
| Weather from Visual Crossing                                                 | D-24                                                                                                    |
| Invite-only sign-up                                                          | D-39 (via task 126 ACC-5); `src/lib/access.ts` `IS_INVITE_ONLY`                                         |
| Email through Cloudflare                                                     | D-42, D-61; `wrangler.jsonc` `send_email` `EMAIL`                                                       |
| Every `@dialed.run` address reaches the owner                                | D-62                                                                                                    |
| Run by one individual; name, law, jurisdiction and address left to the owner | Owner, for this draft                                                                                   |

## Terms: who can use it

| Claim                                             | Source                                                                                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 16 or over; no date of birth asked                | D-71 ("No date of birth is asked or stored: the line is the gate"); the line under Au2 lands with PR 2b-2 (ACC-6)                                                      |
| Under-16 account closed                           | D-71 ("a report of an under-16 account is handled as any other takedown"); closure is the ban flow, `src/modules/safety/bans.ts` `banUser`                             |
| Invite code required; codes may be requested      | `src/lib/access.ts` `IS_INVITE_ONLY`; `src/modules/auth/access-hook.ts` (code checked before sign-up, email and Google); `src/routes/account/request-access.tsx` (Au5) |
| Account email and security email                  | `src/lib/email.ts` `emailTemplateSchema` (verify, reset, email change, account closed, content removed); `src/modules/email/deliver.ts` `EMAIL_FROM`                   |
| Unconfirmed runner's kits save private            | D-50; `docs/designs/126-accounts.md` ACC-3 (`share_default` read through `isVerified`)                                                                                 |
| Google sign-in                                    | `src/modules/auth/create-auth.ts` `socialProviders.google`                                                                                                             |
| "One person, one account"; no sharing or transfer | A rule, not a code fact: nothing in the code detects a shared account                                                                                                  |

## Terms: username

| Claim                                                       | Source                                                                                                                                                                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3–20 of `[a-z0-9_]`, no leading `_`, unique in any case     | `src/lib/contracts.ts` `usernameSchema` (`USERNAME_MIN_LENGTH`, `USERNAME_MAX_LENGTH`); `src/db/schema-core.ts` `user_profiles` (case-insensitive unique index); task 126 ACC-1                             |
| Word list and automated moderation                          | D-72(1)(2); `src/lib/profanity.ts`, `src/lib/profanity-words.ts` (LDNOOBW, CC BY 4.0, attributed in `third-party-notices.md`); `src/modules/account/handle-screen.ts` (OpenAI omni-moderation)              |
| Reserved names (us, Strava, moderator)                      | Task 126 ACC-1 (`admin`, `dialed`, `support`, `strava`, `moderator`); D-57; `src/modules/account/username.ts`                                                                                               |
| A moderator may change a username, and says why             | Task 126 ACC-12; `user_profiles.username_reset_reason` written by lane 128's Desk control (`docs/designs/126-accounts.md`, PR 2b-2 table). **The runner-facing half is not built yet** (ACC-12 outstanding) |
| Never released; old link says the runner changed their name | D-56; D-72(6); `schema-core.ts` `username_history`; `src/modules/feed/components/RunnerAtHandle.tsx`; PR 2b-2 deletion step 6 moves a deleted account's handle there                                        |

## Terms: the rules

| Claim                                                  | Source                                                                                                                                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Harassment, spam, explicit, not theirs (impersonation) | `src/modules/safety/contracts.ts` `reportReasons` (`harassment`, `spam`, `explicit`, `not_theirs`, `other`)                                                                         |
| Showing where someone lives                            | `safety/contracts.ts` `removalStatements.home` ("it shows where someone lives")                                                                                                     |
| Someone else's work                                    | `removalStatements.copyright` ("it uses someone else's work")                                                                                                                       |
| Faces blurred by default                               | `src/modules/safety/blur/preference.ts`; `src/modules/safety/components/PhotoBlur.tsx`                                                                                              |
| Misleading product names                               | Product names are UGC (D-26) and reportable (`reportSubjectTypes` includes `product`)                                                                                               |
| Scraping, evasion, security testing, ban evasion       | Rules, not code. What enforces some of them: Turnstile on sign-up and Au5 (`src/modules/ops/turnstile.ts`), Better Auth's rate limit (`create-auth.ts`), ban at sign-in (`bans.ts`) |

## Terms: your content

| Claim                                             | Source                                                                                                                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What content is                                   | `schema-core.ts` `wardrobe_items`, `runs`, `outfit_entries`, `outfit_entry_items` (`flag`, `note`), `entry_tags`, `entry_photos`, `products`, `user_profiles`              |
| Resize, re-encode, remove metadata                | `src/modules/feed/photos.ts` `reencoded` (SAF-1); `src/modules/closet/photos.ts` (original re-encoded, three sizes); `src/lib/photo-pipeline.ts` `fitWithin`               |
| Shown in feeds, profiles, the Call                | `src/modules/feed/`; the Call is post-MVP (`docs/product.md` Thesis; `docs/post-mvp.md`); today it is the ACC-16 teaser                                                    |
| Links in content: display, reformat, modify       | Product links are stored on garments and products (`wardrobe_items`, `products`); a licence term, not a code fact                                                          |
| Service providers act on our behalf               | Processor table in `privacy-policy.md` "Who else handles your data"                                                                                                        |
| Counted content is anonymous and not undone       | `src/modules/feed/consensus.ts` (`publiclyVisibleEntry`); D-19; counts are computed at read time, so a deleted kit stops counting — the clause covers counts already shown |
| Shared product catalogue outlives the account     | D-26; `schema-core.ts` `products.createdBy`; task 126 ACC-9 ("Shared `products` stay"); PR 2b-2 design ("Shared `products` stay")                                          |
| Moderation records and quarantine outlive content | D-70; `schema-core.ts` `moderation_actions`, `quarantined_content`; PR 2b-2 deletion step 4 ("Moderation actions and quarantined content stay")                            |

## Terms: who sees what

| Claim                                                      | Source                                                                                                                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared by default, per kit, default setting                | D-19; `schema-core.ts` (`isPublic` default true, `shareDefault` default true); `privacy-policy-sources.md` "What others see"                                                                            |
| Private kits never in feeds or counts                      | `src/modules/safety/visibility.ts` `publiclyVisibleEntry`; `feed/consensus.ts`                                                                                                                          |
| Shown only to signed-in viewers, photos included           | D-58; `src/modules/feed/functions.ts` `entryDetailQuery` (`requireUserId`, SAF-14); `feed/photos.ts` `isPhotoVisible` (`viewerId === undefined` refused); D-69                                          |
| Link preview is a generic card                             | `src/routes/og/default.ts` is the only card route; `src/modules/ops/og/site-head.ts` default `og:image`. **D-51's per-entry card and 129's FEED-14 are not built**; if they ship, this line must change |
| Owner-only fields                                          | `privacy-policy.md` "Never shown to anyone else"; `feed/entries.ts` `getEntryDetail` (`flag`/`note` only for the owner)                                                                                 |
| Garments: retired by default, or deleted with their record | `src/modules/closet/service.ts` `retireItem`, and `deleteItem`, which now deletes a worn garment and its `outfit_entry_items` rows on the runner's choice (SAF-16, round 26 #3)                         |

## Terms: screening, reports, moderation

| Claim                                                                     | Source                                                                                                                                                                                        |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every photo screened before others see it; high scores held               | `src/modules/safety/classifier/moderation.ts`; `entry_photos.screen_status` default `pending`, public reads require `pass`; `privacy-policy-sources.md` "Photos"                              |
| Reporting needs sign-in and a confirmed email                             | `src/modules/safety/functions.ts` `fileReportAction` (`requireUserId`); task 128 SAF-15 and seam 7 (`ConfirmEmailSheet` in `modules/account`)                                                 |
| A reported kit leaves the reporter's feed; a reported runner their search | `safety/visibility.ts` `notReportedBy` (entries, SAF-13), `profileNotReportedBy` (D-68)                                                                                                       |
| Three distinct reporters hide a kit or photo                              | `safety/contracts.ts` `autoHideReporterThreshold = 3`; `safety/reports.ts` `hideWritesFor`                                                                                                    |
| A person decides removals and closures                                    | Desk actions only: `src/routes/safety/review.tsx`, `src/routes/desk/runners.tsx`; `requireAdmin` (`safety/admin.ts`); automated screening only holds back                                     |
| Remove, rename, close                                                     | `src/modules/feed/moderation.ts` (remove, quarantine, takedown); `bans.ts` `banUser`; ACC-12 rename                                                                                           |
| Told what and why, in the app and by email                                | `safety/contracts.ts` `removalSentence`, `removalStatements` (SAF-8, the DSA statement of reasons, D-40); `lib/email.ts` `content_removed`; `moderation.ts` (bell row and email in one batch) |
| Closure: reason by email and on sign-in                                   | `bans.ts` `banEmail` (`account_closed`); `src/modules/safety/components/AccountClosed.tsx` (D4)                                                                                               |
| Closed account: no sign-in, content hidden                                | `bans.ts` (sessions deleted); `safety/ban-gate.ts` (`banStateOf` at sign-in); `safety/visibility.ts` `authorNotBanned` in `publiclyVisibleEntry` (SAF-4)                                      |
| Appeals to desk@dialed.run or a reply; a person; no timeframe             | `AccountClosed.tsx` `APPEAL_ADDRESS` ("A person reads every message and answers within a week"); `src/modules/email/content.ts` `content_removed` foot ("Reply to this email"); D-62          |
| Reopened account's kits come back                                         | `bans.ts` `unbanUser` clears `banned_at`; content was hidden by the rule, not deleted                                                                                                         |
| Removed kit or photo is deleted                                           | `feed/moderation.ts` header ("Removal deletes"), same outbox path as `feed/retract.ts`                                                                                                        |
| EU out-of-court settlement                                                | DSA (Regulation (EU) 2022/2065) Art. 21. See "Judgment calls"                                                                                                                                 |

**Code conflicts with the owner's appeal decision (not edited, `src/` is out
of scope here):**

- `src/modules/email/content.ts`, `account_closed`: "Think we got it wrong?
  Reply within 30 days and a different moderator will look." Both halves
  disagree with the terms: appeals have no deadline, and with one operator
  there is no "different moderator".
- `AccountClosed.tsx` (D4) promises an answer "within a week". The owner
  dropped any timeframe (2026-09-29): the terms make no time promise, and
  PR #129 removes it from D4 and the ban email and records the decision.

## Terms: suspected illegal content

| Claim                                               | Source                                                                                                                                                                                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Taken down at once; uploader not told               | D-70; `feed/moderation.ts` (quarantine deletes the live rows in one batch; "Nothing tells the uploader"); `lib/email.ts` (`content_removed`: "A suspected-CSAM quarantine sends nothing")                                                 |
| Locked copy only an admin sees                      | `src/modules/safety/quarantine.ts` (`requireAdmin`); bytes under `quarantine/…`, outside the prefix the photo route serves                                                                                                                |
| Kept one year                                       | `safety/quarantine.ts` `QUARANTINE_RETENTION_SECONDS = 365 days`; `quarantined_content.retain_until`                                                                                                                                      |
| **Then deleted**                                    | **Not built.** `retain_until` is written and indexed (`quarantined_content_retain`) but nothing in `src/modules/ops/scheduled.ts` deletes a row or its bytes after it. The owner's decision says "then purged"; build it or purge by hand |
| Reported to NCMEC                                   | D-70 ("The owner reports to NCMEC's CyberTipline by hand"); `docs/launch/deployment-plan.md` §8 (the procedure, owner, before public launch). 18 U.S.C. § 2258A sets the reporting duty and the one-year preservation                     |
| Shared with authorities when required or for safety | A policy statement; nothing in code. Matches `privacy-policy.md`                                                                                                                                                                          |

## Terms: other services

| Claim                                        | Source                                                                                                                                                                                                                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strava optional, reminders only              | `src/modules/runs/strava/`; D-14                                                                                                                                                                                                                                            |
| Never store, show or use activity data       | D-14, D-33, D-54; `strava/api.ts` (only token and revoke endpoints); `strava/prune.ts` deletes even the bare activity ids after 7 days (Strava API Policy §6.2)                                                                                                             |
| Strava's terms apply to the Strava account   | Strava API Agreement (effective 2026-06-01, read 2026-09-29) incorporates Strava's Terms of Service and Privacy Policy                                                                                                                                                      |
| Not made, endorsed or sponsored by Strava    | Strava API Policy §4.3, "No Implied Endorsement or Affiliation" (strava.com/legal/api_policy, effective 2026-06-01, read 2026-09-29)                                                                                                                                        |
| No charge for the Strava connection          | Strava API Policy §5.8, "You may not charge end users, in any manner, for access to or use of the Strava API Materials or any services or functionality included in or related to" them                                                                                     |
| Disconnect in settings or from Strava's side | `strava/oauth.ts` `disconnectStrava`; `strava/deauthorize.ts` `deauthorizeAthlete`                                                                                                                                                                                          |
| Google's terms                               | `create-auth.ts`                                                                                                                                                                                                                                                            |
| Visual Crossing; may be wrong                | `src/modules/weather/provider/visual-crossing.ts`; Visual Crossing Weather Services Terms (last updated January 2023, read 2026-09-29): data "may be derived from various 3rd-party sources and no guarantee is given regarding the availability, accuracy, or suitability" |
| Product pages fetched and read automatically | `src/modules/enrichment/fetch-page.ts`, `enrichment/firecrawl.ts`, `enrichment/model/chat-completions.ts`                                                                                                                                                                   |

**Strava API Policy requirements the texts must keep meeting** (read
2026-09-29, effective 2026-06-01):

- **§2.1** Before reading a user's data, consent that discloses the data
  types, how they are collected, how to withdraw consent, how to request
  deletion, and confirmation that a deletion completed. That is the privacy
  policy's Strava section and the connect screen, not the terms; the
  "deletion completed" confirmation is worth checking against 127's
  `strava_broken` notification and 2b-2's `strava_disconnected` email.
- **§7.3** A privacy policy that meets GDPR and UK GDPR, linked
  prominently, and that does not conflict with Strava's.
- **§5.3** No Strava data, or anything derived from it, in any AI
  application, including the Call. We keep none, so nothing to exclude.
- **§6.2 / §6.3 / §6.4** Seven-day cache; deletions reflected within 48
  hours; retention only for the original purpose (`strava/prune.ts`).
- **§4.1, §4.3** No Strava mark in our name or logo; nothing implying
  endorsement.

## Terms: not advice; changes; leaving

| Claim                                                    | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Call, conditions numbers, product details are inputs | `docs/product.md` Thesis; `feed/consensus.ts`; `enrichment/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Features may change or be charged for, with notice       | A term, not a code fact                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Delete in Settings › Account; 7 days; keep by signing in | **PR 2b-2** (`feat/126-accounts-2b2` at `1bfb2b8`, `docs/designs/126-accounts.md` "ACC-9 · account deletion"): `account_deletions` claim, `purge_after` +7 days, `/account/leaving` "Keep your account?". Not on `main`                                                                                                                                                                                                                                                                                                                                                                                          |
| Reports you filed kept without your name                 | PR 2b-2 deletion step 4 (`reporter_id` becomes `deleted:{report id}`); task 126 design open question 3's default                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Export from Settings › Account                           | **PR 2b-2** ACC-10 (`GET /account/export`, JSON). Not on `main`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Closing for serious or repeated breach                   | `bans.ts`; the terms are the basis for a ban (`docs/launch/deployment-plan.md` legal table, "termination (the basis for a ban)")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 30 days' notice before shutdown                          | A commitment, not a code fact. See "Judgment calls"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| We record which version you accepted                     | `terms_acceptances` (migration `0042_add_terms_acceptances`): one row per runner and version, with the time. The version is this file's "**Version N.**" line (`src/modules/account/terms-acceptance.ts` `termsVersionOf`). Recorded as the account is made, email or Google (`account/access.ts` `confirm`, in the user create hook), and by the terms prompt's Accept (`acceptTerms`). A runner below the current version is sent to the prompt and refused every write until they accept (`account/route-decisions.ts` `startTermsIfNeeded`; `auth/terms-gate.ts`). The rows go with the account (`purge.ts`) |

## Copyright notice

| Claim                                            | Source                                                                                                                                                                                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent's name, address, phone and email           | 17 U.S.C. § 512(c)(2) ("the name, address, phone number, and electronic mail address of the agent"); `copyright@dialed.run` reaches the owner (D-62)                                                                                                           |
| The six notice elements                          | 17 U.S.C. § 512(c)(3)(A)(i)–(vi) (law.cornell.edu/uscode/text/17/512, read 2026-09-29)                                                                                                                                                                         |
| Misrepresentation liability                      | 17 U.S.C. § 512(f)                                                                                                                                                                                                                                             |
| Removal deletes, with a record of who, what, why | Task 128 SAF-6; `src/modules/safety/components/Takedown.tsx`; `feed/moderation.ts` (`action: "takedown"`); `src/modules/safety/moderation-actions.ts`; `schema-core.ts` `moderation_actions` ("the audit a DMCA takedown needs")                               |
| The poster is told, in the app and by email      | `src/modules/feed/functions.ts` takedown (`reason: "copyright"`); `feed/moderation.ts` (bell row and `content_removed` email); `removalStatements.copyright`                                                                                                   |
| Counter-notice elements                          | 17 U.S.C. § 512(g)(3)(A)–(D)                                                                                                                                                                                                                                   |
| Forward, 10 business days, may repost            | 17 U.S.C. § 512(g)(2)(B)–(C). **The statute's safe harbour against the poster's own claims expects the provider to replace the material in 10–14 business days; a takedown here deletes the bytes, so it cannot.** See "Judgment calls"                        |
| Every takedown recorded against the account      | `moderation_actions.subject_owner_id`                                                                                                                                                                                                                          |
| Three takedowns close the account                | 17 U.S.C. § 512(i)(1)(A) requires "a policy that provides for the termination in appropriate circumstances" of repeat infringers. The number is this draft's; **nothing counts strikes in code** — the owner counts them from `moderation_actions` on the Desk |
| Closure as any other; appeal with no deadline    | `bans.ts`; the terms' "Appeals"                                                                                                                                                                                                                                |

## Before public launch: register the DMCA designated agent

**Owner action, not public text.** The § 512(c) safe harbour needs the
agent registered with the US Copyright Office as well as published on
`/copyright`. `docs/launch/deployment-plan.md` §9 (Legal) already lists it as a
stage 2 (public) gate. Verified 2026-09-29 against the Copyright Office's
DMCA Designated Agent Directory (copyright.gov/dmca-directory/ and its FAQ,
copyright.gov/dmca-directory/faq.html) and 37 C.F.R. § 201.38:

- **Where:** the online system at dmca.copyright.gov (an account on the
  Office's registration site; the paper process ended in December 2016).
- **Cost:** **$6** per designation, and $6 for each amendment or
  resubmission.
- **Lasts three years.** A designation expires three years after it is
  registered unless it is amended or resubmitted, which resets the clock;
  an expired designation loses the safe harbour. Set a reminder.
- **What it asks for:** the service provider's full legal name (for an
  individual, your own name) and **physical street address**, every
  alternate name the public would know the service by (list "dialed.run"
  and the domain), and the agent's name, organisation, mailing address,
  phone number and email.
- **P.O. box:** allowed for the **agent's** address. **Not** allowed for
  the **service provider's** address, which must be a street address unless
  the Office grants an exception for a threat to personal safety. For a
  one-person service that means either publishing a home address in the
  directory or asking for that exception; decide before registering.
- The page and the directory entry must match; keep `/copyright` in step
  when either changes.

## Judgment calls in these drafts

Recorded here so the owner can reverse any of them. The PR body lists the
same set.

1. **EU/UK consumer protections written in.** GDPR users are supported, not
   geo-blocked (D-40), so the terms keep EU/UK mandatory rights: statutory
   rights unaffected, liability for foreseeable loss, death/injury and fraud
   never excluded, home-country law and courts available to consumers.
2. **No indemnity clause.** Broad user indemnities are commonly unfair terms
   in EU/UK consumer contracts; leaving one out is the conservative choice.
3. **No arbitration clause or class-action waiver.** Same reason, and they
   do not bind EU/UK consumers.
4. **30 days' notice** before a material change to the terms, and before a
   shutdown "where we can". Neither is required in the US; both are the
   safe side for EU/UK consumer law.
5. **DSA content-moderation disclosures** (Art. 14: automated screening,
   human review, complaint handling) and a mention of out-of-court dispute
   settlement (Art. 21). A micro enterprise is probably exempt from Art. 20
   and 21 (Art. 19), but saying it costs nothing and is the conservative
   version. Verify with counsel.
6. **Liability cap** left as `[OWNER: …]` with an example amount.
7. **Three takedowns** as the repeat-infringer line, with withdrawn or
   countered notices not counting.
8. **A notice may be forwarded** to the poster with the sender's contact
   details, so they can counter-notify.
9. **Counter-notice: "you may post it again"**, because a takedown deletes
   the bytes. The alternative is code: keep a takedown's bytes for 14
   business days so they can be restored, which is what § 512(g) expects.
10. **Garments:** the terms describe what the code does (retire by default,
    delete with record on the runner's choice), which is wider than the
    "retire, don't delete" rule as stated.
11. **No appeal timeframe** (owner, 2026-09-29): the terms promise that a
    person reads every appeal, and nothing about when.
12. **Version line** is "Version 1", an integer ACC-6 can store; the
    effective date is the owner's.
