# UK Online Safety Act: children's access assessment

> **DRAFT: not reviewed by a lawyer.** Written 2026-10-22 from the code on
> `main` at `11b124cb` and decision D-140, for the owner to check and sign
> off before public (`docs/launch/legal-readiness-plan.md` step 4). Every
> `[CHECK: …]` is something this draft could not confirm; every
> `[OWNER: …]` is a fact or decision only the owner can supply.

**About the sources.** Ofcom's website refused automated reads while this
was drafted. The two-stage test and its wording come from Ofcom's
published quick guide as summarised by search results, and from the
paragraphs D-140 cites. [CHECK: open Ofcom's Children's Access
Assessments Guidance and confirm paragraphs 3.9, 4.2 and 4.11 say what
D-140 and this record say they do.]

## Conclusion

**[dialed.run] is likely to be accessed by children.** The children's
risk assessment and the children's safety duties therefore apply
([children's risk assessment](uk-osa-childrens-risk-assessment.md)).

## The duty

A regulated user-to-user service must carry out a children's access
assessment and keep a written record of it (Online Safety Act 2023 ss.35
and 36, [legislation.gov.uk](https://www.legislation.gov.uk/ukpga/2023/50)).
A service is "likely to be accessed by children" if it is possible for
children to access it and the child user condition is met (s.37).
[CHECK: the section numbers.] A service that has not done an assessment is
treated as likely to be accessed by children.

Ofcom's guidance sets two stages
([quick guide](https://www.ofcom.org.uk/online-safety/information-for-industry/guide-for-services/quick-guide-to-childrens-access-assessments)):

1. **Is it possible for children to access the service?** A provider may
   answer "no" only if it uses highly effective age assurance, with access
   controls that keep out anyone not shown to be an adult.
2. **Is the child user condition met?** Either the service has a
   significant number of child users, or it is of a kind likely to attract
   a significant number of them. "Significant" means material in the
   context of the service, and can be a small proportion; it is not a
   fixed number.

## Stage 1: can children access it?

**Yes.** The evidence:

- The terms say [dialed.run] is for people 18 and over (`terms.md` "Who
  can use [dialed.run]"; D-114).
- Sign-up asks for a date of birth and the server checks it
  (`src/lib/contracts/age.ts` `isOldEnough`, `MINIMUM_AGE = 18`;
  `auth/access-hook.ts`). Nothing checks the date is true. A refusal sets a
  one-day cookie (`dialed_age_refused`), which a new browser avoids.
- Self-declaration is not highly effective age assurance. D-140 records
  that Ofcom's guidance (3.9, 4.2, 4.11) does not allow a "not likely to
  be accessed" conclusion on an 18+ term and a date-of-birth prompt.
- Sign-up is invite-only today (`src/lib/contracts/access.ts`
  `IS_INVITE_ONLY`). An invite is not age assurance either, and it ends at
  public launch.

## Stage 2: the child user condition

**Met, on the second limb.** There is no data on how many children use
[dialed.run]: it has not launched, and it keeps no age. Ofcom's guidance
notes that counting children is hard without age assurance and suggests
focusing on whether the service is of a kind likely to attract them.

[dialed.run] is a running-gear log with photos, a feed and following.
Running is a common school and club sport for under-18s in the UK, and
nothing about the service is adult in kind: no dating, gambling,
alcohol or adult content. A teenage runner is as likely to want to know
what to wear in the cold as an adult one. [OWNER: add any evidence you
have, such as the age profile of similar running apps or of parkrun's
junior events; none is cited here.] The first limb is unknown and is
re-checked at each review from reports of under-age accounts.

## What would change the conclusion

Only highly effective age assurance at sign-up (for example a
document-and-selfie check or a credit-card check, as Ofcom lists them),
with access controls behind it. D-141 records Stripe Identity (US$1.50 a
check) as the way back into Mississippi and Tennessee; the same tool would
change Stage 1 here. That is an owner decision with a cost, not proposed.

## Record details

| Field             | Value                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Service           | [dialed.run], `app.dialed.run`                                                                                                            |
| Provider          | Big Long Run Labs LLC (D-125)                                                                                                             |
| Date              | [OWNER: date signed]                                                                                                                      |
| Next review       | 12 months after that date, or sooner if the age gate changes, age assurance is added, or reports show a significant number of child users |
| Evidence          | The code cited above; D-114, D-140, D-141; no usage data (pre-launch)                                                                     |
| Under-age reports | [OWNER: at each review, the number of accounts closed as under 18 since the last one]                                                     |
| Assessed by       | The owner, from this draft                                                                                                                |

## Sign-off

[OWNER: name, role, date.]
