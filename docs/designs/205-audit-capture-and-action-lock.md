# Design: 205 Styling-audit capture tooling, and the workflow lockfile

## Problem

The 2026-11-11 styling audit captured every screen state the e2e suite
reaches, at phone and desk width, light and dark, plus dense seeded data
and the states the suite misses. That tooling was never committed, so the
lanes fixing its findings can't re-capture to confirm them. Separately,
D-182 moves the workflows from SHA pins to version tags plus GitHub's
`actions.lock` (#601).

## Approach

**Capture (off unless `AUDIT_SHOTS` names an output folder).**

- `e2e/support/a11y.ts` calls `auditShot()` after each a11y check. It's a
  no-op unless the variable is set, so normal runs and CI are unchanged.
- `e2e/support/audit-shot.ts` is the Playwright side: collect the page's
  state in the browser, then shoot each width × scheme.
- The decisions are in `e2e/audit/shot-plan.ts`, which is pure: the route
  key, the state hash, the per-route cap, the slug and the `index.jsonl`
  row, read back through zod.
- An `audit` Playwright project matches `e2e/audit/**/*.audit.spec.ts` only
  when `AUDIT_SHOTS` is set. The `e2e` and `demo` projects ignore
  `audit/**`, so CI never runs them.

**Seeded data.**

- Fictional runners, garments and notes are JSON fixtures in
  `e2e/audit/data/`, parsed with zod on import.
- `e2e/audit/dense-seed.ts` turns them into rows. It's pure and
  deterministic: a fixed PRNG and an injected `now`. Every garment goes
  through `garmentSchema`.
- `e2e/audit/seed-db.ts` writes the rows to local D1 and R2 (glue).
- Photos are synthetic gradients drawn on a canvas in the browser at seed
  time. No binary is committed and nothing is real.
- Specs: `dense.audit.spec.ts` (dense data on every screen),
  `gaps.audit.spec.ts` (states the suite doesn't reach), and
  `legal.audit.spec.ts`.

**Skill** `.claude/skills/styling-audit/`: how to run a capture (thin,
dense, gaps), what a capture artifact is and isn't, and how to write a
finding (ID, class, evidence path, board compared, origin, what was
grepped).

**Mutation ratchet.** No positive glob in `stryker.conf.json` has ever
covered `e2e/`. guardrails-core 0.14.2 only warns
(`stryker-out-of-scope`) on a touched file outside the positives, so the
`//e2e` comment there is stale. That comment gets fixed. One new entry
puts `shot-plan.ts` and `dense-seed.ts` under the ratchet at 100%. The
glue stays outside, the same split as `caption.ts` versus `demo.ts`
(coordinator-7 agreed, 2026-11-12).

**#601.**

- Every `uses:` is a full version tag.
- `gh actions-lock` wrote `.github/workflows/actions.lock`. Its commits are
  the old SHA pins, unchanged.
- The repository's SHA-pinning setting stays on. GitHub's docs say a
  lockfile satisfies it for the workflows listed.
- zizmor 1.32 reads the lock and has no findings.

## Contract touches

- Schema changes: **none**. Routes: **none**. Bindings/queues/crons: **none**.
- Shared tooling: `playwright.config.ts` (the audit project, and the
  ignores), `stryker.conf.json` (one entry, the comment).

## Test plan

- `test/e2e-support/shot-plan.test.ts` (vitest, worker):
  - route normalisation (ids, ULIDs, numbers, query keys sorted);
  - the hash is stable and order-free;
  - the cap, and the slug;
  - index rows round-trip, and a malformed row is refused.
- `test/e2e-support/dense-seed.test.ts` (vitest, worker):
  - the same seed gives the same rows, and a different `now` shifts only
    the times;
  - every garment parses through `garmentSchema`;
  - counts (40 garments, 60+ runs, 20 runners);
  - audiences cover `private` and `runners`;
  - no row names a real-looking email domain.
- `test/architecture/workflow-floor.test.ts`:
  - every `uses:` is a full tag;
  - each workflow's actions equal its `actions.lock` list;
  - every listed action has a commit.
- `init-drift.test.ts`: guardrails.yml uses full tags.
- The capture itself is checked by running it once, not by a spec in CI.

## Issues

- Closes: #601.
- Opens: none yet.

## Open questions

- Guess: the audit skill lives in `.claude/skills/styling-audit/`.
