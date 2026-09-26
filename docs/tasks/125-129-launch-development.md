# Tasks 125–129 — Launch development (five parallel lanes)

The production-readiness audit
(`docs/reconciliation/2026-09-25-production-readiness-audit.md`) found what
stands between the app and its first user who is not the owner. The owner
split the answer in two (decision D-37): **development**, which these five
lanes build, and **deployment**, a later sweep of dashboards, accounts and
legal steps that no lane touches. The two plans are
`docs/launch/development-plan.md` and `docs/launch/deployment-plan.md`.
Every item in your packet has an id (OPS-n, ACC-n, …) from the development
plan, and a stage marker: **[F]** before friends, **[P]** before public.
Finish your [F] items first.

| task | lane             | packet                  | starts                        |
| ---- | ---------------- | ----------------------- | ----------------------------- |
| 125  | Ops & platform   | `125-ops-platform.md`   | now (OPS-4 waits for PR #104) |
| 126  | Accounts         | `126-accounts.md`       | after PR #104 merges          |
| 127  | Strava & logging | `127-strava-logging.md` | now                           |
| 128  | Content & safety | `128-content-safety.md` | now                           |
| 129  | Feed             | `129-feed.md`           | after PR #102 merges          |

**Numbering.** A bare `D-N` is a row in `docs/deferred.md`; a decision-log
row is always written "decision D-NN". The two registers share a prefix.

## Read first

1. `CLAUDE.md`, then this file, then your packet.
2. The audit sections your packet cites. They carry the evidence (file and
   line) and the sources; the packets do not repeat them.
3. `docs/decisions.md` D-35 and D-37 to D-47.
4. `docs/architecture.md` and `docs/contracts.md`, as always.

## Ownership

Every path belongs to exactly one lane. Your packet lists yours in full;
this is the map, so you can see whose a file is before you need it.

| lane | owns (summary — the packet is authoritative)                                                                                                                                                                                                                                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 125  | `modules/ops`, `modules/weather`, `src/server.ts`, `src/env`, `routes/api/health.ts`, `routes/__root.tsx`, `routes/legal/**`, `routes/desk/route.tsx` + `desk/index.tsx`, new `ui/Turnstile.tsx`, `public/` (except `mediapipe/`, `fonts/` and 127's `strava/`), `modules/auth/instance.ts`, `docs/deployment.md`, `docs/architecture.md`                        |
| 126  | `modules/auth` (except `instance.ts`), `routes/auth/**`, `routes/index.tsx`, new `modules/email`, new `modules/account`, `routes/account/**`, `routes/onboarding/settings/**`, `routes/onboarding/name.tsx`, `modules/onboarding/naming.ts` and the settings components, `routes/desk/invites*` + `desk/requests*`                                               |
| 127  | `modules/runs/**` (except `delete-run.ts`), `routes/runs/**` (except the delete wiring), `routes/api/strava.ts`, `public/strava/`, and 121's feed files (`AttachKit`, `VerdictForm`, `VerdictChips`, `SpecificsSheet`, `NotedReceipt`, `BandHistory`, `chips.ts`, `band-signals.ts`, `routes/feed/attach.$runId.tsx`, `routes/feed/verdict.$entryId.tsx`)        |
| 128  | `modules/safety/**`, `routes/safety/**`, `modules/feed/photos.ts`, `routes/feed/photo.$.tsx`, `modules/closet/photos.ts`, `routes/closet/photo.$itemId.$size.ts`, `lib/photo-pipeline.ts`, `lib/photo-constraints.ts`, new `modules/feed/retract.ts` + its components, new `modules/runs/delete-run.ts` + its component, `routes/desk/review*` + `desk/runners*` |
| 129  | `modules/feed/**` and `routes/feed/**` except the files above, `modules/notifications/**`, `routes/notifications/**`, `modules/onboarding/profile.ts` + the place/calibration files                                                                                                                                                                              |

The rest of `modules/onboarding`, `modules/closet`, `routes/closet`, `modules/products` and `modules/enrichment` has no owner in this sweep. Ask before touching any of it.

**Shared files, additions only.** These are touched by more than one lane.
Add; never reorder, reformat or remove another lane's lines:

- `src/modules/*/functions.ts` and `*/index.ts` of a module you add a file
  to (a new export, a new server function).
- `src/modules/ops/scheduled.ts` — 125 owns it; 126 (deletion purge) and
  127 (prune, revocation drain) add a call to the daily firing.
- `src/env/env.d.ts` — 125 owns it; any lane adds the type of a var or
  secret it reads.
- `test/bindings-conformance.test.ts` — 125 owns it; 126 adds `send_email`.
- `src/lib/contracts.ts`, `src/lib/nav-types.ts` (+ its test),
  `src/ui/index.ts`, `stryker.conf.json`'s route negations.
- `src/ui/SignedOutLayout.tsx` and the landing bar — 125 adds the legal
  links; nothing else changes in them.
- `src/modules/onboarding/functions.ts` — 126 (settings, naming) and 129
  (O1's resolver, the city writer).
- `src/modules/auth/create-auth.ts` — 126 owns it; 125 adds the `baseURL`,
  `rateLimit` and secure-cookie options (OPS-4).
- `src/routes/feed/entry.$entryId.tsx`, `src/routes/runs/$runId.tsx` — 128
  adds the delete wiring to each.
- `docs/architecture.md` — 125 owns it; a lane that changes a boundary adds
  its diagram change (CLAUDE.md workflow 6).
- `wrangler.jsonc` — **only** 126's `send_email` binding, which the owner
  authorised (decision D-42). Nothing else; every other config edit is the
  deployment sweep's.

**`src/ui/` has no owner in this sweep.** The task-120 primitives are not a
lane decision (`FileWell`, `useControlAction`, `ControlFailureBand`,
`FormFailureBand`, `PhotoStep`). If your screen needs something they cannot
do, stop and say so in your PR. A new component in `ui/` (125's Turnstile
widget, say) is fine; a change to an existing one is not.

## Cross-lane sequencing

Six seams, each with one direction:

1. **Usernames (126 · ACC-1) cross every lane.** It is the one sanctioned
   edit outside an owner's list: **rename-only** changes to every
   `display_name` reader (feed, safety, onboarding, tests, e2e), in one PR,
   merged as early as possible. From the day this file lands, **no lane
   adds a new `display_name` read**; read the name through the profile's
   label, which ACC-1 then repoints. It must merge **before the first
   production deploy** (decision D-41).
2. **Email (126 · ACC-2) is the only sender.** 125 (digest), 127
   (reminder, Strava revoked) and 128 (removal, ban) call its interface and
   never the binding. 126 publishes the interface in its design doc, first
   thing; the others build against it and land their email hookups after
   ACC-2 merges.
3. **The Desk shell (125 · OPS-7) comes first.** 126 (invites, requests,
   force-rename) and 128 (ban panel, takedown) add pages under it.
4. **Delete primitives (128 · SAF-3) come before account deletion (126 ·
   ACC-9)**, which calls them through their modules' `index.ts` rather than
   writing a second delete.
5. **Strava revoke (127 · STR-1/2) comes before account deletion**, which
   calls it.
6. **One visibility rule.** 128 extends safety's `publiclyVisibleEntry()`
   to hide banned authors, and 126 extends it for accounts pending deletion;
   129 applies the same predicate to search and profiles (FEED-7). Nobody
   writes a second one.

Put what you need from another lane in your PR body under **"Needs from
other lanes"**. Do not make the change yourself.

## Migrations

`test/migration-chain.test.ts` fails on a gap, so reserved number ranges do
not work here: a lane that reserved 0025–0029 and used two would leave a
gap. The rule is instead **generate last, renumber on collision**:

1. **Only the migrations listed below are yours to generate.** Anything else
   follows CLAUDE.md's protocol (additive: say so in the PR; destructive or
   contract-shaped: stop and ask).
2. **Main's last core migration is `0019_add_outbox`** (PR #101, merged
   2026-09-25), so the first lane to merge a migration takes `0020`.
3. Develop against your schema edit, and generate locally to test. **Before
   your merge-ready push**, `git fetch`, rebase on `origin/main`, delete your
   generated files and regenerate, so your number follows main's last. Look
   at the other four lanes' open PRs and say in yours which numbers they
   hold.
4. If another lane's migration merges first, **you renumber** (rename the
   `.sql` and its snapshot, rebuild `_journal.json`, relink `prevId`) and
   re-run the chain test. The owner merges migration PRs one at a time.

