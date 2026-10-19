# Legal readiness plan

**Status: accepted by the owner, 2026-10-18.** Covers everything the pre-launch legal
review (rev. 2, 2026-10-18) left open, and the owner's answers to it.

The review is the claude.ai doc "dialed.run pre-launch legal review
(rev. 2)". In this plan, codes in parentheses are the review's: A1–A13 and
B1–B17 are checklist items, R-1–R-20 are its risks. Those R-numbers are
not this repo's `docs/deferred.md` register; register rows are named as
such.

Work happens in four ways:

- **Research:** a follow-up round on outside facts (rev. 3).
- **Legal text:** one PR against `docs/legal/`.
- **Code:** small PRs, each one its own lane.
- **Owner:** registrations and dashboards, recorded in
  `deployment-plan.md`.

Each step says what it builds, how it is tested, and what "done" means.

## Decisions

The owner made these on 2026-10-18. They are recorded as D-122 to D-136 (decision 16 is D-136; 2 and 3 share D-123). Research rev. 3 (2026-10-18) added D-137 to D-142: the UK records, the Mississippi and Tennessee block, photo fingerprints, the Strava consent screen, Visual Crossing attribution, and DSA statements of reasons.

| #   | Decision                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **The friends launch waits for Big Long Run Labs LLC.** v1 names the LLC as operator; there is no own-name version.                                                                                                                                                                                                |
| 2   | **The published address is the LLC's registered address**: the owner's home. It goes on the terms, privacy policy, copyright page, DMCA directory and email footers. Recorded as an accepted trade-off. A commercial registered agent plus a mailbox is a later privacy upgrade (a new row in `docs/deferred.md`). |
| 3   | **The DMCA agent's phone is a free Google Voice number.**                                                                                                                                                                                                                                                          |
| 4   | **No invited friend is in the EU, EEA, UK or Switzerland.** The GDPR text still ships in v1, so that adding it later doesn't force everyone to re-accept. The Sentry DPA and the UK OSA assessments are needed before public, not before friends.                                                                  |
| 5   | **Strava capacity is 10 athletes, and the owner is one of them.** At most 9 friends connect during the friends stage. Request the 9,999 level before public. Strava itself refuses an 11th connection (STR-6), so no code change is needed.                                                                        |
| 6   | **CSAM matching uses PhotoDNA, with Thorn's Safer as the fallback.** Photos stay private behind sign-in.                                                                                                                                                                                                           |
| 7   | **A DMCA removal hides the material for 30 days, then deletes it.** A valid counter-notice restores it within 10 to 14 business days.                                                                                                                                                                              |
| 8   | **Takedown requests, reports and moderation-decision records are kept for 3 years after the decision**, then swept. Quarantined CSAM is kept for 1 year after the NCMEC report.                                                                                                                                    |
| 9   | **A reporter is told the outcome of their report** (DSA Arts. 16(5) and 17). This is needed before public.                                                                                                                                                                                                         |
| 10  | **Anonymous totals add secondary suppression, round published counts to the nearest 5, and rebuild guides at most monthly.** This amends D-108 (D): an opt-out now takes effect at the next guide rebuild, within a month.                                                                                         |
| 11  | **Disconnecting Strava inside the app sends the `strava_disconnected` email too**, as disconnecting from Strava's side already does.                                                                                                                                                                               |
| 12  | **The terms licence takes the review's wording**: "operate and develop", modifying links in content including outbound product links, and "spam, advertising or promotion we have not allowed".                                                                                                                    |
| 13  | **Disputes: a US$100 liability cap**, no arbitration, no class-action waiver and no user indemnity. A 30-day informal step comes first, small claims are carved out, and the law is Nebraska's. Venue is the Sarpy County District Court or the D. Neb.                                                            |
| 14  | **No new pages for subprocessors or credits.** The privacy policy's processor table gains company, role, location and safeguard columns. The credits go on the app's `/open-source` page, which the marketing site already links to and which doesn't exist yet.                                                   |
| 15  | **Trademark: a USPTO knockout search for DIALED.RUN before public, and no filing yet.** No insurance now: a new row in `docs/deferred.md`, revisited at the first revenue, about 1,000 accounts, or the first legal threat.                                                                                        |
| 16  | **Destructive schema changes are fine until the first deploy** (owner, 2026-10-18).                                                                                                                                                                                                                                |

