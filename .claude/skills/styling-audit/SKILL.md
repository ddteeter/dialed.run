---
name: styling-audit
description: Use when running a visual styling audit of dialed.run, or re-capturing screens to confirm a styling finding before fixing it. Covers turning the screenshot hook on (AUDIT_SHOTS), the three captures (the suite, dense seeded data, the states the suite misses), what is a capture artifact rather than a finding, and the finding format.
---

# Styling audit

The capture is committed tooling (design 205). Each capture is a folder of
screenshots plus an `index.jsonl`, and it is never committed. The findings
are written from it.

## How a capture works

`e2e/support/a11y.ts` checks the page after every action an e2e spec takes.
When `AUDIT_SHOTS` names a folder, `e2e/support/audit-shot.ts` runs after
each check. If the screen state is new, it shoots it four times (phone 390
and desk 1280, light and dark) into `<AUDIT_SHOTS>/<route>/NN-<size>-<scheme>.png`.
It also appends a line to `<AUDIT_SHOTS>/index.jsonl` naming the test that
reached the state.

What counts as "new" (route, query keys, visible structure and ARIA states)
and the limits (16 states per route; `AUDIT_MAX_HEIGHT`, default 9000px)
are in `e2e/audit/shot-plan.ts`. A re-run into the same folder adds only
states it has not shot yet. Without the variable the hook does nothing, and
CI never sets it.

## Running one

Put the shots outside the repo, in your scratchpad. They hold only seeded
data, but they are a record, not code.

Start from a fresh local D1:

1. Move `.wrangler/state` aside.
2. Run `npm run db:migrate:local:core`, `:weather` and `:ops`.
3. Put CI's placeholder `STRAVA_*` and `GARMIN_*` values in `.dev.vars`,
   or the Strava and Garmin screens fail before they can be shot.
4. Use a free `DIALED_E2E_PORT`, with a matching `BETTER_AUTH_URL`, since
   other worktrees run e2e too.

```sh
OUT=<scratchpad>/shots

# 1. Thin: every state the suite itself reaches.
AUDIT_SHOTS=$OUT npx playwright test --project e2e --project demo

# 2. Dense: 40 garments, 60+ runs, 20 runners, a full Desk (e2e/audit/dense-seed.ts).
AUDIT_SHOTS=$OUT-dense npx playwright test e2e/audit/dense.audit.spec.ts --project audit

# 3. Gaps and legal: states the suite does not reach, and the policies.
AUDIT_SHOTS=$OUT-gaps npx playwright test e2e/audit/gaps.audit.spec.ts e2e/audit/legal.audit.spec.ts --project audit
```

How the runs fit together:

- The `audit` project exists only while `AUDIT_SHOTS` is set.
- Its specs run in order: test `00` seeds the data, then the later tests
  read it back.
- A move the spec could not make doesn't fail the run. It is recorded as an
  `audit` annotation in the Playwright report. Read those afterwards, since
  each one is a state the capture is missing.
- All the data is fictional. Photos are gradients drawn at seed time, so
  nothing in a shot is real.

To confirm a single finding, run only the spec that reaches its screen,
into a new folder, and compare that shot with the finding's evidence.

## What is not a finding

- **Height.** The viewport was grown to the page's height, so a fixed tab
  bar sits at the very bottom of the shot, and a `100vh` element can look
  stretched. Check the code before reporting it.
- **Timing.** States are shot mid-test. A half-filled form or a focused
  field is expected.
- **The data.** Odd handles, repeated rows and gradient photos are seeded.
  Report how the layout handles them (truncation, overflow, wrapping), not
  the data itself.
- **Capture marks.** Pink rings are the test's pointer marker. Animations
  are fast-forwarded. Dark means emulated `prefers-color-scheme: dark`.
- **Gaps.** A missing state is not a finding. The capture only reaches what
  its specs reach.
- **The Desk** is dark in both themes, so judge it once.

## Reviewing

For each screen:

1. **Look at the shots.** For each state, look at phone and desk in light.
   For dark, look at least once per distinct layout, and wherever light
   showed something colour-related.
2. **Compare with the boards.** Find the screen's boards in `design/*.dc.html`
   (`docs/product.md` §Screen inventory maps routes to screen IDs). A later
   round's rulings supersede an earlier board. Compare composition only:
   what is there, order, hierarchy, alignment, copy. Never compare
   measurements; values come from the contracts (`.claude/rules/ui.md`).
3. **Look for what is simply off.** Things like:
   - unequal gutters, or edges that don't line up;
   - clipped text or bad wrapping;
   - controls of different heights side by side;
   - a phone layout stretched across a desk;
   - something invisible in dark;
   - the same component looking different on two screens.
4. **Trace it to code** (file and line), then check it isn't already
   ruled. Grep `docs/design-deltas.md` (grep it, don't read it whole), then
   `docs/decisions.md`, then the comment at the site. A difference that's
   recorded as deliberate is not a finding.
5. **Classify it.** `IMPL` means the design is clear (a board, a contract, a
   ruling, or the same component elsewhere) and the build is wrong.
   `DESIGN` means it needs a decision. When unsure, `DESIGN`.

Prefer one cross-cutting finding that lists every screen it affects over
the same finding repeated per screen. Ten real findings beat forty
nitpicks. Still report what looks plainly odd even with no board to cite.

## Finding format

```
### <AREA>-NN · <short title>
- class: IMPL | DESIGN
- severity: high | medium | low
- confidence: high | medium | low
- where: <route(s) / screen ID(s)>; <phone|desk|both>; <light|dark|both>
- evidence: <shot path(s) inside the capture folder, and where to look>
- board: <the board compared, or "none (undesigned)">
- what is wrong: <2–5 concrete sentences: what you see, what you expected, why>
- origin: <file:line and the mechanism, or "unknown — not traced">
- already recorded?: <what you grepped and what you found>
```

Findings become GitHub issues (`docs/agents/issue-tracker.md`): IMPL as
build items, DESIGN as design asks.

An issue quotes the finding and names the capture's commit. It never
attaches the capture folder.

Screenshots of seeded data are approved for the public repo
(`.claude/rules/publishing.md`, Seeded media), so a cropped shot can be
attached to an issue.
