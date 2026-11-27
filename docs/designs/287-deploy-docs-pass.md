# Design: 287 the deploy docs pass

> Wave 20, lane 18d, PR 1. Docs, with two small code edits that go to the
> coordinator first. PR 2 (the guardrails-core 0.19.1 pin) is separate.

## Problem

The first deploy reads `docs/deployment.md` (the runbook) and
`docs/launch/deployment-plan.md` (the plan). A sweep on 2026-11-27 (#1173)
found nine steps they lack or get wrong. Three of them would stop the
deploy. #1155 adds two first-deploy checks from #902. §1 of the plan still
calls #530 pending, and a fragment under `docs/launch/deployment-plan/` is
still waiting to be folded in.

## Approach

Each blocker was traced to find which side is right.

| item                     | right side                         | fix                                                                                                                                                       |
| ------------------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| owner-seed invite code   | the code (`access.ts`, design 225) | stage 0: eight characters from `INVITE_ALPHABET`, inserted as `DIAL-XXXX-XXXX`                                                                            |
| `STRAVA_SUBSCRIPTION_ID` | neither (var with no home)         | recommended: a secret, set after §6's call; `deployment-config.ts` moves it from `var` to `secret`, plan §2 and runbook §5/§6 follow (coordinator: ask A) |
| placeholder D1 ids       | the runbook                        | recommended: the bindings test asserts a UUID-shaped id instead of the placeholder (coordinator: ask B)                                                   |

The rest are docs:

- **Inbound mail (D-62).** Email Routing on `dialed.run`, a catch-all to the
  owner's verified address, and a check of `hello@`, `desk@` and
  `copyright@`. Cloudflare's docs put Routing's records on the apex and
  Sending's on `cf-bounce.`, managed separately.
- **Photo cache.** Cloudflare caches by file extension only, and photo keys
  have none. Runbook §2 step 6 becomes a Cache Rule on `photos.dialed.run`
  (Eligible for cache, TTLs from the origin's `Cache-Control`), with a
  first-deploy check that a photo answers `HIT`. Without the rule, the CSAM
  tool scans nothing (D-153). `lib/public-photos.ts`'s comment follows
  (coordinator: ask C).
- **Checks and lines promised elsewhere:** one Garmin import on the deployed
  Worker (#275); D1's per-region read metrics during friends (design 143);
  `wrangler d1 insights` in the runbook (design 182); #1155's stored log
  line and the thrown send error's `code`.
- **The by-hand export** (#1033): recommended as a new issue for a script
  that runs the real export against remote bindings, with the plan pointing
  at it (coordinator: ask D).
- **#530's row** in plan §1: answered yes, 2026-11-09.
- **The fold:** every file in `docs/launch/deployment-plan/` except its
  README moves into the plan under its heading, in one commit.
  `test/ops/deployment-config.node.test.ts` passes before and after.

## Contract touches

- Schema changes: **none**
- New route files: **none**
- New bindings/queues/crons: **none** (the subscription id becomes a
  secret, not a binding; `wrangler.jsonc` is not touched)
- Screens: none

## Test plan

- `test/ops/deployment-config.node.test.ts` (node): passes before and after
  the fold, and after §2's row changes kind.
- If ask B is approved, `test/bindings-conformance.test.ts` (worker):
  `dialed-ops`' id is a UUID, and its binding, name and migrations
  directory stay pinned.
- Full `npm test` on the final head.

## Issues

- Closes: #1173, #1155
- Opens: #1180 (the by-hand export script, and how the copy reaches the
  runner: an owner question)

## Open questions

None open. The coordinator answered asks A–D on 2026-11-27: A, the
subscription id is a secret, owner-approved (D-208); B, the test pins the
id's shape; C, the comment follows the Cache Rule; D, #1180.
