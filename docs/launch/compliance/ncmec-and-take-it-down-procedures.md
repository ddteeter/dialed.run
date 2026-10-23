# NCMEC and TAKE IT DOWN procedures

> **DRAFT: not reviewed by a lawyer.** Written 2026-10-22 from the code on
> `main` at `11b124cb`, for the owner to check and sign off before public
> (`docs/launch/legal-readiness-plan.md` step 4). It describes what the code
> does today and says plainly where a step is done by hand. Every
> `[CHECK: …]` is something this draft could not confirm; every
> `[OWNER: …]` is a fact or decision only the owner can supply.

Two procedures share this file because they share a queue, a reviewer and
a clock: suspected child sexual abuse material (CSAM), which is reported to
NCMEC, and intimate images shared without consent, which the TAKE IT DOWN
Act gives 48 hours to remove.

Sign-off: [OWNER: name, and the date this procedure was adopted]

## Who does this

[dialed.run] has one operator: the owner, the only id in `ADMIN_USER_IDS`
(`src/env/env.d.ts`; `src/modules/safety/admin.ts` `requireAdmin`). Every
step below is theirs. There is no deputy. When the owner is away, nothing
is decided, and the 48-hour clock still runs (see
[When the owner is away](#when-the-owner-is-away)).

## Part 1: suspected CSAM and the CyberTipline

### The law

- **Duty to report.** A provider of an electronic communication service or
  remote computing service that obtains actual knowledge of an apparent
  violation must report it to NCMEC's CyberTipline "as soon as reasonably
  possible". 18 U.S.C. §2258A(a)(1)
  ([text](https://www.law.cornell.edu/uscode/text/18/2258A)). The REPORT
  Act (Pub. L. 118-59, 2024) added apparent child sex trafficking (§1591)
  and enticement of a minor (§2422(b)) to what must be reported
  ([enrolled text](https://www.congress.gov/118/bills/s474/BILLS-118s474enr.htm)).
- **No duty to search.** §2258A(f) says the section does not require a
  provider to monitor users or content. The duty is triggered by knowledge.
- **Preservation.** A completed report is treated as a request to preserve
  its contents for **one year** (§2258A(h)(1), as amended by the REPORT Act
  from 90 days). The provider must also preserve "any visual depictions,
  data, or other digital files that are reasonably accessible and may
  provide context or additional information about the reported material or
  person" (§2258A(h)(2)). It may keep them longer to reduce proliferation
  (§2258A(h)(5) as amended). [CHECK: the paragraph numbers of the amended
  (h); the REPORT Act renumbered parts of it.]
- **Security of preserved material.** Preserved material must be kept
  securely, access limited, and, after the REPORT Act, stored in a way
  consistent with the most recent NIST Cybersecurity Framework.
  [CHECK: §2258A(h)(4) as amended, and whether the one-year phase-in for
  the NIST requirement has passed.]
- **Penalties.** Knowing and willful failure to report is fined. The REPORT
  Act raised the caps to $600,000 (first failure) for a provider with fewer
  than 100 million monthly users. [CHECK: the exact figures in §2258A(e) as
  amended.]
- **No tip-off.** Nothing in §2258A requires telling the uploader, and
  D-70 forbids it: telling the uploader warns the person a report is about.
- **UK.** The Online Safety Act 2023 s.66 requires a regulated
  user-to-user service to report UK-linked CSEA content to the National
  Crime Agency, once regulations bring it into force.
  [CHECK: whether s.66 and its regulations are in force, and whether a
  report to NCMEC satisfies them. Until checked, report to NCMEC and record
  the UK link in the record below.]

### What triggers a report

Actual knowledge that an image or kit on [dialed.run] is apparent CSAM.
Today that knowledge can only come from a person looking at it:

| Route in                                       | What the code does                                                                                                                                                                                           | Where                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| A runner reports a kit or photo                | Queued for review. Three distinct reporters hide it from everyone but its owner; one `intimate` report hides it at once.                                                                                     | `safety/reports.ts`; `safety/contracts.ts` `reportersToHide`       |
| The photo classifier flags a kit photo         | Hidden and queued (`flag`), or queued and left visible (`review` band). **The classifier does not detect CSAM**: OpenAI's `sexual/minors` category is text-only, so an image scores 0 on it by construction. | `safety/screening.ts` `queueWritesFor`; `classifier/moderation.ts` |
| A `/takedown` request whose link is ours       | Hidden at once (within the limits of D-118) and queued.                                                                                                                                                      | `safety/takedown-requests.ts` `fileTakedownRequest`                |
| Email to desk@ or hello@, or a law-enforcement | Nothing automatic. The operator finds the content by hand.                                                                                                                                                   | —                                                                  |
| A garment (closet) photo                       | Screened, and hidden on `flag`, but **never queued** and **cannot be quarantined** (see [Gaps](#gaps-this-procedure-cannot-close)).                                                                          | `safety/screening.ts:158`                                          |

**What changes when C11 (PhotoDNA, D-129) lands:** every upload is also
matched against known-CSAM hashes beside the classifier. A match is a
hash-match report, and the trigger becomes automatic for known material.
This section must be rewritten then. Until it lands there is **no
automated CSAM detection** at all. Cloudflare's CSAM Scanning Tool sees
only cached responses and none of ours are cached (D-69).

### Step 1: quarantine (in the app)

1. Open **Review** (`/safety/review`, admin only). Look at the item only
   through the review photo route (`src/routes/safety/review-photo.$.tsx`
   → `feed/photos.ts` `reviewerPhotoResponse`). Do not save, screenshot,
   forward or download it.
2. Choose **Remove as suspected CSAM** and confirm (the row asks again;
   `safety/components/ReviewQueue.tsx` `Decision`).
3. What the code does, in this order (`feed/moderation.ts`
   `moderateContent`, action `quarantine`):
   - copies each photo's bytes to `quarantine/…` in the `MEDIA` bucket
     (`lib/entry-photo-key.ts` `quarantineKeyFor`), before anything is
     deleted, so a failed copy stops the removal;
   - in one batch: deletes the entry or photo rows (hidden from every read
     at once), writes the `moderation_actions` row, and writes a
     `quarantined_content` row with the entry snapshot, the photo snapshot
     (each photo's preserved key and R2 upload time), the uploader's id,
     `quarantined_at`, and `retain_until` = quarantine time + 1 year
     (`safety/quarantine.ts:40-46` `quarantineInsert`);
   - sends the uploader nothing: no bell row, no email (D-70).
4. Quarantine **does not close the account** (D-88). That is a separate
   decision, in Step 3, and it must come **after** Step 2.

### Step 2: capture the context, then report (by hand)

The quarantine record holds the content and the uploader's id. It does
**not** hold the uploader's email, IP addresses, or sign-in history. Those
live in tables other paths delete:

- `session` rows hold IP and browser, and are deleted 30 days after expiry
  (`auth/expired-rows.ts` `sweepExpiredAuthRows`) and **at once on a ban**
  (`safety/bans.ts` `banUser`).
- The `user` row (email) is deleted by the account purge 7 days after the
  uploader asks to delete their account (`account/purge.ts`).

So, before anything else:

1. **Read the context** from the remote core database with
   `wrangler d1 execute dialed-core --remote`, by the uploader id on the quarantine
   row: the `user` row (email, `created_at`, `email_verified`), their
   `user_profiles` row (username, place), `username_history`, their
   `session` rows (IP addresses, user agents, times), and the
   `invite_redemptions` row (which code let them in).
   [CHECK: the exact column names against `src/db/schema-auth.ts` and
   `schema-core.ts` before first use.]
2. **Keep that context** with the report, in the owner's private evidence
   store, not in this repository (it is public) and not in email.
   [OWNER: where the evidence store is. It must be encrypted and reachable
   only by the owner. NIST CSF applies (above).]
3. **File the CyberTipline report** through NCMEC's ESP reporting
   ([CyberTipline](https://report.cybertip.org/); ESP registration via
   espteam@ncmec.org, `legal-readiness-plan.md` step 4). Include what
   §2258A(b) lists where you have it: the uploader's email, username, IP
   addresses with times, the upload time from the photo snapshot, and the
   image itself. [CHECK: how NCMEC's ESP portal or API takes the file;
   whether it can be uploaded straight from R2, or must pass through the
   owner's machine.] If the file must be fetched, use
   `wrangler r2 object get` into a temporary encrypted location, upload it, and delete the
   local copy at once.
4. **Record the report in the app.** In Review's Quarantine list
   (`safety/components/QuarantineRecords.tsx`), record the report and paste
   CyberTipline's report id. The code (`safety/quarantine.ts:116-143`
   `recordNcmecReport`):
   - sets `ncmec_reported_at` to the moment you record it, once (a second
     recording keeps the first time);
   - moves `retain_until` to the later of what it was and report time + 1
     year, never earlier (C12, D-131);
   - stores `ncmec_report_id`.

   Record it the same day the report is filed: the clock runs from when you
   record it, so a late record keeps the material longer, never shorter.

### Step 3: the account

Decide whether to close the uploader's account (`safety/bans.ts`
`banUser`: records the reason, deletes every session, refuses sign-in,
hides their content, sends `account_closed`). **Close it only after Step 2's
capture**, because the ban deletes the session rows. The ban email states
the reason the operator types: for suspected CSAM, use a reason that does
not say so. [OWNER: the reason wording to use, so a ban does not tip off
the uploader. D-70's silence covers the quarantine; the ban email is not
silent.]

### Step 4: keep, hold, delete

- The daily firing purges a record and its copies once `retain_until`
  passes (`safety/quarantine.ts:287` `purgeExpiredQuarantine`, from
  `ops/scheduled.ts`). It claims each record first, so overlapping firings
  cannot double-delete.
- **A legal hold is manual.** No code holds a record past `retain_until`.
  If law enforcement asks you to keep it (for example a preservation
  request under 18 U.S.C. §2703(f)), move `retain_until` on by hand with
  `wrangler d1 execute` before it passes, and note why in the evidence
  store. [CHECK: §2703(f)'s 90-day period and renewal.]
- The `moderation_actions` row stays after the purge (D-70). Its own 3-year
  clock (D-131) comes with C7.
- **R2 has no backup** (`docs/deployment.md` §10). Losing `quarantine/`
  breaks the year's preservation. Bucket locks on that prefix are the
  suggested fix there; not done.

### The record kept

For each report, two places:

| Where                                             | What                                                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `quarantined_content` (in the app)                | Content snapshot, uploader id, `quarantined_at`, `ncmec_reported_at`, `ncmec_report_id`, clock |
| `moderation_actions` (in the app)                 | Who acted, when, which reason                                                                  |
| The owner's evidence store (outside the app/repo) | The captured context (Step 2), NCMEC's acknowledgement, any law-enforcement request, any hold  |

## Part 2: TAKE IT DOWN Act removals

### The law

- **Who.** A "covered platform" is a public website or app that primarily
  provides a forum for user-generated content, including images
  (TAKE IT DOWN Act, Pub. L. 119-12, §4). [dialed.run] is one.
  [CHECK: every section number in this part against the enrolled Act
  (S. 146, 119th Congress), and where §3 is codified in Title 47. This
  draft could not read the enrolled text.]
- **The process.** By 19 May 2026 a covered platform must have a process
  for an identifiable individual, or someone authorised for them, to ask
  for removal of an intimate visual depiction published without consent
  (§3(a)). A valid request has a signature, enough to locate the image, a
  brief good-faith statement that it was not consensual, and contact
  information
  ([FTC](https://ftc.gov/business-guidance/blog/2026/05/take-it-down-act-enforcement-starts-now-what-know-about-ftc-tida)).
- **48 hours.** On a valid request, remove the depiction "as soon as
  possible, but not later than 48 hours", and make **reasonable efforts to
  identify and remove any known identical copies** (§3(a)(3)).
- **Notice.** Clear and conspicuous plain-language notice of the process
  (§3(a)(2)). [dialed.run] links `/takedown` from the footer
  (`src/ui/Layout.tsx:139`) and from the report sheet
  (`safety/components/ReportSheet.tsx:223`).
- **Good-faith removal is protected** from liability (§3(a)(4)).
- **Enforcement** is by the FTC as an unfair or deceptive practice (§3(b))
  ([Inside Privacy](https://www.insideprivacy.com/united-states/federal-trade-commission/the-take-it-down-acts-notice-and-removal-requirements-enter-into-effect/)).
  [CHECK: the civil penalty amount per violation.]

### How a request arrives

| Route                                | What the code does                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/takedown`, with or without account | Turnstile, a per-IP count, then one batch: the request row (email, signature name, location, statement, `dueAt` = filing + 48 h), an alert email to each operator, a receipt to the requester (`safety/takedown-requests.ts:105` `fileTakedownRequest`). If the link is a kit or photo on [dialed.run] (`lib/contracts/takedown.ts` `takedownSubjectOf`), it is hidden at once, except under D-118's limits (`safety/takedown-limits.ts` `holdStateFor`). |
| In-app report, reason `intimate`     | Hidden from everyone but its owner on the first report, queued, each operator emailed `removal_due` with the deadline (`safety/reports.ts` `removalAlerts`; `safety/contracts.ts` `REMOVAL_DUE_SECONDS`). The 48 hours run from the first report.                                                                                                                                                                                                         |
| Email to desk@ or hello@             | Nothing automatic. Treat it as a request from the time it arrived; ask the sender to use `/takedown` only if a required element is missing, and never let that delay a removal that is clear.                                                                                                                                                                                                                                                             |

An in-app report has no signature or good-faith statement, so it may not
be a "valid request" under the Act. The app treats it as one anyway, with
the same 48-hour clock. Keep doing so.

### Step 1: within 48 hours, decide

1. The operator alert gives the deadline. At 40 of the 48 hours, an
   undecided removal sends a reminder (`safety/removal-reminders.ts`
   `REMOVAL_REMINDER_LEAD_SECONDS`, hourly from `ops/removal-reminders.ts`;
   C6).
2. Open Review. Check the request names something we host, and that it is
   plausibly what it says. You do not need to establish who is depicted
   beyond the requester's statement.
3. Decide with **Remove** or **Decline** (`feed/removal-requests.ts:40`
   `decideRemovalRequest`):
   - Remove runs `moderateContent` with action `takedown` and reason
     `intimate`: the rows and files are deleted, the audit row records
     "removal request {id}", and the author gets the `content_removed`
     notice.
   - Decline gives the subject back (`releaseHoldWrites`) and emails the
     requester the reason.
4. **An undecided request is never put back by itself.** A held photo stays
   hidden past `dueAt` until a person decides (C6: `safety/screening.ts`
   writes a classifier verdict only over `pending`).
5. If the image is also apparent CSAM, use Part 1 instead: quarantine, do
   not remove.

### Step 2: identical copies

The Act asks for reasonable efforts on **known identical copies**.

**Today (before C16):**

1. The Review row for an intimate report, or a request whose link is ours,
   lists the same runner's 12 most recent other photos
   (`safety/other-photos.ts` `otherPhotosOf`, `OTHER_PHOTOS_LIMIT = 12`).
   Look through them, and take down any copy from the row's form.
2. If the requester gave other links on [dialed.run], each is its own
   subject: take each down.
3. There is **no search across other runners' photos**, and no hashing.
   Blur and re-encoding change every upload's bytes, so an exact hash
   would rarely match (`other-photos.ts` header). A copy posted by another
   runner is found only if someone reports it or the requester names it.
   Record this limit in the request's notes.

**What changes when C16 lands (D-142):** each upload's perceptual hash,
taken from the original bytes before re-encoding, is stored with the photo,
and Review searches by it across all photos, private ones included. Step 2
becomes "run the fingerprint search and take down every match", the terms
may then say "identical copies we find", and this section is rewritten.

### Step 3: the record

| Record                            | Kept                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `takedown_requests` row           | Requester email, signature, location, statement, `dueAt`, decision, reason, `resolvedAt`               |
| `moderation_actions` row          | Who removed what, when, and the request id                                                             |
| `takedown_blocks`                 | A blocked requester's keys (D-118)                                                                     |
| How long                          | **Until deleted today.** D-131's 3 years after the decision arrives with C7 (before public).           |
| The copies search, and its limits | [OWNER: where. Today there is no field for it; a note in the evidence store, keyed by the request id.] |

## When the owner is away

There is no second operator. If the owner cannot read alerts for more than
a day:

- Requests and reports still hide what they name at once, so a request is
  never exposed by the owner's absence. It stays hidden until decided.
- The 48-hour clock is still missed. [OWNER: decide whether to name a
  backup admin, or to accept the risk. Recommendation: accept it for
  friends; before public, add a second id to `ADMIN_USER_IDS` for someone
  trusted, or set an auto-reply on desk@ that says when the owner is back.]

## Gaps this procedure cannot close

These are code facts, listed so the owner can decide. None is fixed here.

1. **The quarantine does not preserve the uploader's context.** Email, IP
   addresses and sign-in history are deleted by a ban, the session sweep or
   the account purge. Step 2 captures them by hand; §2258A(h)(2) may expect
   the provider to preserve them. A code fix would copy them into the
   quarantine record.
2. **The reviewer photo route lets the browser cache the image for an
   hour** (`feed/photos.ts` `bytesResponse` sets
   `cache-control: private, max-age=3600`). For suspected CSAM, the operator's own browser then holds
   a copy. `no-store` on the reviewer route would stop that.
3. **Garment photos cannot be quarantined or queued.** A flagged closet
   photo stays hidden, and nothing puts it in front of a person.
4. **No automated CSAM detection** until C11.
5. **Copy search covers only the same runner's 12 newest photos** until C16.
