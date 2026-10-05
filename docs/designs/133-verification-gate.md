# Design: 133 the structural verification gate

> **Approved by the owner on 2026-10-04 (D-113)**; the answers are in
> §Decisions. Over the one-page cap on purpose: the owner asked for every
> server function to be audited, and the audit is the table in §Audit. The
> prose sections stay inside the cap.

## Problem

The owner's decision (2026-10-03, no D-row yet): email verification is a
**soft gate, enforced structurally and default-deny**. **The rule: writes
that others can see require a confirmed address.** Today that is enforced in
three places by hand. `feed/reactions.ts` (Useful), `safety/reports.ts`
(report) and `account/verification.ts` (email change) each call
`account`'s `isVerified` and return `{ status: "unverified" }`. A fourth,
different mechanism is D-50's clamp: `feed/share-default.ts` reads
`isUnconfirmed` and saves an unconfirmed runner's entries `private`. Nothing
makes a new function choose. Product creation, follows and handles never
did (see §Audit).

## Approach

**One gate, named by what it calls**, the way the terms gate works
(`auth/terms-gate.ts`, PR #140):

- `auth/terms-gate.ts` gains `confirmedUserId(db, session, current)`. It is
  `agreedUserId` plus the confirmation, read **in the same `db.batch()`** as
  the leaving claim and the latest acceptance, so it adds no round trip.
  Refusal order: no session, then leaving, then behind on terms, then
  unconfirmed. A runner who is behind on the terms sees the terms prompt
  first. `account` exports the confirmation read as a lazy builder, and
  `emailConfirmationOf`/`isVerified` reuse it, so the fact is still read in
  one place.
- `auth/require-user.ts` gains `verifiedUserId()` (glue, like
  `requireUserId`). Both are exported from `auth`'s index. The eslint rule
  against private auth gates already covers any copy.
- It **throws** `EmailUnconfirmedError` (code `EMAIL_UNCONFIRMED`, in
  `lib/auth-signal.ts` next to `TERMS_NOT_ACCEPTED`). A gate cannot return a
  result, because glue may not branch.
- **Classification is a table in the architecture test**:
  `test/architecture/verification-class.test.ts`, which reads sources as
  text the way `terms-exempt.test.ts` does. It holds **every** server
  function (`module/functions.ts name`) and every `server.handlers` route,
  each with one class:
  - `verified`: calls `verifiedUserId`;
  - `unconfirmed`: calls `requireUserId`, `requireUserIdBeforeTerms`,
    `requireSignedInSince` or `requireUserIdWhileLeaving`, and not
    `verifiedUserId`;
  - `admin`: `requireAdmin(await verifiedUserId())`;
  - `sessionless`: calls none of these (`optionalUserId`, a signed link or a
    token).

  The test checks both ways. A function that is not in the table fails,
  which is the default-deny. So do a table row with no function and a class
  the body does not match. A guard (`> 100 found`) stops an empty scan from
  passing.

- **Why a table and not a strict `requireUserId`** (making
  `requireUserId` verified and naming the exemptions, as terms does). The
  exemptions would be about 80 of 121 functions. That means renaming about
  80 call sites across all 11 `functions.ts` files to get the same test.
  The table makes classifying a function a reviewable one-line diff.
- **The UI.** `ui/use-form-submit.ts`'s `classifyFailure` gains
  `kind: "unconfirmed"`. A new `ui/unconfirmed-refusal.tsx` context
  (mirroring `ui/terms-refusal.tsx`, D-96) is provided at the root. Its
  answer opens `account`'s existing `ConfirmEmailSheet`, fetching the
  address with `ownAccountQuery` when it opens. The form and control hooks
  pass their own `trigger`, so the sheet keeps its per-control sentence.
  This replaces the per-function `refusal` path from #139, which stays
  available for other kinds of decline.
- **Clamps stay clamps.** Where the visible part rides on a private
  primary write, the write is allowed and only its visibility is withheld.
  Entries already work this way (D-50). Product creation should too
  (Q1). Clamps read `isUnconfirmed` and are pinned by their own tests
  (`test/account/unconfirmed-sharing.test.ts`).

## Audit

**121 `createServerFn`** in `src/modules/*/functions.ts` (account 26,
feed 32, onboarding 13, safety 12, runs 12, closet 11, email 5,
notifications 4, auth 2, ops 2, products 2), plus **10 `server.handlers`
routes**. Counted with
`grep -cE '= createServerFn' src/modules/*/functions.ts`. Nothing outside
`functions.ts` calls `createServerFn`.

Gate key: **R** `requireUserId`, **BT** `requireUserIdBeforeTerms`,
**A** `requireAdmin(requireUserId)`, **O** `optionalUserId`, **—** no
session, **L** signed link or token, **P** password or fresh sign-in,
**W** while leaving, **iV** `isVerified` inside the module. Classes:
**V** verified, **U** unconfirmed, **Ad** admin, **S** sessionless.
**≠** means current behaviour differs from the proposed class.

| module/function                          | M    | does                                         | others see?                                       | now    | class                    |
| ---------------------------------------- | ---- | -------------------------------------------- | ------------------------------------------------- | ------ | ------------------------ |
| account/claimUsernameFn                  | POST | claim or change handle (O0)                  | **yes**: search, H, author line                   | R      | **Q2** (rec U)           |
| account/usernameQuery                    | GET  | own handle                                   | no                                                | R      | U                        |
| account/renameNoticeQuery                | GET  | moderator-rename notice                      | no                                                | R      | U                        |
| account/keepPlaceholderFn                | POST | keep placeholder handle                      | no (handle unchanged)                             | R      | U                        |
| account/handleGateQuery                  | GET  | send to O0?                                  | no                                                | O      | S                        |
| account/accountPageQuery                 | GET  | Settings › Account                           | no                                                | BT     | U                        |
| account/optionalAccountQuery             | GET  | account view, maybe signed out               | no                                                | O      | S                        |
| account/ownAccountQuery                  | GET  | own address and confirmation state           | no                                                | R      | U                        |
| account/resendConfirmationFn             | POST | resend confirm link (by address)             | no                                                | —      | S                        |
| account/confirmEmailFn                   | POST | spend confirm link                           | no                                                | L      | S                        |
| account/requestEmailChangeFn             | POST | email change link                            | no; trusts the address (D-50)                     | R+P+iV | V (iV moves to the gate) |
| account/turnstileSiteKeyQuery            | GET  | public site key                              | no                                                | —      | S                        |
| account/requestAccessFn                  | POST | Au5 access request                           | operators only                                    | —      | S                        |
| account/accessDeskQuery                  | GET  | Desk D7                                      | operator                                          | A      | Ad                       |
| account/createInviteCodeFn               | POST | new invite code                              | operator                                          | A      | Ad                       |
| account/inviteFromRequestFn              | POST | email an invite                              | **yes**, the requester                            | A      | Ad                       |
| account/declineRequestFn                 | POST | decline request                              | operator                                          | A      | Ad                       |
| account/revokeInviteCodeFn               | POST | revoke code                                  | operator                                          | A      | Ad                       |
| account/restoreInviteCodeFn              | POST | un-revoke code                               | operator                                          | A      | Ad                       |
| account/legalPageQuery                   | GET  | legal page text                              | no                                                | O      | S                        |
| account/requestExportFn                  | POST | queue data export                            | no                                                | BT     | U (Q6)                   |
| account/requestDeletionFn                | POST | delete account                               | removes content                                   | P      | U                        |
| account/keepAccountFn                    | POST | cancel deletion                              | no                                                | W      | U                        |
| account/leavingQuery                     | GET  | /account/leaving view                        | no                                                | O      | S                        |
| account/termsPromptQuery                 | GET  | terms prompt view                            | no                                                | O      | S                        |
| account/acceptTermsFn                    | POST | accept terms                                 | no                                                | BT     | U                        |
| auth/getSession                          | GET  | session                                      | no                                                | —      | S                        |
| auth/signedInQuery                       | GET  | signed in?                                   | no                                                | —      | S                        |
| closet/listItemsFn                       | GET  | closet list                                  | no                                                | R      | U                        |
| closet/closetNearbyFn                    | GET  | rail card                                    | no                                                | R      | U                        |
| closet/getItemFn                         | GET  | item detail                                  | no                                                | R      | U                        |
| closet/createItemFn                      | POST | add garment, **creates brand/product rows**  | **yes**: global brand autocomplete, product names | R      | **≠** U + clamp (Q1)     |
| closet/updateItemFn                      | POST | edit garment, **creates brand/product rows** | **yes**, same                                     | R      | **≠** U + clamp (Q1)     |
| closet/retireItemFn                      | POST | retire                                       | no                                                | R      | U                        |
| closet/unretireItemFn                    | POST | unretire                                     | no                                                | R      | U                        |
| closet/deleteItemFn                      | POST | delete garment                               | removes from own entries                          | R      | U                        |
| closet/addFromTapListFn                  | POST | tap-list garments (curated, no product rows) | no                                                | R      | U                        |
| closet/uploadPhotoFn                     | POST | garment photo                                | no (owner-only route)                             | R      | U                        |
| closet/removePhotoFn                     | POST | remove garment photo                         | no                                                | R      | U                        |
| email/unsubscribeLinkQuery               | GET  | read signed link                             | no                                                | L      | S                        |
| email/unsubscribeFn                      | POST | unsubscribe                                  | no                                                | L      | S                        |
| email/resubscribeFn                      | POST | resubscribe                                  | no                                                | L      | S                        |
| email/notificationSettingsQuery          | GET  | notification settings                        | no                                                | R      | U                        |
| email/saveNotificationSettingsFn         | POST | reminder switch                              | no                                                | R      | U                        |
| feed/attachKitAction                     | POST | create entry                                 | if public; **D-50 clamps private**                | R      | U (Q4)                   |
| feed/attachContextQuery                  | GET  | A2 context                                   | no                                                | R      | U                        |
| feed/prefillForRunQuery                  | GET  | A2 prefill                                   | no                                                | R      | U                        |
| feed/submitVerdictAction                 | POST | verdict, caption, audience                   | if public; **clamped** (`audienceAsChosen`)       | R      | U (Q4)                   |
| feed/verdictBacklogQuery                 | GET  | DS2 rows                                     | no                                                | R      | U                        |
| feed/unjudgedRunCountQuery               | GET  | count                                        | no                                                | R      | U                        |
| feed/saveBacklogRowAction                | POST | verdict from backlog                         | if public; **clamped**                            | R      | U (Q4)                   |
| feed/verdictBandCountsQuery              | GET  | own band counts                              | no                                                | R      | U                        |
| feed/bandSignalsQuery                    | GET  | band signals                                 | no                                                | R      | U                        |
| feed/itemBandWearStatQuery               | GET  | item stat                                    | no                                                | R      | U                        |
| feed/verdictPromptQuery                  | GET  | prompt?                                      | no                                                | R      | U                        |
| feed/recordVerdictPromptedAction         | POST | mark prompted                                | no                                                | R      | U                        |
| feed/entryDetailQuery                    | GET  | D                                            | no                                                | R      | U                        |
| feed/setUsefulAction                     | POST | Useful on/off                                | **yes**: count, notification                      | R+iV   | V (iV moves to the gate) |
| feed/followAction                        | POST | follow                                       | **yes**: follower count on H                      | R      | **≠** V (Q3)             |
| feed/unfollowAction                      | POST | unfollow                                     | only removes                                      | R      | U (Q3)                   |
| feed/followStatusQuery                   | GET  | following?                                   | no                                                | R      | U                        |
| feed/followingFeedQuery                  | GET  | E1                                           | no                                                | R      | U                        |
| feed/yourConditionsQuery                 | GET  | E2 consensus                                 | no                                                | R      | U                        |
| feed/conditionsHomeQuery                 | GET  | saved place                                  | no                                                | R      | U                        |
| feed/saveConditionsCityAction            | POST | save place                                   | no                                                | R      | U                        |
| feed/viewerUnitsQuery                    | GET  | units                                        | no                                                | O      | S                        |
| feed/ownProfileQuery                     | GET  | G                                            | no                                                | R      | U                        |
| feed/runnerHandleQuery                   | GET  | handle by id                                 | no                                                | R      | U                        |
| feed/profileAtHandleQuery                | GET  | H                                            | no                                                | R      | U                        |
| feed/searchQuery                         | GET  | runner search                                | no                                                | R      | U                        |
| feed/uploadPhotoAction                   | POST | entry photo                                  | if entry public; **clamped by entry**             | R      | U (Q4)                   |
| feed/retractEntryAction                  | POST | retract entry                                | only removes                                      | R      | U                        |
| feed/deleteEntryPhotoAction              | POST | delete entry photo                           | only removes                                      | R      | U                        |
| feed/garmentBandCountQuery               | GET  | delete sheet count                           | no                                                | R      | U                        |
| feed/decideReviewAction                  | POST | review decision, takedown                    | **yes**                                           | A      | Ad                       |
| feed/takedownAction                      | POST | copyright takedown                           | **yes**                                           | A      | Ad                       |
| notifications/listNotificationsFn        | GET  | list                                         | no                                                | R      | U                        |
| notifications/unreadNotificationCountFn  | GET  | dot                                          | no                                                | BT     | U                        |
| notifications/markAllNotificationsReadFn | POST | mark read                                    | no                                                | R      | U                        |
| notifications/bellStateFn                | GET  | bell                                         | no                                                | R      | U                        |
| onboarding/callLadderQuery               | GET  | ladder                                       | no                                                | R      | U                        |
| onboarding/localeUnitsQuery              | GET  | units from Accept-Language                   | no                                                | —      | S                        |
| onboarding/saveCalibrationFn             | POST | calibration                                  | no                                                | R      | U                        |
| onboarding/starterListQuery              | GET  | starter list                                 | no                                                | R      | U                        |
| onboarding/completeOnboardingFn          | POST | finish onboarding                            | no                                                | R      | U                        |
| onboarding/settingsQuery                 | GET  | settings                                     | no                                                | R      | U                        |
| onboarding/saveUnitsFn                   | POST | units                                        | no                                                | R      | U                        |
| onboarding/saveSharingFn                 | POST | default audience                             | seeds entries; **D-50 clamps**                    | R      | U                        |
| onboarding/lookUpCityFn                  | POST | resolve a city (billed upstream)             | no                                                | R      | U                        |
| onboarding/onboardingGateQuery           | GET  | onboarding needed?                           | no                                                | O      | S                        |
| onboarding/namingOfferQuery              | GET  | O3 naming offer                              | no                                                | R      | U                        |
| onboarding/nameGarmentFn                 | POST | name garment, **creates brand/product rows** | **yes**, as createItemFn                          | R      | **≠** U + clamp (Q1)     |
| onboarding/namingSuggestionsQuery        | GET  | brand/product suggestions                    | reads others' UGC                                 | **—**  | **≠** U (finding F1)     |
| ops/deskAccessQuery                      | GET  | operator?                                    | no                                                | O      | S                        |
| ops/deskTodayQuery                       | GET  | Desk D0                                      | operator                                          | A      | Ad                       |
| products/searchBrandsFn                  | GET  | brand autocomplete                           | no                                                | R      | U                        |
| products/resolveProductFn                | POST | **create brand + product**                   | **yes**                                           | R      | **≠** delete (no caller) |
| runs/submitManualRun                     | POST | manual run                                   | no (runs never shown)                             | R      | U                        |
| runs/startFileImport                     | POST | file import                                  | no                                                | R      | U                        |
| runs/getImportOutcomeFn                  | GET  | import status                                | no                                                | R      | U                        |
| runs/getRunSummaryFn                     | GET  | run                                          | no                                                | R      | U                        |
| runs/listRunSummariesFn                  | GET  | runs                                         | no                                                | R      | U                        |
| runs/setRunConditionsFn                  | POST | manual conditions                            | no (private entries excluded from consensus)      | R      | U                        |
| runs/retryRunWeatherFn                   | POST | retry weather                                | no                                                | R      | U                        |
| runs/retimeRunFn                         | POST | retime run                                   | no                                                | R      | U                        |
| runs/getStravaStatusFn                   | GET  | Strava status                                | no                                                | R      | U                        |
| runs/completeStravaConnectFn             | POST | connect Strava                               | no                                                | R      | U                        |
| runs/disconnectStravaFn                  | POST | disconnect                                   | no                                                | R      | U                        |
| runs/deleteRunFn                         | POST | delete run and entry                         | only removes                                      | R      | U                        |
| safety/fileReportAction                  | POST | report (+ block)                             | **yes**: operators                                | R+iV   | V (iV moves to the gate) |
| safety/blockRunnerAction                 | POST | block                                        | no (silent)                                       | R      | U (Q7)                   |
| safety/unblockRunnerAction               | POST | unblock                                      | no                                                | R      | U (Q7)                   |
| safety/blockedRunnersQuery               | GET  | blocked list                                 | no                                                | R      | U                        |
| safety/reviewQueueQuery                  | GET  | review queue                                 | operator                                          | A      | Ad                       |
| safety/claimReviewAction                 | POST | claim review                                 | operator                                          | A      | Ad                       |
| safety/banUserAction                     | POST | ban + email                                  | **yes**                                           | A      | Ad                       |
| safety/denyDomainAction                  | POST | deny domain                                  | **yes** (sign-ups)                                | A      | Ad                       |
| safety/unbanUserAction                   | POST | unban + email                                | **yes**                                           | A      | Ad                       |
| safety/reviewHandleAction                | POST | keep/rename flagged handle                   | **yes**                                           | A      | Ad                       |
| safety/forceRenameAction                 | POST | force rename                                 | **yes**                                           | A      | Ad                       |
| safety/deskRunnersQuery                  | GET  | Desk D8                                      | operator                                          | A      | Ad                       |

Totals: **V 4** (3 of them already check inside the module), **Ad 17**,
**S 18**, **U 81** (counting Q2's recommendation and the 3 Q1 functions,
which are U plus a clamp), and **1 to delete**.

**Server routes (10, 12 handlers).** All GET reads, except three POST
handlers. `api/auth/$` GET/POST is Better Auth's own endpoint; D-50's
reset-by-email wait lives in `create-auth.ts`. `api/strava` POST is a
machine webhook. `account/unsubscribe` POST is a signed one-click link.
The others: `feed/photo.$` (O), `safety/review-photo.$` (O + admin
inside), `closet/photo.$itemId.$size` (session, owner-only),
`account/export.$token` (token), `og/default`, `api/health`,
`runs/strava-connect` (O). All are **S** or U, and the table lists them so
a new handler is classified too.

**Mismatches (the bugs):**

1. `closet/createItemFn` makes shared `brands`/`products` rows for an
   unconfirmed runner.
2. `closet/updateItemFn` does the same.
3. `onboarding/nameGarmentFn` does the same; even the brand-only path
   creates a brand.
4. `products/resolveProductFn` creates a brand and a product ungated, and
   no route calls it. It is a live endpoint that is dead code.
5. `feed/followAction` changes another runner's follower count, ungated.
6. `account/claimUsernameFn`: an unconfirmed runner's handle is
   searchable and has a page at H. A mismatch under the strict rule (Q2).

**F1, outside the rule:** `onboarding/namingSuggestionsQuery` has no
session at all. It serves everyone's brand and product names to the open
web, against D-58 ("public" means signed-in).

## Contract touches

- Schema: **none**. The link on confirm (Q1) needs no marker column: the
  confirmation owes it as an outbox row, and the rows it links are the
  ones still carrying a typed brand and no product.
- Wire format: one new outbox kind, `product_link` `{ userId }` (law 9:
  added, nothing repurposed).
- Routes: `__root.tsx` provides the unconfirmed answer (the root's own
  wiring); D, H and the feed stop composing their own sheets. Bindings and
  crons: **none** new; the `:00` firing gains a step.
- Design delta (item 49): the confirm sheet has no sentence for
  **Follow** (`WAITS_FOR`) and shows the address alone; the moment before
  the address arrives shows the lead alone.

## Steps (each lands green on its own)

1. **Signal.** `EMAIL_UNCONFIRMED` + `isUnconfirmedRefusal` in
   `lib/auth-signal.ts`, and `EmailUnconfirmedError` in `auth/auth-error.ts`.
   _Test:_ auth-signal unit tests. _Done:_ `src/lib` stays at 100%.
2. **Gate.** `confirmedUserId` in `terms-gate.ts` (one batch) and
   `verifiedUserId` in `require-user.ts`; the batchable confirmation read in
   `account`. _Test:_ `test/auth/verification-gate.test.ts` (worker): no
   session, leaving, behind on terms (terms wins over unconfirmed),
   unconfirmed, confirmed, no user row. _Done:_ auth at 100%; no caller yet.
3. **Architecture test.** `verification-class.test.ts` with all 121 + 10
   rows, set to **today's** truth so it lands green. _Done:_ adding a scratch
   `createServerFn` fails it (shown, then reverted).
4. **Client.** `classifyFailure` gains the `unconfirmed` kind; add
   `ui/unconfirmed-refusal.tsx`; the root answer opens `ConfirmEmailSheet`
   with the control's trigger. _Test:_ `use-form-submit.dom.test.tsx` (no
   band, answer called with the trigger) and the answer's own dom test.
