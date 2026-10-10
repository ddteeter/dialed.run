# Design: 136 TAKE IT DOWN removal path (R-145)

## Problem

The TAKE IT DOWN Act has been enforced since 2026-05-19. A platform that hosts user content must offer a clear and conspicuous way to ask for removal of a non-consensual intimate image (NCII), remove a valid one within 48 hours, and make reasonable efforts to remove known identical copies. It has no size floor and the FTC enforces it.

Today, reporting needs a signed-in, confirmed account. One report only hides the item from the reporter, and nothing reaches the owner before the daily digest. The owner's calls (2026-10-10):

- an in-app reason that hides at once and alerts the operators;
- a signed-out page and form whose requests queue with an alert but hide nothing until reviewed;
- requests are kept until the owner deletes them.

## Approach

Two PRs, stacked.

**PR A: the in-app reason.**

- `safety/contracts.ts` gains the reason `intimate` ("It's an intimate image shared without consent", placeholder copy). It also gains a per-reason threshold, `reportersToHide`, which is 1 for `intimate` and `autoHideReporterThreshold` (3) for every other reason, and a removal statement `intimate`.
- `fileReport` reads the threshold and changes nothing else.
- `hidePendingReview` takes the extra batch items. For `intimate`, those are one email debt per operator (new kind `removal_due`, with the subject, a link to Review, and the time it is due). They are owed in the same batch as the hide and the queue row, so the hide never lands without its alert (law 8c).
- Safety cannot import `ops`, so `owe` is handed in from the server function, as the runs consumer's is.
- The hourly drain sends the email within the hour.
- The hourly reconcile also re-hides, and re-alerts for, a subject with an `intimate` report.
- The Review row shows "Due in 31h" / "Overdue" for a subject that has an `intimate` report: 48h from the first one.

**PR B: the signed-out request.**

- A new table, `takedown_requests` (additive; migration `add_takedown_requests`).
- A public page and form at `/takedown`, on Au5's pattern: forms primitives, Turnstile, a per-IP limit and an idempotency key.
- One batch: the request, a review row (new source `takedown_request`), an alert to each operator, and a receipt to the requester.
- The Review page shows a requests section ordered by due time, with Take it down (the existing `moderateContent` takedown, reason `intimate`) and Decline.
- Copies: the row lists the same runner's other photos. No photo hashing exists, and blur re-encodes every upload, so an exact hash would rarely match.

## Contract touches

- Schema changes:
  - PR A: `reports.reason` and `review_queue.source` enums gain values. These are TypeScript only; the columns are plain text, so there is no migration.
  - PR B: one new table. Additive, so it proceeds and is named in the PR.
- New route: PR B, `src/routes/takedown.tsx`.
- New bindings/queues/crons: none.
- Screens: W1 gains a reason, the Review row gains a deadline, and PR B adds a new page, form and section. All are undesigned and go in `docs/design-deltas.md` item 58 and the round 35 prompt.

## Test plan

- PR A:
  - `test/safety/contracts.test.ts`: the threshold per reason and the labels.
  - `test/safety/reports.test.ts` (worker):
    - one `intimate` report hides an entry and a photo for a stranger, with the queue row and one email debt per operator in the same batch;
    - an `explicit` report still needs three reporters;
    - the reconcile sweep restores a missing hide and its alert.
  - `ReviewQueue.dom`: due and overdue.
- PR B: worker tests for the form's write, the limit and idempotency; a DOM test for the page; and an e2e demo of the signed-out request, its receipt, the Review row and Take it down.

## Open questions

- **The abuse cost of hiding at once.** `reports.ts` notes that three unconfirmed accounts "would be a takedown on demand". One confirmed account now does it for `intimate`. The owner chose this: a person still decides, and a false report only hides the item until then. Recorded as D-117.
