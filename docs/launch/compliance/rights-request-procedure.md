# Rights request procedure

> **DRAFT: not reviewed by a lawyer.** Written 2026-11-27 from the code on
> `main` at `445f67a27`, for the owner to check and sign off before public
> (`docs/launch/legal-readiness-plan.md` step 4). Every `[CHECK: …]` is
> something this draft could not confirm; every `[OWNER: …]` is a fact or
> decision only the owner can supply.

What to do with a request by email about someone's own data (access,
correction, deletion, restriction, objection or portability) that the
app's own settings do not answer. The privacy policy promises an answer
"within 30 days" ("Your choices") and "within one month" ("Your rights").

Sign-off: [OWNER: name, and the date this procedure was adopted]

**This repository is public.** Each request's record lives in the
evidence store, never here: the private `dialed-evidence` R2 bucket with
no Worker binding (D-148; `ncmec-and-take-it-down-procedures.md` Part 1
Step 2 has the details).

## Who does this

The owner does every step: there is no second operator (D-148).

## The law

| Right                                         | Source                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| One month to answer, extendable by two        | [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj) Art. 12(3); UK GDPR the same |
| Refusing: say why, and that they can complain | Art. 12(4)                                                                         |
| No fee                                        | Art. 12(5)                                                                         |
| Confirming who is asking                      | Art. 12(6)                                                                         |
| Access, and leaving out other people's data   | Art. 15, 15(4)                                                                     |
| Correction                                    | Art. 16                                                                            |
| Deletion                                      | Art. 17                                                                            |
| Restriction                                   | Art. 18                                                                            |
| Telling those who received the data           | Art. 19                                                                            |
| Portability                                   | Art. 20                                                                            |
| Objection                                     | Art. 21                                                                            |

## Step 1: log it (owner, on receipt)

Trigger: an email to any @dialed.run address that asks for a copy of, a
correction to, deletion of, restriction of, or an objection to the use of
the writer's data. Record in the evidence store (D-148) under a
`rights/<received date>-<n>/` prefix: the email, the date received, and
the type. The clock starts at receipt.

## Step 2: set the deadline (owner, day 0)

30 days from receipt. The policy says "within 30 days" in "Your choices"
and "within one month" in "Your rights", and the GDPR gives one month
(Art. 12(3)). Use the shorter, 30 days. Note it in the log.

## Step 3: confirm who is asking (owner, within a few days)

If the request came from the account's own address, reply to that
address to confirm. If not, ask them to write from it, or to sign in and
use Settings; ask for nothing more than that (Art. 12(6)). The clock does
not wait, so ask early. Record how identity was confirmed.

## Step 4: do it (owner, before the deadline)

- **Access or portability:** point to Settings › Account › Export your
  data, and send in writing anything the export does not hold (for
  example moderation records about them, or rows the purge keeps),
  leaving out other people's data, such as who reported them
  (Art. 15(4)).
- **Correction:** fix what they cannot edit themselves, by hand in D1
  (Art. 16).
- **Deletion:** Settings › Account › Delete account; for a closed
  account, the Desk's deletion link once #1179 builds it. Say what stays,
  as the policy's "What stays" lists it under "Your choices".
- **Restriction (Art. 18) or objection (Art. 21):** the "Count my runs in
  anonymous totals" switch answers an objection to anonymous totals at
  once. The owner weighs any other one against the legitimate interest
  named in the policy's legal-bases table, and the answer says which way
  and why.

Record what was done, with the date.

## Step 5: tell those who received the data (owner, same day as step 4)

For a correction, deletion or restriction, tell any recipient that holds
a copy beyond the app's own storage, or record that none does (Art. 19).
Sentry and server logs age out on their own (30 and 7 days, the policy's
retention table).

## Step 6: if it cannot be done in time (owner, before day 30)

Write to say why, and extend by up to two months (Art. 12(3)). Record the
new deadline.

## Step 7: answer (owner, by the deadline)

Email what was done. If anything is refused, say why, and that they can
complain to their data protection authority (Art. 12(4); the policy's
"Your rights" says so too). No fee (Art. 12(5)).

## Step 8: close and keep the record (owner)

Store the answer and the date it was sent under the same prefix.

### The record kept

| Record                        | Kept                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `rights/<received date>-<n>/` | The email, date received, type, deadline, how identity was confirmed, what was done, who was told, the answer and its date           |
| How long                      | 3 years after the answer is sent (owner, 2026-11-27). Nothing deletes it on its own: delete the prefix by hand when the 3 years pass |
