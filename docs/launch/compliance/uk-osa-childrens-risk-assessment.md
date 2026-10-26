# UK Online Safety Act: children's risk assessment

> **DRAFT: not reviewed by a lawyer.** Written 2026-10-22 from the code on
> `main` at `11b124cb` and decision D-140, for the owner to check and sign
> off before public (`docs/launch/legal-readiness-plan.md` step 4). Every
> `[CHECK: …]` is something this draft could not confirm; every
> `[OWNER: …]` is a fact or decision only the owner can supply.

**About the sources.** Ofcom's website refused automated reads while this
was drafted; the structure comes from Ofcom's published guidance as
summarised by search results. [CHECK: move this record onto Ofcom's
template, or confirm it covers every field the template asks for.]

## Why this exists

The [children's access assessment](uk-osa-childrens-access-assessment.md)
concludes that [dialed.run] is likely to be accessed by children. So it
must assess the risk of harm to children from content on the service, and
take proportionate measures (Online Safety Act 2023 ss.11 and 12; written
record s.23; [legislation.gov.uk](https://www.legislation.gov.uk/ukpga/2023/50)).

Ofcom's guidance uses the same four steps as the illegal content
assessment, applied to three tiers of content harmful to children
(ss.60–62):

- **Primary priority content:** pornography; content that encourages,
  promotes or gives instructions for suicide, self-harm, or an eating
  disorder.
- **Priority content:** abuse and hate; bullying; violent content (to
  people or animals); harmful substances; dangerous stunts and challenges.
- **Non-designated content:** other content of a kind that presents a
  material risk of significant harm to an appreciable number of UK
  children. Ofcom's register names two: body stigma content and
  depression content. A provider that finds a new kind must tell Ofcom
  (nondesignatedcontent@ofcom.org.uk).

Sources: Ofcom,
[Protection of children duties](https://www.ofcom.org.uk/online-safety/protecting-children/protection-of-children-duties-under-the-online-safety-act);
[Children's Risk Assessment Guidance and Children's Risk Profiles](https://ofcom.org.uk/siteassets/resources/documents/consultations/category-1-10-weeks/statement-protecting-children-from-harms-online/main-document/childrens-risk-assessment-guidance-and-childrens-risk-profiles.pdf);
[Children's Register of Risks](https://www.ofcom.org.uk/siteassets/resources/documents/consultations/category-1-10-weeks/statement-protecting-children-from-harms-online/main-document/childrens-register-of-risks.pdf).

## Record details

| Field              | Value                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| Service            | [dialed.run], `app.dialed.run`                                                                            |
| Provider           | Big Long Run Labs LLC (D-125)                                                                             |
| Person accountable | The owner, the LLC's sole member and only operator (owner, 2026-10-24; D-148). The signed copy names them |
| Date               | [OWNER: date signed]                                                                                      |
| Next review        | 12 months, or before a significant change (D-140)                                                         |
| Children on it     | Not allowed by the terms (18+); not measured. Assessed as if some are present                             |
| Assessed by        | The owner, from this draft                                                                                |

## The service, for children

The features and controls are those in the
[illegal content risk assessment](uk-osa-illegal-content-risk-assessment.md#the-service);
they are not repeated here. What matters most for children:

- **No direct messages, comments or groups.** An adult cannot write to a
  child privately on [dialed.run].
- **Discovery.** Anyone signed in can search usernames, open a profile
  (username, the place someone runs, recent shared kits) and follow.
- **Photos.** Kits carry up to four photos. Faces are blurred on the
  device by default (`safety/blur/`), and every photo is screened before
  others see it.
- **The feed** shows kits from runners you follow, newest first. No
  algorithm promotes content, so there is no recommender to push harmful
  content at a child. Reactions are "useful" counts only.
- **Body and performance.** Running content can touch weight, body shape
  and training load. Captions are free text and are not screened.

## Step 1 and 2: each kind of content

| Content                         | Tier             | Likelihood | Impact | Level      | Why                                                                                                                                                            |
| ------------------------------- | ---------------- | ---------- | ------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pornography                     | Primary priority | Very low   | High   | Low        | Against the terms; classifier hides sexual images above 0.9 (`classifier/moderation.ts` `thresholds`) and queues the middle band; reports                      |
| Suicide                         | Primary priority | Very low   | High   | Low        | Off-topic for a gear log; captions unscreened; reports                                                                                                         |
| Self-harm                       | Primary priority | Very low   | High   | Low        | Classifier covers self-harm images (`self-harm`, `/intent`, `/instructions`); captions unscreened                                                              |
| Eating disorders                | Primary priority | Low        | High   | Low        | Running communities can glamorise low weight. Nothing here is about food or weight, and there is no weight field. Captions unscreened; no classifier covers it |
| Abuse and hate                  | Priority         | Low        | Medium | Low        | Usernames screened; captions and tags not; no comments                                                                                                         |
| Bullying                        | Priority         | Low        | Medium | Low        | No comments or messages; "useful" has no negative counterpart; blocks; reports                                                                                 |
| Violent content                 | Priority         | Very low   | Medium | Low        | Classifier covers violence and graphic violence                                                                                                                |
| Harmful substances              | Priority         | Very low   | Medium | Negligible | Off-topic; no marketplace                                                                                                                                      |
| Dangerous stunts and challenges | Priority         | Low        | Medium | Low        | Extreme-weather runs could be shared as a challenge. The terms say the app is not safety advice (`terms.md` "Not advice. Run at your own risk")                |
| Body stigma                     | Non-designated   | Low        | Medium | Low        | Kit photos show bodies in running clothes; captions are free text. Faces blurred by default; reports                                                           |
| Depression                      | Non-designated   | Very low   | Medium | Negligible | Off-topic                                                                                                                                                      |

[CHECK: Ofcom's risk levels for children's harms, and whether a level of
"low" across every kind means only the measures for all services apply.]

No new kind of non-designated content was found, so there is nothing to
notify Ofcom of.

**Grooming and contact by adults** is assessed in the illegal content
record (CSEA: grooming, low): there is no private channel.

## Step 3: measures

Ofcom's Protection of Children Codes set measures for every service likely
to be accessed by children, and more for higher risk.
[CHECK: the current list.] What exists, and the owner's choices:

| Measure                                                                  | Status                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A named person accountable for children's safety duties                  | The owner (above)                                                                                                                                                                                                                                                                    |
| Terms that explain how children are protected                            | Partly: the terms set 18+ and close under-18 accounts (`terms.md` "Who can use [dialed.run]"); they do not describe children's protections as such. [OWNER: decide whether to add a sentence]                                                                                        |
| Content moderation that acts on content harmful to children              | The same review queue and Remove as for illegal content                                                                                                                                                                                                                              |
| Reporting and complaints for content harmful to children                 | Reports cover it under "The photo shows someone inappropriately", "Harassment aimed at someone" and "Something else"; desk@ for complaints. There is no report reason naming self-harm, eating disorders or a child. [OWNER: decide whether to add one; a reason is a design change] |
| Highly effective age assurance where primary priority content is allowed | Not applicable: the terms allow none of it                                                                                                                                                                                                                                           |
| Recommender safety measures                                              | Not applicable: no recommender                                                                                                                                                                                                                                                       |
| Under-age accounts closed and their data deleted                         | Yes, by hand on a report (terms; privacy policy "Children")                                                                                                                                                                                                                          |

## Step 4: review

- Yearly, and before a significant change: public launch, Groups,
  comments or messages, a recommender, or removing the age gate.
- At each review, record reports by reason and any under-age closures
  since the last one, from the Desk.

## Sign-off

[OWNER: name, role, date.]