| lane | database | migration                              | kind                                                     |
| ---- | -------- | -------------------------------------- | -------------------------------------------------------- |
| 125  | core     | `add_auth_rate_limit`                  | additive (Better Auth's `rateLimit` table)               |
| 126  | core     | `replace_display_name_with_username`   | **destructive, authorised** (decision D-41) — ACC-1 only |
| 126  | core     | `add_invite_codes_and_access_requests` | additive                                                 |
| 126  | core     | `add_notification_preferences`         | additive                                                 |
| 126  | core     | `add_account_deletions`                | additive                                                 |
| 127  | core     | `add_strava_revocation_refresh_token`  | additive (if STR-2's design needs it)                    |
| 128  | core     | `add_moderation_actions`               | additive (takedown and quarantine audit)                 |

129 expects none. A lane that finds it needs one not listed asks first.

## Design placeholders

Most of what these lanes build has no drawing yet. The development plan's
**Design dependencies** section lists every ask, and the coordinator sends
them to the design agent as one prompt. **Do not wait for them.** Build to
CLAUDE.md's placeholder protocol: existing `ui/` primitives, tokens and
bracket-notation text only; no new glyph, colour, font or motion.

Where a drawing does exist, it is the truth for composition: Operator
Screens D0–D6 (the Desk, the ban panel, the banned notice, the digest
email), Auth Au1–Au7, Remaining Screens T1/U1/U2/S1, Round 25's rulings.

**Do not edit `docs/deferred.md` or `docs/design-deltas.md`.** Five lanes
editing those tables conflict on every merge. Put deferrals under
**"Register"** and undesigned surfaces under **"Design deltas"** in your PR
body; the coordinator folds them in at merge.

## Rules for running in parallel

- Stay in your ownership list. The exceptions are the shared files above,
  additions only, and ACC-1's renames.
- **Before your first push**, `git fetch origin && git branch -f main
origin/main`: a new branch's push gate diffs against local `main`.
- **One push at a time on this machine.** The push gate runs about 26
  minutes; check `ps aux | grep "gate --mode=push"` first.
- No new binding, queue or cron without asking, except 126's `send_email`.
  New work on a schedule rides an existing firing, as #101's outbox drain
  does.
- Small commits; each passes the commit gate.

## Done, for every lane

- Every item in your packet built, with the tests it names. Tests observe
  behaviour: a request refused, a row gone, an object absent from R2, a
  header present, an email handed to the binding with the right recipient.
- **Mutation stays at 100%** on every file you touched. A new module joins
  `stryker.conf.json`'s `mutate` array in the PR that finishes it (126's
  `email` and `account`).
- **Demos**: every item a user would see is in a feature demo, recorded and
  attached (`pr-demo-video` skill). Your packet names which demo to extend;
  find others by grepping `Covers:`.
- Where a drawing exists, a conformance spec (`e2e/conformance/`).
- `docs/architecture.md` updated in the same PR for any boundary, queue,
  cron or binding change.
- `npm run verify && npm test && npm run build` green; PR checks green.
- PR body: items → tests → demo; "Needs from other lanes"; "Register";
  "Design deltas"; any migration, with its number and kind.