## What the code review of rev. 2 corrected

These were checked against `main` on 2026-10-18:

- **A4's fix can't work as written.** `ON DELETE SET NULL` can't cross
  databases. `weather_observations.run_id` is never read, so drop it.
- **A run deleted on its own leaves its `manual_conditions` row.** Only
  account purge sweeps that table.
- **An in-app Strava disconnect sends no email.** That's decision 11.
- **Visual Crossing attribution already exists**
  (`src/ui/WeatherAttribution.tsx`). Research item 7 decides whether the
  wording must change.
- **Most of the takedown fail-safe already exists.** A reported item is
  hidden on the first report, the request carries a 48-hour `dueAt`, and
  the operator is alerted. Step C6 adds only what is missing.
- **Answers to the review's open questions:**
  - Export and delete stay reachable while the terms are pending (D-95).
  - Better Auth sweeps its own rate-limit rows, so the policy's "about a
    minute" stays.
  - The profanity list is server-only.
  - Nothing reads the stored Google tokens.

## Step 0: research rev. 3 (owner sends; about a day)

The owner sends the follow-up research prompt.

- **Blocks:** the Mississippi and Tennessee decision; whether to store a
  perceptual hash of each upload (C6); the Visual Crossing wording; the
  DPF and safeguard cells of the processor table; the climate-zone
  dataset and its credit; and the exact Strava §2.1 and §2.5 text.
- **Done:** a rev. 3 doc exists, and each blocked item above has an
  answer, or an explicit "unresolved" and why.
- Steps 1 to 3 below don't wait for it. Where the answer is pending, the
  legal-text PR keeps an `[OWNER: …]` marker.

## Step 1: record the decisions (docs only, 1 PR, before friends)

- **Builds:**
  - D-122 to D-136 in `docs/decisions.md`. Amend D-108 (D) and D-115, and
    attach rev. 2's five EU/UK triggers to D-115.
  - New rows in `docs/deferred.md`: the address privacy upgrade, and
    insurance.
  - Updated rows in `deployment-plan.md` §8 and §9, including step 4's
    owner items.
  - This plan, marked accepted.
- **Tested by:** the doc gates only. There is no code.
- **Done:** merged, and every decision above is findable by its D-number.

## Step 2: legal text (1 PR on `docs/legal/`, before friends)

Apply rev. 2's redlines, adjusted to the decisions and to the code as it
stands.

1. **`terms.md`:**
   - **Header and operator.** The version header is filled. The operator
     text is the review's Variant 2 (the LLC) as Version 1, with the home
     address. Delete the "run by one person" paragraph.
   - **Acceptance.** Take the opening paragraph and the "Changes to these
     terms" text, which fixes the continued-use contradiction (D-94). Add
     the corrections clause.
   - **Licence and spam rule.** Adopt the wording in decision 12.
   - **Screening and illegal content.** Take the screening bullet, and the
     CSAM bullet (1 year after the report). Add an EU authorities contact
     line.
   - **The takedown bullet.** Keep "identical copies we find" out until
     C6 lands.
   - **Strava and other services.** Take the Strava bullet, and the
     no-warranty bullet that Strava's §9.2 requires.
   - **Disputes and contact.** The liability cap, and governing law with
     the 30-day informal step (decision 13). The contact section gets the
     address.
   - **Anonymous totals.** "Publish or may publish", plus the PR #187
     fallback sentence while that PR is open.
