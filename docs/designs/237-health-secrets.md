# Design: 237 health-secrets

## Problem

`/api/health` names three missing values and nothing else in
`docs/launch/deployment-plan.md` §2. Several values degrade without any error
when unset (`TAKEDOWN_SECRET`, `CLOSED_ADDRESS_SECRET`), so a missed deploy
step goes unnoticed (#824). Separately, `invites.ts` miscounts its code space
(#815).

## Approach

- **One list**, `src/modules/ops/deployment-config.ts`: each §2 row's names
  (vars and secrets both: an unset `STRAVA_SUBSCRIPTION_ID` is just as silent),
  with its kind and the plan's "required" level. The file is pure, with no
  `env` import, so a node test can load it. The three values `/api/health`
  already fails on carry `failsHealth`, so `ok` keeps its meaning and CI and
  dev stay healthy without production keys.
- **Health** (`health.ts`): the report gains `config`, every name mapped to
  `set` or `missing`, never a value. `missing` is derived from the list's
  `failsHealth` entries instead of a second copy.
- **Who sees it** (owner, 2026-11-17): only the status code has to be
  public. `healthResponse(viewerId)` answers `{ ok, version, at }` with 200 or
  503 to anyone. An operator (`isOperator`, the Desk's question) also gets
  `checks`, `missing`, `staleCrons` and `config`. The route asks
  `optionalVerifiedUserId`, as `/desk/review-photo/$` does. The uptime
  monitor reads only the status, and the smoke test reads `ok` and
  `version`, so neither one changes.
- **Digest**: a new `config` kind names each missing value whose level is
  yes, strongly, before friends or before public (owner, 2026-11-17).
  Optional, owner-only and for-Strava values show only in the operator
  health report, so they don't raise a Sentry issue every day.
- **Plan §2** writes every name in full (`STRAVA_CLIENT_SECRET`, not
  `_SECRET`), so a markdown parser reads the names without string surgery.
  `.dev.vars.example` names every §2 value, commented out where it is
  optional locally.
- **#815**: the comment says 32^8. fallow then reports invites.ts:316
  against photo-matches.ts:390. Measured, they are two drizzle reads with
  different tables, joins, filters and order, the same rhyme as the four
  already granted in invites.ts. The fix is a fifth identical comment, and
  the owner approved raising that grant's count from 4 to 5 (2026-11-17).

- **Round 60's refusals** (#820 items 1–2, #837), added to the lane
  2026-11-17. The rule is that a refusal a retry can't fix drops Try
  again. It is built as one seam: `useControlAction` marks a
  `ControlRefusal` as refused, `ControlFailureBand` leaves out Try again
  for it, and `ConfirmSheet`'s other button reads Close. Per surface:
  the handle cap moves from the field to a NOT CHANGED band above Save,
  naming the day (`claimUsername`'s `too_often` carries it, read in the
  same query as the cap from one counted-renames predicate). Resend's
  limit band loses Try again. The report sheet's gone item offers Close
  only. The terms return line reads the root's hydration stamp at
  mount, so it is in the first render or never. The photo lines already
  had no Try again; tests pin that.

## Contract touches

- Schema changes: **none**. New bindings, queues or crons: **none** (no new
  secret).
- Routes: `src/routes/api/health.ts` changes its gate and gets a
  verification-class row `verified-viewer`.
- `/api/health` body for a non-operator shrinks to `{ ok, version, at }`.
- Screens: the delete sheets, Settings › Username and O0, Resend, the
  report sheet and the terms prompt, as `docs/design-deltas.md`'s "Built
  from Round 60's refusal rulings" says.

## Test plan

- vitest node `test/ops/deployment-config.node.test.ts`: the list equals
  §2's names, read with `mdast-util-from-markdown` and GFM tables, both ways,
  with kind and level matched per row. Every listed name appears in
  `.dev.vars.example`, active or commented (`node:util` `parseEnv`), and
  every active name there is listed or is a local-only name.
- vitest worker `test/ops/health.test.ts`: `config` says `set` or `missing`
  and never a value. A stranger gets exactly `{ ok, version, at }`, an
  operator gets everything, and the status follows `ok` for both.
- vitest worker `test/ops/scheduled.test.ts`: the `config` digest line
  names a missing before-friends value and leaves out a missing optional
  one.
- `e2e/smoke/production.smoke.ts`: asserts `{ ok: true }` (it now reads
  as a stranger).

## Issues

- Closes: #824, #815, #820, #837.
- Opens: none yet.

## Open questions

- Guess: vars are in the list alongside secrets (#824 says "secret").
  They are cheap to include and just as silent when unset.
