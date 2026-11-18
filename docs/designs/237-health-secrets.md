# Design: 237 health-secrets

## Problem

`/api/health` names three missing values and nothing else in the
deployment plan's §2, and some values degrade without any error when unset,
so a missed deploy step goes unnoticed (#824). Also in this lane: a stale
comment (#815), and Round 60's refusal rulings (#820, #837).

## Approach

- **One list**, `src/modules/ops/deployment-config.ts`: every §2 name, vars
  included, with its kind and level. Pure, so a node test pins it to §2 and
  `.dev.vars.example`. `failsHealth` marks the three that always failed
  health, so `ok` keeps its meaning.
- **Health**: a `config` field maps every name to `set` or `missing`, never
  a value. Anyone gets `{ ok, version, at }` with 200 or 503. Only an
  operator (`isOperator`, asked through `optionalVerifiedUserId`) also gets
  the checks, `missing`, `staleCrons` and `config` (owner, 2026-11-17).
- **Digest**: a `config` kind names missing values marked yes, strongly,
  before friends or before public (owner, 2026-11-17). `SENTRY_DSN` is left
  out, because the digest travels by Sentry.
- **#815**: the comment says 32^8. Measured, the clone fallow then reports
  is a drizzle-grammar rhyme, settled with a fifth comment, and the owner
  raised the grant count from 4 to 5.
- **Round 60** (a refusal a retry can't fix drops Try again), as one seam:
  `useControlAction` marks a `ControlRefusal` as refused,
  `ControlFailureBand` leaves out Try again for it, and `ConfirmSheet`'s
  other button reads Close. The handle cap becomes a NOT CHANGED band above
  Save that names the day: `too_often` carries it, read with the cap from
  one counted-renames predicate. Resend's limit and the report refusals
  lose Try again, and a gone report subject offers Close only. The terms
  line reads the root's hydration stamp at mount, so it is in the first
  render or never.

## Contract touches

- Schema, bindings, queues, crons: **none**.
- `routes/api/health.ts` is now `verified-viewer`. A stranger's body
  shrinks to `{ ok, version, at }`.
- Screens: those in `docs/design-deltas.md`'s "Built from Round 60's
  refusal rulings".

## Test plan

- node `test/ops/deployment-config.node.test.ts`: the list against §2 (mdast)
  and `.dev.vars.example` (`parseEnv`), both ways.
- worker `test/ops/health.test.ts`: set or missing, never a value; the
  stranger's and the operator's answers; the digest's lines. Also
  `scheduled.test.ts` (the `config` kind), `username.test.ts` (the day) and
  `test/ui/was-hydrated.test.ts`.
- ui: `confirm-sheet`, `handle-form`, `account-pages` (Resend),
  `report-sheet`, `use-saved-page`, and the two photo lines.

## Issues

- Closes: #824, #815, #820, #837.

## Open questions

- Guess: vars sit in the list beside secrets (#824 says "secret").