2. **`privacy-policy.md`:**
   - **Who we are.** The controller line (Variant 2) and the address.
   - **Strava.** The short-version bullet; the disconnect bullet ("we
     email you to confirm it" is true once C3 lands, so land C3 first or
     in the same release); Strava's role; and the R-142 text, which is
     deleted once C2 lands.
   - **Access and the processor table.** Fix the "Our access" sentence
     about OpenAI. Rewrite the processor table's intro, and add the
     company, role, location and safeguard columns (decision 14).
   - **Transfers.** Take the transfers paragraph.
   - **Cookies and DNT.** The cookies paragraph and the Do Not Track
     sentence. GoatCounter's wording waits for research.
   - **Weather.** The weather text matches C1: the run reference is gone.
   - **Retention.** Takedown and moderation records 3 years; CSAM 1 year
     after the report; DMCA hidden 30 days; the weather row.
   - **Rights and legal bases.** Take the review's "Your rights" and
     "legal bases" sections.
   - **Tail.** "Laws we follow", and the contact.
   - **Anonymous totals.** Rounding, suppression, and the monthly rebuild
     and opt-out timing (decision 10).
3. **`copyright.md`:**
   - **The agent block.** The LLC, the address, `copyright@dialed.run`,
     and a phone marker until the Google Voice number exists.
   - **Notices and counter-notices.** "Missing elements" wording. The
     counter-notice text is the B5 variant, which matches C5, with the
     "hides it" bullet.
4. **`aggregates-lia.md`:** the section 3 rows, a new section 3a, and the
   review date (decision 10).
5. **`third-party-notices.md`:** Visual Crossing, MediaPipe (Apache 2.0),
   and a climate-zone entry, which keeps a marker until research item 8
   answers.
6. **`privacy-policy-sources.md` and `terms-sources.md`:** a row for every
   new or changed claim, pointing at the code that makes it true. A claim
   that depends on an unmerged step names that step.

- **Tested by:**
  - Every `docs/legal/*.md` still parses through the legal markdown
    renderer's test.
  - I re-check each changed claim against the code by hand, and the
    sources files record each check.
  - No text becomes true before its code step merges. A claim that needs
    C1, C2, C3 or C5 lands in the same release as that step, or keeps its
    fallback text.
- **Done:**
  - The PR is merged.
  - The only `[OWNER: …]` markers left are: the effective date, the
    Google Voice number, the LLC's approval, and the research-blocked
    cells.
  - The files are not marked `published: true`. That is the owner's
    final read.

## Step 3: code (one lane each; before friends unless marked)

Each lane:

- has its own worktree and PR;
- has tests that observe the behaviour, since every touched module is in
  the mutation ratchet;
- passes `npm run verify && npm test && npm run build`;
- stops at "ready to ship", and is pushed in the background.

