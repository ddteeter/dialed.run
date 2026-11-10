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
  public kits, OG cards, the conditions consensus and "worn by N". The
  coordinator released that file to this lane for the clause.

**One write gate.** `confirmedUserId` (`auth/terms-gate.ts`, behind
`verifiedUserId`) refuses a system account with its own
`SystemAccountError` (`SYSTEM_ACCOUNT`), after the address check, in the
batch it already sends (`auth/system-account.ts`'s one seek). The auth
refusals now share a `CodedError` base, which the new class would
otherwise have cloned. So Follow, Useful, Report, product corrections, email
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
   two floors and the write gate, and there only as a read of the column.
2. Default-deny: every production file that imports `userProfiles`,
   `outfitEntries`, `follows` or `reactions` from the core schema has a
   row: `floor` (it must call one), `own`, `actor` (names a runner only as
   one who did something `verifiedUserId` gated), `operator` or
   `machinery`. A new file fails until someone says which, and a row for a
   file that no longer reads one fails too. 65 rows.

**What it may do:** sign in, onboard, keep its closet, read its own pages.
Nothing that another runner can see. `attachKitAction` stays open, but the
entry gate hides what it writes, and the deploy steps say it never logs a
run.

**Lifecycle (owner deploy steps, `deployment-plan.md` + `deployment.md` §9 +
a Needs-owner issue):** invite code → sign up → O0 handle `smoke_test`
(this creates the profile row; nothing does at sign-up) → **set
`system_account = 1` before confirming the address** (unconfirmed is
already invisible, so no moment is findable) → confirm → default audience
Private, public profile off, "count in totals" off → add `Smoke test shirt`
with no brand → secrets in the `production` environment. Removal: Settings ›
Delete account, the normal purge. Rotation: open question 4.

## Contract touches

- Schema changes needed: **`user_profiles.system_account`, additive**, so
  per the protocol it may proceed, but the brief makes it a stop point.
- New route files: none. New bindings/queues/crons: **none**.
- `ci.yml`: the gradual-deploy job exactly as `docs/ops/gradual-deploy.md`
  drafts it (owner, 2026-11-09). **When** is open: merged before the first
  deploy, CI's first `versions upload` would fail (Cloudflare: a new
  Worker's first upload must be `wrangler deploy`). Asked of the
  coordinator; the recommendation is a separate PR the owner merges after
  the first deploy and the smoke account exist.
- Files other lanes own: `src/modules/safety/visibility.ts` (one clause,
  w5-mutation). Also touched: `feed/runner-visibility.ts`,
  `auth/terms-gate.ts`, `docs/contracts.md` (the column).

## Test plan

- worker (`test/safety/system-account.test.ts`): search, H and the open-web
  profile miss it and still find an ordinary runner; its PUBLIC kit leaves
  the feed, kit detail, the consensus count and the open web, and stays
  readable by the account itself; `confirmedUserId` refuses it (after the
  address) and `confirmedViewerId` is nobody for it.
- architecture: the two checks above.
- e2e edge case `e2e/feed/system-account.spec.ts`, beside
  `feed.journey.spec.ts`: a second runner searches for it, opens H by
  handle ("This runner isn't here.") and by id (back to the feed), and a
  signed-out visitor gets `/@handle`'s 404. A real server and browser
  render those pages; a dom test can't reach them.
  Seeded via the existing e2e seed helpers, with the flag set by SQL as the
  owner will.

## Issues

- Closes: #533 (the code half). Opens: a Needs-owner issue for creating
  the account, setting the flag, the secrets and rotation.

## Open questions

1. **Schema:** approved (owner, 2026-11-10, on #533). The env-list
   alternative was declined.
2. **Invite code:** the owner issues one from the Desk to the smoke address
   (recommended).
3. **Mailbox:** a plus-address on a domain the owner controls (recommended).
4. **Rotation:** the owner, yearly or on any suspected leak, through
   Settings › Password and then the `SMOKE_PASSWORD` secret (recommended).
5. **Handle "taken":** accept that O0 says `smoke_test` is taken
   (recommended), or pick a less guessable handle.
