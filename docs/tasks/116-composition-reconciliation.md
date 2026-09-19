# Task 116 — Composition reconciliation (sequential on main; adoption lane 5 of 5)

## Goal

Check every v1 screen against its artboard for **composition** — what the
screen contains, where it sits, the hierarchy, the copy, which states exist —
and reconcile the differences.

This is the half of "does the UI match the design" that lanes 112–115 do not
touch, and cannot.

## Why this lane exists

`CLAUDE.md` §Design truth splits the bundle in two:

- **Contracts are truth for values.** Type, tracking, spacing, radius, colour,
  motion, breakpoints. After 113–115 these are enforced by a lint rule and a
  pin test. **No human review needed, ever again.**
- **Artboards are truth for composition.** Nothing checks this. No lint rule
  can.

And composition is where the exposure actually is, because **rounds 6–8
changed composition on screens that were already built**, while the repo did
not have the drawings. `design/` sat at round 5 from 2026-09-08 to
2026-09-17; rounds 6, 7 and 8 were recorded in `docs/design-deltas.md` and
lanes implemented them from those prose summaries.

Six surfaces changed that way:

| section | what moved                                                                          |
| ------- | ----------------------------------------------------------------------------------- |
| §AA     | O3 recut to one flat 24-row list, ranked not filtered, nothing pre-ticked           |
| §AB     | coverage → ink density; verdict → three-slot position mark; `text-night/30` retired |
| §AC     | P2.5 rebuilt — inline naming, two fields, no link field, no gate                    |
| §AD     | W3's two web states, brackets-breathe instead of a spinner                          |
| §AE     | onboarding's column decision                                                        |
| §AF     | transient feedback — copy link, autosave                                            |

**One of these was spot-checked and was correct.** `src/ui/Marks.tsx` cites
§AB, ships the solid/hatch/hairline encoding and retires the opacity channel
with a comment. That is one component, verified by hand, once. There is no
reason to assume the other five are equally right and no mechanism that would
tell us.

## Why it is last

113–115 change how every screen looks. Reconciling composition first means
reviewing screens that are about to move, and 115 adds a second composition
per screen at width.

**If you want an earlier signal**, the §AA–§AF subset above is the
highest-risk ~8 screens and can be pulled forward as a smaller pass without
waiting. That is a scheduling call for the owner, not this lane's decision.

## You own

- Whatever you change to reconcile a screen — which crosses every lane's
  components and routes, so **this lane runs alone.**
- `e2e/support/` for the capture helper.
- `docs/design-deltas.md` — you will be adding items to it.

## Method

### Build the smallest thing that works

**Do not build a design-audit framework.** A kit for this was evaluated in
2026-09 and rejected for this repo; the reasoning is worth not repeating:

- **No pixel diffing.** The artboards carry 397 font sizes outside the
  seven-step scale. Diffing against them would report the contract's own
  deliberate corrections as defects, and "fixing" them would reintroduce
  exactly the drift 113 removes. **Values are settled. Do not measure them.**
- **No computed-style probes, no `data-ui` attributes, no manifest file.**
  Probes exist to compare values. See above.
- **No new capture pipeline.** Playwright is already configured with a
  per-worktree port, font-ready gating and fixtures.

What is genuinely needed is one idea from that kit: **the reviewer must not
be the session that wrote the code.**

### The three pieces

1. **The screen list already exists.** `docs/product.md` §Screen inventory
   maps every screen ID to its lane and says which are v1. Use it. Do not
   write a second inventory.
2. **The design side crops itself.** Every screen in the artboards carries
   `data-screen-label` — 96 of them in the light boards. Open the `.dc.html`
   from `file://` in the same Chromium the e2e suite uses and screenshot
   `[data-screen-label="…"]`. Note the labelled container holds a caption
   _plus_ the screen card; you want the card.
3. **The implementation side is a Playwright capture** at `MEASURE.panel`
   (390) and, after 115, at `desk` for the screens that have a wide layout.
   The demo specs already navigate most of these — reuse their fixtures
   rather than inventing states.

### The review

Give an **isolated reviewer** (a subagent, or `claude -p` — not this session)
both images plus the screen's `product.md` row and any `design-deltas`
decision naming it. Ask only about composition:

- wrong or missing component; a section present in one and not the other
- wrong information hierarchy or order
- wrong copy — the empty-state copy in `product.md` §Empty states is binding
- a state treatment that does not exist (empty, loading, error)
- something drawn that we deliberately did not build

Tell the reviewer explicitly that type, spacing, colour and radius are **out
of scope and enforced elsewhere**, or it will spend its whole budget there.

## Triage — the actual content of this lane

Every finding is one of three things, and **deciding which is the work**:

1. **The code is wrong** → fix it.
2. **The artboard is stale** → the code is right and the drawing is behind.
   Add a `design-deltas` item so nobody "fixes" the code to match it later.
   **D-55 is the worked example**: O3's artboard still draws a paste field
   that `TapListForm` correctly never built.
3. **A deliberate divergence** → record it at the site, in a comment, saying
   why and pointing at the decision. **The worked example is `TAB_BAR`**,
   which keeps `verdictPending` against a pack that now says `call`, because
   the pack's own note defers the swap to Epic 200.

**Do not resolve a finding by deciding it does not matter.** If it is not one
of the three, it is a question for the owner.

## Out of scope

- Values of any kind. If a finding is about a size, a colour or a spacing,
  the lint rule from 113 already owns it — drop the finding.
- Screens marked not-v1 in `product.md` (B1/B2, O2, O4, I, J, the Call epic).
- The Desk (110) and dark mode (111).
- Building a reusable audit tool. If a second pass is ever wanted, the cost of
  rebuilding this from the packet is lower than the cost of maintaining a
  framework nobody runs.

## Test expectations

- The capture helper is test infrastructure, not product code, and belongs
  under `e2e/support/` where the mutation ratchet does not reach.
- Anything you change to reconcile a screen is ordinary product code under
  `src/ui/**/*.tsx` or `src/modules/**/*.tsx` — mutation ratchet at 100%, and
  a composition change usually means a component test needs a new assertion,
  not a weakened one.
- Re-record the affected feature demos.

## Done criteria

- Every v1 screen reviewed, and every finding landed in exactly one of the
  three triage buckets — none left as "noted".
- `docs/design-deltas.md` carries an item for each stale artboard found.
- A short table in the PR body: screen, verdict, what changed. A reviewer
  should be able to see the shape of the drift without reading the diff.
- `npm run verify && npm test && npm run build` green.
- **Demo video: yes**, for any screen whose composition changed.