| Step | Builds                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Tested by                                                                                                                                                                                 | Done when                                                                                                                                              | Stage   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| C1   | **Weather cleanup.** Drop `weather_observations.run_id`: a weather migration named `drop_observation_run_id`, destructive and pre-approved (decision 16), with its writer and its type removed. When a run is deleted, delete its `manual_conditions` row. That table is in `DIALED_WEATHER`, which no core batch reaches (law 8c), so the delete is owed through the existing outbox in the same batch as the run delete, and dispatched to the weather DB.  | A worker test: delete a run with a band, and the band is gone after dispatch. An outbox redelivery is idempotent. The account purge still sweeps. A schema test shows the column is gone. | Deleting a run leaves nothing keyed by its id in either database.                                                                                      | friends |
| C2   | **R-142 (in `docs/deferred.md`).** A dead-lettered Strava reminder's `gave_up` row loses its athlete and activity ids after 7 days, and at once on disconnect or account deletion.                                                                                                                                                                                                                                                                            | A worker test for each of the three triggers. The prune is re-runnable.                                                                                                                   | No Strava id survives in a `gave_up` row past 7 days, after a disconnect, or after an account deletion. The R-142 row in `docs/deferred.md` is closed. | friends |
| C3   | **The in-app disconnect email.** `disconnectStrava` owes the `strava_disconnected` email in its own batch, with the same dedupe shape as the webhook. Disconnecting from Strava's side still sends exactly one.                                                                                                                                                                                                                                               | A worker test: an in-app disconnect sends one email. A disconnect from both sides doesn't send two.                                                                                       | Both paths send exactly one confirmation.                                                                                                              | friends |
| C4   | **Drop the Google tokens.** Stop storing Google's access, refresh and ID tokens: blank them after sign-in, or use a Better Auth option if 1.7.2 has one. Blank any that exist today.                                                                                                                                                                                                                                                                          | A worker test: after a Google sign-in, the account row holds no tokens, and sign-in still works.                                                                                          | No Google token is stored, and the policy's token sentence is deleted.                                                                                 | friends |
| C5   | **The DMCA hide window (B5).** A copyright removal hides the material instead of deleting it. A counter-notice path restores it. A sweep deletes it after 30 days. The author's message stays as it is.                                                                                                                                                                                                                                                       | Worker tests: hide, restore within the window, purge after 30 days, and no restore after the purge.                                                                                       | `copyright.md`'s counter-notice text is true.                                                                                                          | public  |
| C6   | **The takedown gaps.** The 40-hour reminder is a digest line for undecided requests, if it doesn't exist yet. An undecided request is never restored automatically; check this, and add a test if it's already the case. Identical-copy matching waits for research item 4 and its owner decision.                                                                                                                                                            | A worker test: a request older than 40 hours shows in the digest. A request past `dueAt` stays hidden.                                                                                    | Both are pinned by tests.                                                                                                                              | friends |
| C7   | **The 3-year sweep.** A daily sweep removes takedown requests, reports and moderation-decision records 3 years after the decision. Quarantine keeps its own `retain_until`.                                                                                                                                                                                                                                                                                   | A worker test at both edges of the 3-year line. The sweep is re-runnable.                                                                                                                 | The retention table's row is true.                                                                                                                     | public  |
| C8   | **The reporter outcome notice and DSA statements of reasons (D-129, D-142).** An author gets a short notice when a report hides their content (CSAM stays silent), and removal and closure messages carry Art. 17(3)'s elements. When a report is resolved, the reporter gets an in-app notification: "We removed it" or "We reviewed it and left it up". This is an undesigned surface: text only, with existing primitives, and a `design-deltas.md` entry. | A component test for both texts. A worker test: resolving a report notifies the reporter once.                                                                                            | The DSA Art. 16(5) claim can be made.                                                                                                                  | public  |
| C9   | **The app's `/open-source` page.** It renders `third-party-notices.md` and the shipped packages' licences. The marketing site's link stops being dead. This is an undesigned surface.                                                                                                                                                                                                                                                                         | A route registration test, and a component test with the notices rendered.                                                                                                                | `app.dialed.run/open-source` resolves.                                                                                                                 | public  |
| C10  | **Totals hardening (decision 10).** Secondary suppression, rounding to 5, and at most a monthly rebuild. This goes into lane B's totals cron, after public, and is recorded there.                                                                                                                                                                                                                                                                            | Unit tests on the suppression and rounding, including a differencing case.                                                                                                                | The LIA's rows are true.                                                                                                                               | lane B  |
| C11  | **PhotoDNA**, at upload beside the classifier, once Microsoft approves. If refused, Safer instead.                                                                                                                                                                                                                                                                                                                                                            | Worker tests with the provider stubbed at the `env` boundary.                                                                                                                             | The privacy policy's PhotoDNA line is appended.                                                                                                        | public  |
| C12  | **The CSAM clock from the report.** Record when the NCMEC report was filed, on the `quarantined_content` record, from the review route; `retain_until` becomes report time + 1 year (18 U.S.C. §2258A(h)(1) as amended). A record with no report yet keeps quarantine time + 1 year as its floor.                                                                                                                                                             | Worker tests: recording the report moves `retain_until`; the purge honours it; a record with no report never purges before quarantine + 1 year.                                           | The policy's "one year after the report" is true.                                                                                                      | friends |
| C13  | **Block Mississippi and Tennessee sign-ups (D-138).** One gate on Cloudflare's region code at email sign-up, Google sign-up and request access; a single blocked-region constant; the refusal goes through the form primitives. An undesigned surface.                                                                                                                                                                                                        | Unit tests on the gate; worker tests for every way in.                                                                                                                                    | No account can be created from MS or TN.                                                                                                               | friends |
| C14  | **Strava consent disclosure (D-140)** before the OAuth redirect, on every entry point, with the approved copy. An undesigned surface.                                                                                                                                                                                                                                                                                                                         | ui tests for each entry point.                                                                                                                                                            | Strava §2.1 is met.                                                                                                                                    | friends |
| C15  | **Visual Crossing attribution (D-141):** the linked "Weather data provided by Visual Crossing" beside conditions on every view, share card and email that shows them; the guide footer comes with lane B.                                                                                                                                                                                                                                                     | ui tests on the attribution; a check that every conditions surface renders it.                                                                                                            | The licence footnote is met.                                                                                                                           | friends |
| C16  | **Photo fingerprints (D-139):** a perceptual hash of each upload, computed before re-encoding and stored with the photo; the takedown review searches by it across all photos, private included.                                                                                                                                                                                                                                                              | Worker tests: the hash is stored, it matches a re-upload, it is deleted with the photo.                                                                                                   | The terms' "identical copies we find" and the privacy bullet are true.                                                                                 | public  |

