# Breach response runbook

> **DRAFT: not reviewed by a lawyer.** Written 2026-10-22 from the code on
> `main` at `11b124cb`, for the owner to check and sign off before public
> (`docs/launch/legal-readiness-plan.md` step 4). Every `[CHECK: …]` is
> something this draft could not confirm; every `[OWNER: …]` is a fact or
> decision only the owner can supply.

What to do when personal data [dialed.run] holds may have been seen,
copied, changed, lost or destroyed by someone who should not have it. One
person runs the service, so every role below is the owner's.

Sign-off: [OWNER: name, and the date this runbook was adopted]

**This repository is public.** The breach register and every incident's
notes live in the owner's private storage, never here.
[OWNER: where the register is kept.]

## The clocks, first

Start a timeline the moment you suspect a breach. The clocks run from
when you **become aware**, not from when it happened.

| Law                                 | Who to tell                                                                                    | When                                                                                                   | Threshold                                                                                           | Source                                                                                                                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GDPR Art. 33                        | The supervisory authority of **each** EU/EEA state where affected people live                  | Without undue delay, and where feasible within **72 hours**. Late? Say why. Facts may follow in phases | Unless the breach is unlikely to result in a risk to people's rights and freedoms                   | [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj) Art. 33(1), 33(4); EDPB Guidelines 9/2022 para. 73 (no one-stop shop for a controller with no EU establishment) |
| GDPR Art. 34                        | The affected people                                                                            | Without undue delay                                                                                    | Likely **high** risk. Not needed if the data was unintelligible (encrypted) or the risk was removed | GDPR Art. 34(1), 34(3)                                                                                                                                                |
| UK GDPR Arts. 33, 34                | The ICO; affected UK people                                                                    | The same: 72 hours to the ICO; people without undue delay                                              | The same                                                                                            | [ICO: report a breach](https://ico.org.uk/for-organisations/report-a-breach/)                                                                                         |
| Nebraska, Neb. Rev. Stat. §87-803   | Affected Nebraska residents, **and the Nebraska Attorney General no later than the residents** | As soon as possible and without unreasonable delay, after a prompt good-faith investigation            | Use for an unauthorised purpose has occurred or is reasonably likely                                | [§§87-801 to 87-807](https://ndbf.nebraska.gov/sites/ndbf.nebraska.gov/files/legal/87-8.pdf) (as amended by LB 835, 2016)                                             |
| Other US states                     | Residents of each state; some states' attorneys general                                        | Varies: some "without unreasonable delay", some a fixed number of days                                 | Each state's own definition of personal information                                                 | [NCSL list](https://www.ncsl.org/technology-and-communication/security-breach-notification-laws)                                                                      |
| GDPR Art. 33(5); UK GDPR Art. 33(5) | Nobody: a record                                                                               | Every breach, notified or not                                                                          | Always                                                                                              | GDPR Art. 33(5)                                                                                                                                                       |

**Nebraska's definition** (§87-802(5)) covers, among others, "a user name
or email address, in combination with a password or security question and
answer, that would permit access to an online account". [dialed.run]
stores emails and **scrypt password hashes**, not passwords. Data that is
"encrypted" is outside the definition only if the key was not also taken
(§87-802(3)); a hash has no key. [CHECK: whether a leaked email plus a
scrypt hash counts as "personal information" under §87-802(5)(b). Assume
it does until checked.] Session tokens and Strava refresh tokens also let
someone into an account, but are not "passwords". [CHECK: the same
question for them.]

**Other states with a fixed deadline**, as a starting list:
[CHECK: every row against the current statute before relying on it.]

| State      | Deadline to residents | Regulator notice                     | Cite                           |
| ---------- | --------------------- | ------------------------------------ | ------------------------------ |
| Colorado   | 30 days               | AG if 500+ residents                 | C.R.S. §6-1-716                |
| Florida    | 30 days               | AG if 500+ residents                 | Fla. Stat. §501.171            |
| Washington | 30 days               | AG if 500+ residents                 | RCW 19.255.010                 |
| Texas      | 60 days               | AG within 30 days if 250+ residents  | Tex. Bus. & Com. Code §521.053 |
| California | Most expedient time   | AG if 500+ residents (sample notice) | Cal. Civ. Code §1798.82        |

**Where people live is a guess.** [dialed.run] keeps no country or state.
The best signals are the profile's place and time zone
(`user_profiles`), and the IP addresses on `session` rows (kept 30 days
past expiry). Use them, record how you decided, and when unsure, notify.

## Who does what

| Role                   | Who                                                                                                               | Contact                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Incident lead          | The owner                                                                                                         | [OWNER: a contact route that works if the dialed.run domain is down] |
| Controller             | Big Long Run Labs LLC (D-125)                                                                                     | hello@dialed.run                                                     |
| EU / UK representative | None appointed (D-115). A breach touching an EU/UK user is a trigger to appoint one (D-115's triggers)            | —                                                                    |
| Outside help           | [OWNER: none today. Decide whether a breach-response or cyber policy is worth it; insurance is deferred (R-158).] | —                                                                    |

## 1. Detect

Ways a breach reaches the owner today:

- **Sentry** alerts on exceptions and failed cron check-ins
  (`src/modules/ops/sentry.ts`). Not built to spot an intruder.
- **The daily digest email** to the admins (`ops/scheduled.ts`
  `runDailyDigest`): backlogs and anomalies, not access.
- **Cloudflare**: the account audit log, and any notification the owner
  turns on. [OWNER: turn on Cloudflare notifications for API token
  creation, new members and Worker deploys; record which.]
- **A vendor's notice**: Cloudflare, Sentry, OpenAI, Strava, Google or
  GitHub. Each processor must tell us "without undue delay" (GDPR Art.
  33(2)) under its DPA.
- **A runner or researcher** writing to hello@ or desk@.
- **GitHub**: secret scanning and Dependabot on the repo.
  [CHECK: whether secret scanning is on for this repository.]

There is no intrusion detection, no access log for the Desk, and no alert
on bulk reads. Workers Logs keep request logs for 7 days
(`wrangler.jsonc` `observability`), so **read them early**; after a week
the evidence is gone.

## 2. Contain

Do the first that applies within the first hour. Each line says what it
breaks, so you can choose.

### Cloudflare account (D1, R2, Workers, Queues, Email)

- Review the audit log. Remove unknown members and API tokens. Rotate the
  owner's password and confirm 2FA.
- A bad deploy: `wrangler rollback` (does not touch the databases;
  `docs/deployment.md` §9).
- Data altered or deleted in D1: D1 Time Travel, 30 days, restores **in
  place**; note the current bookmark first (`docs/deployment.md` §9).
  Restore `dialed-core` and `dialed-weather` to the same moment.
- R2 has **no backup or versions** (`docs/deployment.md` §10). A deleted
  photo is gone; that is a loss of availability and is itself a breach to
  record.
- Read replicas (D-123) copy D1 to Europe, Asia-Pacific and Oceania. A
  breach of D1 is a breach of every copy.

### Secrets

Rotate any secret that may have leaked with `wrangler secret put` (list in
`docs/deployment.md` §5). What each rotation does:

| Secret                                                                                                                  | Rotating it                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                                                                                                    | Invalidates every signed session cookie: everyone is signed out. [CHECK: whether it also invalidates pending verification and reset links.] |
| `UNSUBSCRIBE_SECRET`                                                                                                    | Old unsubscribe links stop working                                                                                                          |
| `TAKEDOWN_SECRET`                                                                                                       | Old IP keys on takedown requests stop matching new ones (D-118)                                                                             |
| `STRAVA_CLIENT_SECRET`                                                                                                  | Regenerate in Strava's API settings. A leaked refresh token is useless without it. [CHECK: Strava lets you regenerate it.]                  |
| `GOOGLE_CLIENT_SECRET`                                                                                                  | Regenerate in Google Cloud. No Google tokens are stored (C4)                                                                                |
| `OPENAI_API_KEY`, `FIRECRAWL_API_KEY`, `VISUAL_CROSSING_API_KEY`, `TURNSTILE_SECRET_KEY`, `STRAVA_WEBHOOK_VERIFY_TOKEN` | Revoke at the vendor, then set the new one. Cost abuse more than data loss                                                                  |
| `SENTRY_DSN`                                                                                                            | Not a secret in practice; regenerate if events are being forged                                                                             |

### Better Auth sessions and tokens

The `session` table holds each session token in plain text, with IP and
browser. If D1 may have been read:

1. Delete every row, and rotate `BETTER_AUTH_SECRET`. Everyone signs in
   again:

   ```sh
   wrangler d1 execute dialed-core --remote --command "DELETE FROM session"
   ```

2. The `verification` table holds pending email and reset tokens: delete
   it too. [CHECK: the table and column names in `src/db/schema-auth.ts`.]
3. `data_exports.link_token` is stored in plain text (D-84). The link
   needs the owner's session as well, so step 1 covers it; deleting the
   rows also stops the links.
4. Password hashes are scrypt. There is no forced-reset feature: tell
   runners to change their password, and that it should not be reused
   elsewhere. [CHECK: whether Better Auth 1.7.2 can revoke or expire
   passwords in bulk.]

### Strava

`strava_connections` and `strava_revocations` hold refresh tokens in plain
text (privacy policy §Security). If they may have leaked: regenerate
`STRAVA_CLIENT_SECRET` (above), and consider revoking every grant through
the existing revoke path (`runs/strava/oauth.ts` `disconnectStrava`, which
owes a revocation through `strava_revocations`). Revoking disconnects
every runner. Tell Strava: their API agreement may require it.
[CHECK: Strava API Agreement's security-incident notice clause and its
deadline.]

### Google

No Google access, refresh or ID tokens are stored (`auth/create-auth.ts`
`NO_PROVIDER_TOKENS`, C4). The `account` table holds the Google account
id. Rotate the client secret if it leaked.

### Sentry

Events carry internal ids (account, run, import, product), never tokens,
request bodies or file contents (privacy policy processor table;
`ops/sentry.ts`). A Sentry-side breach is Sentry's to notify us of. If an
event did carry personal data, delete the issue in Sentry and fix the call
site.

### Email (Cloudflare Email Service)

A compromise means mail sent as hello@dialed.run. Suspend sending for the
zone in the Cloudflare dashboard [CHECK: the quickest way to suspend
Cloudflare Email Sending], and warn runners in the app if phishing went
out. The app's sends then fail; owed email waits in the outbox
(`lib/sql/outbox.ts`, D-66) and drains once sending is back.

### OpenAI, Firecrawl, Visual Crossing, Have I Been Pwned

OpenAI receives photos, usernames and product pages; a breach there is
OpenAI's to notify. The other three receive nothing that names a runner
(privacy policy processor table), so a breach there is not ours to notify.

## 3. Assess

Answer these in the incident notes, in order. GDPR Art. 33(3) asks for
most of them.

1. What happened, when, and when did we become aware?
2. Which systems: D1 core, D1 weather, R2 media, R2 imports, a vendor?
3. Which data: use the [record of processing](ropa.md) to list the
   categories in each system. Was any of it special or sensitive? Photos of
   people, location, and suspected-CSAM quarantine are the highest risk.
4. Whose, and how many: an approximate count, and where they live (above).
5. Was the data readable? D1 and R2 are encrypted at rest by Cloudflare,
   which helps only if the attacker did not come through our own
   credentials.
6. What could happen to people: account takeover, exposure of private
   kits or photos, a home location (profile coordinates are rounded to
   about a kilometre), phishing.
7. Is it **risk** (tell the authority) or **high risk** (also tell the
   people)? Under Nebraska: is misuse reasonably likely?
8. What we have done, and will do, to limit it.

## 4. Notify

### Order

1. Processor or partner contracts that need notice: Strava (above).
2. Authorities: each EU/EEA supervisory authority where affected people
   live, the ICO, the Nebraska AG and other states' AGs as required. File
   within 72 hours even if incomplete, and add facts later.
3. Affected people, by email from hello@dialed.run, and in the app if the
   email system is the thing compromised.
4. Law enforcement, if a crime is involved. If they ask for a delay,
   Nebraska allows it (§87-803(4)); record the request.

[CHECK: the online forms to use: the ICO's breach form, each EU authority's
form, and the Nebraska AG's breach notice page.]

### Template: to a supervisory authority (GDPR / UK GDPR Art. 33(3))

> **Controller:** Big Long Run Labs LLC, [OWNER: registered address],
> hello@dialed.run. No EU or UK representative.
> **Service:** dialed.run, a running-gear log.
> **When:** the breach happened [date/time UTC, or best estimate]; we
> became aware [date/time UTC].
> **What happened:** [plain description].
> **Data and people:** about [N] people, of whom about [n] in [country];
> about [N] records. Categories: [from the ROPA].
> **Likely consequences:** [from step 3.6].
> **What we did and will do:** [containment; what we told the people].
> **Contact:** [OWNER: name], hello@dialed.run.
> **Late?** [If after 72 hours, why.]

### Template: to the people affected (GDPR Art. 34(2); Neb. §87-803)

> Subject: Something went wrong with your dialed.run data
>
> On [date], [what happened, one sentence]. It affected [what data] in
> your account.
>
> What this means for you: [the realistic risk, plainly].
>
> What we have done: [containment].
>
> What you can do: [change your password; watch for email pretending to be
> us; reconnect Strava; and so on].
>
> Questions: hello@dialed.run, or by post to [OWNER: registered address].
>
> Big Long Run Labs LLC

### Template: to the Nebraska Attorney General

> Big Long Run Labs LLC, [OWNER: registered address], reports a breach of
> the security of the system under Neb. Rev. Stat. §87-803(2). [N] Nebraska
> residents are affected. The breach was discovered on [date]. The data
> involved was [categories]. Residents are being notified on [date] by
> email. A copy of the notice is attached.

## 5. Record

GDPR Art. 33(5) requires a record of **every** breach, notified or not:
the facts, its effects and what was done. Keep one entry per incident in
the private register:

| Field            | What                                                  |
| ---------------- | ----------------------------------------------------- |
| Id and dates     | Happened; became aware; contained; closed             |
| What happened    | Plain description                                     |
| Systems and data | From step 3                                           |
| People           | Count, and where they live, with how that was decided |
| Risk decision    | None / risk / high risk, and why                      |
| Notifications    | Who, when, how, and any acknowledgement or reference  |
| Late notice      | Why, if any clock was missed                          |
| Actions          | Containment and the fix                               |
| Follow-ups       | Code or process changes, with links to PRs            |

Also file a Sentry issue or a `docs/deferred.md` row for every code fix
the incident shows, without personal data.

## 6. After

- Review this runbook within a month of any incident.
- Rehearse it once a year: pick a scenario (a leaked `BETTER_AUTH_SECRET`,
  a deleted `quarantine/` prefix) and walk through it.
  [OWNER: the month of the yearly rehearsal.]
- A breach touching an EU or UK user triggers appointing representatives
  (D-115).

## Gaps found while writing this

- No access log or alert exists for operator or bulk reads, so step 3 may
  not be answerable beyond Workers Logs' 7 days.
- Strava refresh tokens and session tokens are stored in plain text; a D1
  read gives working credentials. Encrypting the Strava token, or hashing
  session tokens if Better Auth supports it, would narrow a breach.
- No record of where a runner lives, so who to notify is inferred.
