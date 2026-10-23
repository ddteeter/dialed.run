# Launch compliance records

Drafts the owner reads, corrects and signs before public launch
(`docs/launch/legal-readiness-plan.md` step 4, "Documents I draft and the
owner signs off"). They are records and procedures, not public text: the
public text is in `docs/legal/`.

Each one describes what the code does today, says where a step is done by
hand, and marks `[CHECK: …]` where this draft could not confirm a legal
point and `[OWNER: …]` where only the owner can supply a fact. None has
been reviewed by a lawyer (D-122).

| Record                                                                              | What it is                                                       | Decisions                 |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------- |
| [UK OSA illegal content risk assessment](uk-osa-illegal-content-risk-assessment.md) | Ofcom's four steps across the priority illegal harms             | D-140                     |
| [UK OSA children's access assessment](uk-osa-childrens-access-assessment.md)        | Concludes "likely to be accessed by children", and why           | D-140, D-114              |
| [UK OSA children's risk assessment](uk-osa-childrens-risk-assessment.md)            | The children's harms, their levels, and the measures             | D-140                     |
| [NCMEC and TAKE IT DOWN procedures](ncmec-and-take-it-down-procedures.md)           | Reporting suspected CSAM, and the 48-hour intimate-image removal | D-70, D-117, D-131, D-142 |
| [Breach response runbook](breach-response-runbook.md)                               | Detect, contain, assess, notify, record                          | D-115, D-125              |
| [Record of processing (ROPA)](ropa.md)                                              | GDPR Art. 30, derived from the privacy policy                    | D-122                     |

**This repository is public.** Nothing personal goes in these files:
incident notes, the breach register and CSAM evidence live in the owner's
private storage, as each document says.

Review each at least yearly, and when the code it cites changes. The UK
records must also be redone before any significant change to the service
(D-140).