5. **Fold the three checks in.** Useful, report and email change move to
   `verifiedUserId`. Delete their `isVerified` calls, `unverified` variants
   and component branches (`useful-reaction.ts`, `ReportSheet`,
   `ChangeEmail`). Their table rows flip to V. _Test:_ the feed demo's
   unconfirmed beats still pass (behaviour unchanged, so no re-record).
6. **Follow → V** (Q3). Table row flips.
7. **Products** (Q1). Clamp in `closet/service.ts` (`withResolvedProduct`,
   `nameItem`): an unconfirmed runner's garment saves its typed brand and
   name with no shared rows. Delete `resolveProductFn`. _Test:_
   `test/closet/`: unconfirmed creates no `brands`/`products` rows,
   confirmed does.
8. **Desk → `requireAdmin(await verifiedUserId())`** (Q5). Table rows flip.
9. **F1:** `namingSuggestionsQuery` requires a session.
10. **Q2 read-side clamp** (if approved): search and H skip unconfirmed
    runners. _Test:_ `test/feed/search`, `profiles`.
11. **D-row** in `docs/decisions.md` (the rule, the extension in Q8, the
    classes), and a `CLAUDE.md` "one gate per concern" line.

**Cost.** Steps 1, 2 and 7 add about 30 mutants in `lib`, `auth` and
`closet`, each killed by the tests named. Step 5 deletes more than it adds.
The architecture test is text, so it adds no mutants. **The known
coarseness:** steps 5, 6, 8 and 9 edit `functions.ts` files, which the push
analyzer mutates. None of those mutants can be killed (CLAUDE.md: about 65
for `runs` alone). The PR will say so; nothing gets weakened to pass.

