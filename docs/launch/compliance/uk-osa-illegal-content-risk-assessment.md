# UK Online Safety Act: illegal content risk assessment

> **DRAFT: not reviewed by a lawyer.** Written 2026-10-22 from the code on
> `main` at `11b124cb`, for the owner to check and sign off before public
> (D-140; `docs/launch/legal-readiness-plan.md` step 4). Every
> `[CHECK: …]` is something this draft could not confirm; every
> `[OWNER: …]` is a fact or decision only the owner can supply.

**About the sources.** Ofcom's website refused automated reads while this
was drafted, so the structure and the list of harms come from Ofcom's
published guidance as summarised by search results and by D-140, not from
reading the PDFs end to end. [CHECK: before signing, open Ofcom's
record-keeping template and move this record onto it, or confirm this
layout covers every field it asks for.]

## The duty

A regulated user-to-user service must carry out a suitable and sufficient
illegal content risk assessment, keep it up to date, and redo it before
any significant change (Online Safety Act 2023 s.9,
[legislation.gov.uk](https://www.legislation.gov.uk/ukpga/2023/50)). It
must keep a written record of it (s.23). Ofcom's guidance sets a
four-step method:

1. understand the kinds of illegal harm to assess;
2. assess the risk of each: likelihood and impact, giving a level
   (negligible, low, medium or high);
3. decide on and put in place safety measures, and record them;
4. report, review and update.

Sources: Ofcom,
[risk assessments](https://www.ofcom.org.uk/online-safety/information-for-industry/guide-for-services/risk-assessments);
[Risk Assessment Guidance and Risk Profiles](https://www.ofcom.org.uk/siteassets/resources/documents/online-safety/information-for-industry/illegal-harms/updates/risk-assessment-guidance-and-risk-profiles.pdf);
[Record-Keeping and Review Guidance](https://www.ofcom.org.uk/siteassets/resources/documents/online-safety/information-for-industry/illegal-harms/updates/record-keeping-and-review-guidance.pdf);
[statement on the new priority offences](https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/statement-new-priority-offences-serious-self-harm-and-cyberflashing)
(25 June 2026: suicide and self-harm are one kind, and cyberflashing is a
new kind).

**Why the Act reaches [dialed.run].** UK sign-up is open (D-140). A
service with links to the UK (s.4) is regulated whether or not it is based
there. [CHECK: whether [dialed.run] meets s.4(5)'s "significant number of
UK users" or "UK as a target market" test, or only s.4(6)'s "capable of
being used in the UK and material risk of significant harm". D-140
assumes it is in scope; this record follows that.]

## Record details

| Field                   | Value                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| Service                 | [dialed.run], `app.dialed.run`                                                                           |
| Provider                | Big Long Run Labs LLC, Nebraska, USA (D-125)                                                             |
| Person accountable      | [OWNER: name. Ofcom's Codes expect one named person accountable for illegal-content duties.]             |
| Date of this assessment | [OWNER: date signed]                                                                                     |
| Next review             | 12 months after that date, or before a significant change, whichever is first (D-140)                    |
| Previous assessment     | None. First record                                                                                       |
| Assessed by             | The owner, from this draft                                                                               |
| Size                    | Pre-launch: invite-only, a handful of accounts. Far below Ofcom's 7 million UK user "large service" line |

## The service

What a user can do that matters here, from the code:

| Feature                                                 | Present                                                                  | Where                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Accounts; email confirmed before sharing                | Yes                                                                      | Unconfirmed runners' kits are saved private (`feed/share-default.ts`) |
| Age gate (18+, self-declared date of birth)             | Yes                                                                      | `src/lib/contracts/age.ts` `MINIMUM_AGE = 18`; D-114                  |
| User profiles: username, the place you run, recent kits | Yes                                                                      | `feed/profiles.ts`                                                    |
| Search for runners by username                          | Yes                                                                      | `feed/search.ts`                                                      |
| Following                                               | Yes                                                                      | `feed/follows.ts`                                                     |
| Posting images (up to 4 per kit)                        | Yes                                                                      | `feed/photos.ts` `MAX_PHOTOS_PER_ENTRY`                               |
| Posting text: caption (280 chars), tags, product names  | Yes                                                                      | `feed/inputs.ts`; products are a shared catalogue                     |
| Posting links                                           | Product links only, https, with a domain denylist                        | `safety/denylist.ts`                                                  |
| Reactions ("useful")                                    | Yes                                                                      | `feed/reactions.ts`                                                   |
| Feed                                                    | Kits from runners you follow, newest first. No recommender ranks content | `feed/feed.ts` `followingFeed`                                        |
| Direct messages, comments, groups, live streaming       | **No**                                                                   | No table holds them (`src/db/schema-core.ts`)                         |
| Visible to signed-out visitors or search engines        | **No**                                                                   | D-58, D-53                                                            |
| Shows a run's location                                  | **No**                                                                   | Coordinates never shown (privacy policy "Weather and location")       |
| Shows when a run started                                | Yes, on a shared kit                                                     | `feed/entries.ts` `EntryDetail`                                       |

Controls already in place:

- Every photo screened by OpenAI's moderation model before others see it;
  high scores hidden and queued (`safety/screening.ts`). It covers sexual,
  violent and self-harm images, and **not** sexual content involving
  minors, which is text-only in that model (`classifier/moderation.ts`).
- Usernames screened by a word list and OpenAI (`account/handle-screen.ts`).
  Captions, tags and product names are **not** screened.
- Reports on kits, photos, profiles and product names, by confirmed
  runners; three reporters hide a kit or photo; one `intimate` report
  hides it at once (`safety/contracts.ts`).
- `/takedown` for intimate images, open to non-users (D-117, D-118).
- Blocks, both ways (`safety/visibility.ts`).
- A review queue, a person decides every removal and ban
  (`safety/review.ts`); a statement of reasons on removal
  (`safety/contracts.ts` `removalStatements`).
- Suspected-CSAM quarantine and the NCMEC procedure
  ([procedure](ncmec-and-take-it-down-procedures.md)).
- Bans (`safety/bans.ts`) and moderator renames (`safety/rename.ts`).
- Invite-only sign-up today; Mississippi and Tennessee refused (D-141).

Evidence used: the code above; no incidents, reports or complaints yet,
because the service has not launched. [OWNER: at each review, add the
number of reports, takedown requests and removals by reason since the last
one, from the Desk.]

## Step 1 and 2: each kind of illegal harm

Levels follow Ofcom's scale. Likelihood reads the features above; impact
reads who could be hurt and how badly. A level is the owner's judgement.

| Kind of illegal harm                                        | Likelihood | Impact | Level      | Why                                                                                                                                                                                                                                         |
| ----------------------------------------------------------- | ---------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terrorism                                                   | Very low   | High   | Negligible | A gear log with no messaging, groups or reach to the open web. Text is short captions and tags                                                                                                                                              |
| CSEA: grooming                                              | Low        | High   | Low        | Profiles, search and following are risk factors; there is no direct messaging or comments, which are the main ones. A child could join despite the age gate (see the [children's access assessment](uk-osa-childrens-access-assessment.md)) |
| CSEA: image-based CSAM                                      | Low        | High   | Low        | Image posting is a risk factor. No automated detection until PhotoDNA (C11); detection is by report and review. Signed-in-only visibility and invite-only sign-up limit spread. **Reassess at public, and again when C11 lands**            |
| CSEA: CSAM URLs                                             | Very low   | High   | Negligible | Links only as product links, https, against a denylist; captions do not render links [CHECK: that captions are plain text]                                                                                                                  |
| Hate                                                        | Low        | Medium | Low        | Usernames screened; captions and tags not. Reports cover it ("Harassment aimed at someone", "Something else")                                                                                                                               |
| Harassment, stalking, threats and abuse                     | Low        | Medium | Low        | No messaging or comments. A shared kit shows the date and start time of a run, and a profile shows the place someone runs, which together could reveal a routine. Mitigated: private kits, private default, blocks, no coordinates shown    |
| Controlling or coercive behaviour                           | Very low   | Medium | Negligible | No messaging; the service holds no relationship data                                                                                                                                                                                        |
| Intimate image abuse                                        | Low        | High   | Low        | Image posting. One report hides at once; `/takedown` with a 48-hour clock; copy search limited to the same runner until C16 (D-142)                                                                                                         |
| Extreme pornography                                         | Very low   | High   | Low        | Classifier hides sexual images above threshold; reports                                                                                                                                                                                     |
| Sexual exploitation of adults                               | Very low   | High   | Negligible | No messaging, no paid content, no contact details shown                                                                                                                                                                                     |
| Human trafficking                                           | Very low   | High   | Negligible | As above                                                                                                                                                                                                                                    |
| Unlawful immigration                                        | Very low   | Medium | Negligible | As above                                                                                                                                                                                                                                    |
| Fraud and financial services offences                       | Low        | Medium | Low        | Product links could point to scam shops. Mitigated: https only, domain denylist, the link's domain shown beside it, `spam` report reason                                                                                                    |
| Proceeds of crime                                           | Very low   | Low    | Negligible | No payments or transfers between users                                                                                                                                                                                                      |
| Drugs and psychoactive substances                           | Very low   | Medium | Negligible | No marketplace or messaging                                                                                                                                                                                                                 |
| Firearms, knives and other weapons                          | Very low   | Medium | Negligible | As above                                                                                                                                                                                                                                    |
| Suicide and self-harm (incl. encouraging serious self-harm) | Low        | High   | Low        | Classifier covers self-harm images; captions are not screened. Running communities discuss injury and overtraining, rarely self-harm                                                                                                        |
| Cyberflashing                                               | Low        | Medium | Low        | No messaging, so no unsolicited image to one person. An image in a kit reaches followers; the classifier hides sexual images                                                                                                                |
| Foreign interference                                        | Very low   | Low    | Negligible | No news, politics or reach                                                                                                                                                                                                                  |
| Animal cruelty                                              | Very low   | Medium | Negligible | Classifier covers graphic violence; reports                                                                                                                                                                                                 |

[CHECK: this list against Ofcom's current Register of Risks. It follows
the 2024 guidance's priority harms with the June 2026 changes; the
CSEA kind may need its sub-kinds assessed separately, as done here.]

**Other illegal content** (non-priority offences) and **use of the
service to commit an offence**: low. The most plausible are copyright
infringement in photos (handled through the DMCA process, `copyright.md`)
and false statements about products.

**Overall:** no kind is medium or high, so [dialed.run] is not
"multi-risk". [CHECK: Ofcom's definition: medium or high risk for at least
two kinds.]

## Step 3: measures

Ofcom's Illegal Content Codes of Practice set measures that apply to every
user-to-user service, whatever its size or risk, and more for larger or
riskier ones. [CHECK: the exact list and numbering in the current Codes.]
Mapped against what exists:

| Measure (as this draft understands the Codes)                                                    | Status                                                                                                       |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| A named person accountable for illegal-content duties                                            | [OWNER: name, above]                                                                                         |
| A content moderation function that reviews and swiftly takes down illegal content it is aware of | Review queue, Remove, quarantine, takedown (`safety/review.ts`, `feed/moderation.ts`). One person, no deputy |
| Terms that say how users are protected, clear and accessible                                     | `docs/legal/terms.md` "The rules", "Screening, reports and moderation", "Suspected illegal content"          |
| Easy reporting of illegal content, including by non-users                                        | In-app reports; `/takedown`; desk@dialed.run (terms "Suspected illegal content")                             |
| A complaints procedure, including appeals                                                        | desk@dialed.run; reply to the notice; no deadline (D-73; terms "Appeals")                                    |
| Act on complaints and tell the complainant                                                       | Removal and closure notices exist; reporter outcome notice is C8 (D-132), before public                      |
| Remove accounts of proscribed organisations                                                      | Bans exist; no list check. Negligible terrorism risk                                                         |

Measures not taken, and why:

- **Hash matching for CSAM**: not yet. The Codes require it of larger or
  higher-risk services. D-129 adopts PhotoDNA anyway (C11), before public.
- **Text screening of captions and tags**: not done; risk low; reports
  cover it.

## Step 4: report, review, update

- Review yearly, and **before** any of these: public launch; opening
  Groups; adding messages or comments; a change to who can see kits;
  removing the age gate. Each is a significant change.
- Review when C11 or C16 lands, and after any serious incident.
- Answer any Ofcom information request by its deadline (D-140).
- Keep each signed version: this file's git history is the record of
  versions. [OWNER: confirm git history is enough, or keep signed PDFs.]

## Sign-off

[OWNER: name, role, date.]