**Order:** C1 to C4 run first, in parallel, at most three lanes at a time.
C6, C12, C13, C14 and C15 follow. C16 comes before public. C5, C7, C8 and C9 run after friends launch.

**Migrations:** C1's weather migration and any core migration in C5 or C7
are numbered past `main` and the open PRs (law 11).

## Step 4: owner items (into `deployment-plan.md`)

### Before friends

- **The LLC.** Approval; the §21-193 notice published three weeks running
  in a Sarpy County legal newspaper (research item 10 lists them); proof
  of publication filed; the EIN; a separate bank account; an operating
  agreement.
- **Contact details.** Get the Google Voice number. Send the effective
  date.
- **Strava.** Invite at most 9 Strava-connecting friends.
- **Google.** Nothing for friends: with only `openid email profile`,
  Testing mode needs no test-user list and sign-ins don't expire (A11).
- **NCMEC.** Email espteam@ncmec.org as the LLC to register as an ESP and
  get CyberTipline credentials; test on exttest.cybertip.org (A9, B7).
- **Cloudflare.** Turn on the free CSAM Scanning Tool, and note that it
  sees only cached responses, so it doesn't cover our photos (B6a).
- **Read and publish.** A final read of the step 2 PR, then mark each
  legal file `published: true`.

### Before public

- **DMCA agent.** Register with the Copyright Office in the LLC's name:
  $6, renewed every three years. Set a renewal reminder.
- **NCMEC and PhotoDNA.** Complete the NCMEC registration and test it.
  Apply for PhotoDNA.
- **Sentry.** Accept the DPA in Organization Settings › Legal & Compliance
  (Owner or Billing role), and turn on IP scrubbing under Security &
  Privacy (A10).
- **Platform reviews.** Request Strava's 9,999 level. Complete Google
  brand verification.
- **Trademark.** Run the USPTO knockout search for DIALED.RUN.
- **Documents I draft and the owner signs off:**
  - the UK OSA records (D-137): the illegal-content risk assessment, the
    children's access assessment ("likely to be accessed by children") and
    the children's risk assessment, on Ofcom's template;
  - the NCMEC and TAKE IT DOWN procedures;
  - the breach runbook;
  - the record of processing (ROPA).
- **EU/UK fallback.** Write the Cloudflare rule that blocks EU/UK sign-up,
  but leave it disabled. Shortlist one EU/UK representative provider.
- **Court dockets.** The monthly check in R-157.

## Not in this plan

- Monetisation itself.
- Insurance (a new row in `docs/deferred.md`).
- The address privacy upgrade (a new row in `docs/deferred.md`).
- Groups (Day 2).