## As built

**The gate.** `confirmedUserId` (`auth/terms-gate.ts`) reads the
confirmation (`account`'s `emailConfirmationRead`) as a third seek in the
terms gate's batch; `verifiedUserId` is its glue. Useful, report and email
change lost their module-level `isVerified` checks and `unverified`
variants, and `fileReport` its `{ isVerified }` argument.

**The wire (found building it).** TanStack Start serializes a thrown
`Error` with its `message` alone (router-core's `ShallowErrorPlugin`), so
no refusal's `code` ever reached the client: `AUTH_REQUIRED` and D-96's
`TERMS_NOT_ACCEPTED` read as "Our end failed" in the browser, and only the
DOM tests, which throw the code directly, saw them work. `src/start.ts`
(new; the framework reads `startInstance` from it) registers `lib`'s
`signalAdapter`, which carries `{ code, message }` for exactly the three
signals and leaves every other error to the framework. The feed demo's
refusal beats are what caught it. This fixes the session and terms
answers too.

**The client.** `ui/unconfirmed-refusal.tsx` renders nothing until the
first refusal, then the sheet `account`'s `confirmEmailOnRefusal` draws,
which fetches the address with `ownAccountQuery` on its first opening. The
per-screen `ControlGate`/`ControlGuard`/`useControlGate` plumbing and
`confirmEmailGate` are deleted; `ChangeEmail` lost its own sheet and its
client pre-check.

**Q1, link on confirm.** The clamp is in `closet`
(`withResolvedProduct`, `nameItem`), so no `closet/functions.ts` or
`nameGarmentFn` edit. `confirmEmail`'s verify branch batches the
confirmation with an outbox row, `product_link` `{ userId }` (one per
runner). A spent reset link also confirms an address (D-63), so
`onPasswordReset` owes the same row, by `INSERT … SELECT … WHERE` the
account is still unconfirmed, ahead of its update in one batch. The link
is `closet`'s `linkTypedGarments`: for each of the runner's rows with a
typed brand and no product, the same `productLinkFor` a save uses
(find-or-create on the normalized pair, enrichment, type inheritance). A
row whose name is still the tap list's (`isTapListPlaceholder`) is a
brand-only answer: it joins the shared brands and links no product, as
`nameItem` does for a confirmed runner. It is re-runnable and idempotent
(law 1), reads only unlinked rows, and does nothing for a runner still
unconfirmed. `ops` cannot import `closet` (it imports `ops`), so there is
no fast path: `src/server.ts` hands the linker to `handleScheduled`
(`DailyUpkeep.linkProducts`), the `:00` firing drains `product_link` as a
scheduled kind, and the digest's full drain does too. A newly confirmed
runner's garments link within about 75 minutes (15 minutes' grace, then
the next `:00`); a failure leaves the row owed and never touches the
confirmation (law 5). One known gap: an unconfirmed runner who edits a
tap-list row in the closet form to a brand and a name that is still the
tap list's is linked as brand-only; their next save after confirming
links it.

**O3.** `namedResult` reads an unconfirmed runner's named model as named
(`Matched`) though no product is linked yet: their own row is unaffected
(Q4's "a runner's own history"), and the offer list uses the same answer,
so the row leaves it.

**Q2.** `account`'s `runnerConfirmed(column)` is the fact as a `WHERE`
clause, and `feed`'s runner-visibility floor carries it, so search, H and
the `/feed/u/$userId` redirect agree.

**`functions.ts` edits (the owner's acceptance needed).** The push
analyzer mutates a changed `functions.ts` whole and none of its mutants
can be killed (CLAUDE.md, D-41). Six files change, each edit glue:
`account` (email change and six Desk functions to `verifiedUserId`),
`feed` (Useful, follow, two Desk), `safety` (report, eight Desk; drops
`{ isVerified }`), `ops` (one Desk), `onboarding` (`namingSuggestionsQuery`
gains `requireUserId`), `products` (`resolveProductFn` deleted). The Desk,
F1 and the deletion cannot be done anywhere else, so the other edits ride
in files that change regardless. `src/start.ts` is the same class of
file: framework glue no test can import, holding no decision
(`signalAdapter` is tested in `lib`).

## Decisions (owner, 2026-10-04)

All nine questions are decided; D-113 records the rule and the answers.

- **The rule (Q8):** writes that others can see, **or that trust the
  address**, require a confirmed email. Email change is verified on the
  second half.
- **Q1 Products: clamp, then link on confirm.** An unconfirmed runner's
  garment saves with its typed brand and name and no `product_id`, so no
  shared `brands` or `products` row is created. When the runner confirms, a
  one-time link job runs the existing normalized find-or-create
  (`brands_normalized`, `products_brand_name`) for each of their unlinked
  garments and fills `product_id`. It hangs off the confirm path
  (`account/verification.ts` `confirmEmail`), is re-runnable and idempotent
  (laws 1 and 2), and its failure never fails the confirmation (law 5).
  Covers `closet/createItemFn`, `closet/updateItemFn` and
  `onboarding/nameGarmentFn`. The dead `products/resolveProductFn` is
  deleted.
- **Q2 Handles: U**, as recommended, with the read-side clamp (step 10):
  unconfirmed runners are hidden from search and from H.
- **Q3 Follow: V; unfollow U.**
- **Q4 Private entry, verdict, caption, photo: U**, with D-50's clamp kept.
  **Anything other runners see, or that combines runners** (the feeds, the
  conditions consensus, "worn by N", the Call's band recommendations from
  others) **reads only confirmed accounts' shared entries.** That holds
  today through D-50's clamp: an unconfirmed runner's entries save
  `private`, and every one of those reads is audience-only. Published
  anonymous totals already require confirmed accounts (D-108 C). A runner's
  own history is unaffected.
- **Q5 Desk: Ad = verified**, `requireAdmin(await verifiedUserId())`.
- **Q6 Export and account deletion: U** (D-95).
- **Q7 Block: U; report stays V.**
- **Q9 Mechanism: one `verifiedUserId()` gate plus the classification
  table** in the architecture test, listing every function and route with
  its class and failing both ways. The server is the authority. The client
  handles `EMAIL_UNCONFIRMED` with one root-level handler that opens the
  existing `ConfirmEmailSheet`, and forms reach it through `useFormSubmit`
  (no band: nothing failed, nothing saved, as #139's refusal path). Client
  pre-checks are UX only and never relied on.
- **F1:** `onboarding/namingSuggestionsQuery` requires a session (D-58).
