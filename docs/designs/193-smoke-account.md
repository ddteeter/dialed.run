# Design: 193 The smoke account, invisible to runners

## Problem

The gradual deploy (design 186) signs in as a production smoke account and
reads its closet. The owner requires that account to be **invisible to
runners** (#533, owner, 2026-11-09): no findable profile, no search result,
no counts. Today it would be an ordinary runner, `@smoke_test`, that anyone
can find. This lane marks it, hides it through the gates that already
decide who a runner can see, proves that with a test, and applies the
approved `ci.yml` job.

## Approach

**The mark.** A new column, `user_profiles.system_account` (integer boolean,
`NOT NULL DEFAULT 0`), in migration `0003_add_system_account` (law 11:
renumbered at rebase if another lands first). **No code writes it.** The
owner sets it with one `wrangler d1 execute` statement in the deploy steps,
so no endpoint, form or Desk action can set or clear it. An architecture
test enforces that.

**One read gate, already shared.** Every surface that shows a runner or
their entries to someone else already stands on one of two floors. Each
gains one clause:

- `runnerInStanding()` (`feed/runner-visibility.ts`) adds
  `system_account = 0`. Search, the runner page H (by id and by handle,
  with its redirect) and the open-web `/@handle` all read through it, so
  the account is "not found", the same as a handle that doesn't exist.
- `authorNotBanned()` (`safety/visibility.ts`) becomes "author banned or
  system". It sits under `publiclyVisibleEntry` and `worldVisibleEntry`, so
  any entry the account ever shared would be gone from feeds, kit detail,
  public kits, OG cards, the conditions consensus and "worn by N". That file
  belongs to w5-mutation, so the change is one line, sequenced through the
  coordinator.

**One write gate.** `confirmedUserId` (`auth/terms-gate.ts`, behind
`verifiedUserId`) refuses a system account, the same way it refuses an
unconfirmed one. So Follow, Useful, Report, product corrections, email
change and the Desk all refuse it, and the account can never ring another
runner's bell. Own-closet reads and writes stay `requireUserId`.

### Every surface, and why the account can't appear on it

| surface                                        | why not                                                                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `/@handle`, H, search                          | `runnerInStanding` clause                                                                                                  |
| feeds, kit detail, public kit, OG cards        | entry gate clause, and it never logs a run                                                                                 |
| consensus, "worn by N"                         | entry gate (both count only `publiclyVisibleEntry`); "count in totals" off                                                 |
| published totals (guide job, not built yet)    | no runs; "count in totals" off; the test below makes the job classify itself when it lands                                 |
| follower/following counts and lists, notices   | the write gate refuses Follow; nobody can follow a runner they can't find                                                  |
| Useful counts, notifications, emails to others | the write gate refuses Useful and Follow, which are the only things that notify another runner about this one              |
| shared products ("Smoke test shirt")           | the garment has **no brand**, so no shared product row is created (deploy step)                                            |
| handle taken (O0)                              | `smoke_test` reads "taken", like any handle. That shows a name is in use, not a profile. Accepted unless the owner objects |
| Desk lists, counts, invites, access, digest    | operators only. The owner sees the account there, deliberately                                                             |
| data export                                    | the account's own data only                                                                                                |

**The architecture test, so a new surface can't forget it**
(`test/architecture/system-account.test.ts`):

1. `system_account`/`systemAccount` is named only in `schema-core.ts`, the
   two floors and the write gate. No other file can read or write it.
2. Default-deny: every production file that names `userProfiles`,
   `outfitEntries`, `follows` or `reactions` has a row: `gated` (it must call
   a floor or `verifiedUserId`), `self` (only the viewer's own rows),
   `operator` (Desk/digest) or `writer`. A new file fails until someone
   says which. About 90 rows, like `verification-class`.

**What it may do:** sign in, onboard, keep its closet, read its own pages.
Nothing that another runner can see. `attachKitAction` stays open, but the
entry gate hides what it writes, and the deploy steps say it never logs a
run.

**Lifecycle (owner deploy steps, `deployment-plan.md` + `deployment.md` §9 +
a Needs-owner issue):** invite code → sign up → **set `system_account = 1`
before confirming the address** (unconfirmed is already invisible, so no
moment is findable) → confirm → O0 handle `smoke_test`, default audience
Private, public profile off, "count in totals" off → add `Smoke test shirt`
with no brand → secrets in the `production` environment. Removal: Settings ›
Delete account, the normal purge. Rotation: open question 3.

## Contract touches

- Schema changes needed: **`user_profiles.system_account`, additive**, so
  per the protocol it may proceed, but the brief makes it a stop point.
- New route files: none. New bindings/queues/crons: **none**.
- `ci.yml`: the gradual-deploy job exactly as `docs/ops/gradual-deploy.md`
  drafts it (owner, 2026-11-09).
- Files other lanes own: `src/modules/safety/visibility.ts` (one clause,
  w5-mutation). Also touched: `feed/runner-visibility.ts`,
  `auth/terms-gate.ts`, `docs/contracts.md` (the column).

## Test plan

- worker: `runnerInStanding`/search/H/`/@handle` miss a system account and
  still find an ordinary one (`test/feed/…`).
- worker: `publiclyVisibleEntry` and `worldVisibleEntry` drop its shared
  entry. The consensus tally doesn't count it.
- worker: `confirmedUserId` refuses it; `requireUserId` admits it.
- architecture: the two checks above.
- e2e edge case beside `e2e/feed/feed.journey.spec.ts`: a second runner
  searches `smoke`, opens `/@smoke_test` signed in and signed out, and gets
  nothing. A real browser shows the not-found page a dom test can't reach.
  Seeded via the existing e2e seed helpers, with the flag set by SQL as the
  owner will.

## Issues

- Closes: #533 (the code half). Opens: a Needs-owner issue for creating
  the account, setting the flag, the secrets and rotation.

## Open questions

1. **Schema:** approve `system_account` on `user_profiles` (recommended),
   versus an `ADMIN_USER_IDS`-style env list (a new var, so a binding stop,
   and invisible to SQL gates).
2. **Invite code:** the owner issues one from the Desk to the smoke address
   (recommended).
3. **Mailbox:** a plus-address on a domain the owner controls (recommended).
4. **Rotation:** the owner, yearly or on any suspected leak, through
   Settings › Password and then the `SMOKE_PASSWORD` secret (recommended).
5. **Handle "taken":** accept that O0 says `smoke_test` is taken
   (recommended), or pick a less guessable handle.
