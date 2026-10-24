# Plan — CLAUDE.md: fix, enforce, split

**Status**: proposed, awaiting owner approval (2026-10-23). Items marked 🔒
touch a forbidden zone or a repo outside this one and are the owner's to
approve or land; everything else is in an agent's reach.

## Why

`CLAUDE.md` is 905 lines / ~8,400 words — roughly 11k tokens loaded into every
agent on every turn, whatever the agent is doing. Three problems:

1. **Parts of it are wrong.** It says guardrails is pinned at v0.7.0
   (`package.json`: 0.11.0), that fallow runs in `mild` mode
   (`.fallowrc.jsonc:59`: `semantic`), that stryker has nine scopes (25), that a
   `fallow-ignore` reason goes on the line above (all 35 in `src/` put it
   inline after `--`), and that destructive schema changes stop pre-launch
   (owner, 2026-10-23: they are fine until first deploy).
2. **Most of it is history, not rules.** How a rule was learned — R-50, R-40/42,
   "an hour was spent proving this", the analyzer-rung cost discussion — is
   valuable, but its home is `docs/decisions.md` and the design docs, which
   already hold most of it.
3. **Rules a machine could check are written as prose.** A prose rule costs
   tokens on every turn forever and still fails silently when missed.

## The placement rule

Every paragraph in the current file gets exactly one destination:

| if the rule is…                                                          | it goes                                                           |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| mechanically checkable                                                   | **a check** (test, lint, script) whose failure message links the doc; prose shrinks to ≤1 line or disappears |
| about one area of the tree (db, routes, ui, modules, tests)              | **`.claude/rules/<area>.md`** with `paths:` globs — loads when an agent reads/writes/edits a matching file |
| about one kind of task (PR prep, schema change, new server function, mutants) | **a skill** in `.claude/skills/` — loads when the task matches its description |
| silent, cross-cutting, and not checkable                                 | **root `CLAUDE.md`** — one or two lines, plus a link              |
| history / rationale                                                      | **`docs/decisions.md` or the design doc it came from** — root keeps only the link |

Load mechanics (verified against Claude Code docs, 2026-10-23,
code.claude.com/docs/en/memory.md):

- `.claude/rules/*.md` with `paths:` frontmatter loads when Read, Write or Edit
  touches a matching file. Preferred over nested `CLAUDE.md` files: globs can
  target `src/db/schema*.ts` precisely, one rule can cover several directories,
  and the rules live together where a reviewer can see them all.
- `@path` imports load **eagerly** with their parent — they save nothing. Not
  used.
- Hooks can inject `additionalContext` on `PreToolUse`/`PostToolUse`, keyed on
  `tool_input.file_path`. Not needed while path-scoped rules cover the same
  ground; kept as the fallback if Step D5 shows a gap.
- **Unverified**: whether a custom subagent (`guardrail-fixer`, lane agents)
  picks up path-scoped rules. The docs are silent. Step D5 measures it before
  anything depends on it.

## Phase A — fix what is wrong (one small docs commit)

| step | change | done when |
| --- | --- | --- |
| A1 | Schema table: Destructive row becomes "pre-first-deploy (D-139): proceed, say so in the PR; after: stop and ask". Delete "pre-launch does not make them safer". | Matches owner's 2026-10-23 answer. |
| A2 | Guardrails version: drop the pinned number entirely ("pinned in `package.json`"). | No version literal in CLAUDE.md. |
| A3 | Fallow: replace the mild/semantic paragraph with the current fact — semantic mode, `fallow-ignore` is for rhymes, reason inline after `--`. | Paragraph ≤5 lines, matches `.fallowrc.jsonc`. |
| A4 | Stryker: delete the hand-listed scopes and the "six of nine" count; point at `stryker.conf.json`. | No scope list or count in CLAUDE.md. |
| A5 | Theme: delete the counts ("seven TYPE steps…eighteen roles"); keep "the `@theme inline` block is the index, read it". | No counts restating `styles.css`. |

Test: `rg -n "0\.7\.0|mild|nine entries|eighteen|seven TYPE" CLAUDE.md` is empty.

## Phase B — checks an agent can land

Each is a test in `test/architecture/` (same style as `palette-only.test.ts`,
using `source-text.ts`) or a `package.json` script. Each failure message names
the rule file and section that explains it. Baselines were measured on
`0da68217`.

| step | check | baseline today | done when |
| --- | --- | --- | --- |
| B1 | **`routeTree.gen.ts` keeps its Start registration**: assert it contains `declare module '@tanstack/react-start'`. Replaces the "two generators disagree" paragraph. | passes | test green; mutating the file by hand (delete the block) turns it red. |
| B2 | **Migrations must be named**: `db:generate:core`/`:weather` become a `node -e` wrapper that exits non-zero without `--name=`. (Inline in `package.json` for the knip/eslint reasons CLAUDE.md already gives for `mutate`.) | 82 migrations, all hand-named | `npm run db:generate:core` with no name fails with a message pointing at the naming rule. |
| B3 | **Motion values come from tokens**: no `cubic-bezier(` or bare `<n>ms` in code outside `src/ui/motion.*` (comments stripped via `withoutComments`). | passes — all 8 hits are in comments | test green; a planted `transition: 200ms` fails. |
| B4 | **No `disabled` attribute on a button** in `src/**/*.tsx` (JSX attribute, not `aria-disabled`, not the `disabled:` variant). | passes | test green; a planted `<button disabled>` fails. |
| B5 | **A `<form>` imports the form primitives**: any `.tsx` rendering `<form` imports from `ui/form`. | **4 files fail**: `ui/Page.tsx`, `ui/Turnstile.tsx`, `auth/components/ShellForm.tsx`, `safety/components/DeskForm.tsx` | each of the 4 triaged first — either it is the primitive's own frame (named exemption list in the test, with a reason per entry, like the Google button in `palette-only`) or it is converted. **If any is a real hand-rolled form, that conversion is its own PR, not this one.** |
| B6 | **`fallow-ignore` carries a reason**: every `fallow-ignore-next-line` is followed by ` -- ` and ≥20 chars. | passes (35/35) | test green; a bare directive fails. |
| B7 | **Un-awaited drizzle builder**: verify whether `no-floating-promises` (in `strictTypeChecked`) already flags a bare `db.insert(t).values(v);` statement. | unknown | If yes: CLAUDE.md paragraph shrinks to the case lint can't see (a builder held in a variable and never batched). If no: becomes 🔒 L5. |
| B8 | **Failure messages link docs**: every existing `test/architecture/*.test.ts` failure message names the rule file/section that explains it. | most explain inline, none link the new rule files | each test's `expect(…, message)` or thrown error carries a path. Done after Phase D creates the files. |

Considered and dropped: an emoji ban. `✕` and `♡` are designed glyphs in
`ReportSheet`, `ReportAffordance` and `UsefulButton`, so a Unicode-range test
would need an exemption list as long as the problem it solves.

## Phase C — locked items (🔒 owner approves or lands)

| id | item | where | what it replaces |
| --- | --- | --- | --- |
| L1 | **Unknown Tailwind classes** — `eslint-plugin-better-tailwindcss` `no-unknown-classes`, already measured in `docs/proposals/082-tailwind-unknown-class-lint.md`. | `eslint.config.js`, `package.json` | The single largest silent failure CLAUDE.md warns about; the paragraph shrinks to one line. **Highest value item in this plan.** |
| L2 | **Arbitrary-value utilities** — the selectors in `docs/proposals/113-arbitrary-value-lint.md`. (`palette-only` and `measures` tests cover colours and widths; this covers the rest.) | `eslint.config.js` | Part of the "`@theme` block is your whole protection" paragraph. |
| L3 | **`sanctions-check` in pre-push.** Today only CI runs it (`guardrails.yml:81`); a copied `Stryker disable` passes every local gate and fails CI an hour later. | `.githooks/pre-push` | The "sanctions-check is CI-only" trap. |
| L4 | **Gate messages link docs** — the guardrails stop/commit/push gates print a doc pointer per violation kind (configurable map in `guardrails.config.json`). | upstream `agentic-guardrails-scaffolding` + `guardrails.config.json` | Same as B8, for the gates this repo doesn't own. |
| L5 | (only if B7 says no) a `no-restricted-syntax` selector for an expression statement whose callee chain starts at `db.insert/update/delete`. | `eslint.config.js` | The lazy-builder footgun paragraph. |
| L6 | **`.claude/rules/` directory exists at all.** Not on the forbidden list, but it is harness config beside `settings.json`'s guardrails hooks, so it is yours to OK. | `.claude/rules/` | Enables Phase D. |

## Phase D — the split

### D1. Target layout

```
CLAUDE.md                       ~200–300 lines: what/stack/layout, forbidden zones,
                                "stop means ask", silent cross-cutting traps (1–2
                                lines each), the index of everything below
.claude/rules/
  schema.md       paths: src/db/**, drizzle-*.config.ts
                  schema protocol table, naming, numbering (law 11 → 1 line,
                  test enforces), table-rebuild trap, expand→contract (law 8)
  routes.md       paths: src/routes/**, src/routeTree.gen.ts
                  glue-only + its 3 JSX patterns, client-bundle safety
                  (construct on first use, sibling decisions file),
                  typed routing, regeneration
  ui.md           paths: src/ui/**, src/**/components/**, src/styles.css
                  @theme index, contracts-outrank-artboards, placeholder
                  protocol, icons, motion doctrine, forms primitives
  server.md       paths: src/modules/**/*.ts, src/lib/sql/**, src/env/**
                  D1 discipline (filter in SQL, batch-by-default, lazy
                  builders), trust boundaries, idempotency keys (8b),
                  cross-system (8c), queue wire format (law 9), resilience
                  laws 1–7, verification class, one-gate-per-concern
  testing.md      paths: test/**, **/*.test.ts, **/*.test.tsx, vitest.config.ts,
                  stryker.conf.json
                  three vitest projects + dom-setup, stryker mechanics
                  (--mutate per entry, file-list form, the two
                  vitest.config lines), disable-directive placement traps
.claude/skills/
  crushing-mutants/   exists — absorbs the equivalent-mutant + grant flow
  pr-demo-video/      exists
  pr-ready/           NEW: pr-self-review.md, design-deltas heading, deferred.md
                      rule (4a), "review comments are change requests",
                      final verify/test/build, demo-video trigger
  schema-change/      NEW: generate with --name, number past main + open PRs,
                      read the rebuild, PR wording for destructive pre-deploy
  server-function/    NEW: inputs.ts, verification-class row, requireUserId vs
                      verifiedUserId, idempotencyKey for creates, don't wrap
                      createServerFn, component takes it as a prop
```

### D2. What stays in root, verbatim intent

- Product summary, stack list, `src/` layout block, module import rules.
- Forbidden zones, the lane-ownership rule, `design/`+`plan/` are read-only.
- "Stop means ask; flagging is not asking" — **once** (today it is twice).
- Derive, don't mirror — short form with the two worked examples as links.
- Product rules that are also code rules (verdicts, weather, Strava, sharing,
  retire-don't-delete, lexicon) — these apply everywhere and are not
  checkable. Sharing paragraph tightened; full text moves to
  `docs/contracts.md` if it is not already there.
- One line per silent cross-cutting trap, each linking its rule file: unknown
  Tailwind class (until L1), client-bundle leak, lazy drizzle builder,
  `stryker run` bare vs `npm run mutate`.
- Never add `eslint-disable` / `@ts-ignore` / casts / `.skip`; don't argue with
  the stop gate; fix the code not the rule.
- Workflow 1–8, compressed; item 7 becomes one line pointing at the global
  CLAUDE.md's waiting section instead of restating it.
- The index: one line per rule file and skill, saying when it loads.

### D3. Eliminated outright (history → linked, not copied)

| paragraph | its home |
| --- | --- |
| R-50 bundle saga, the −89 kB measurement, "neither is visible to tsc…" | `client-bundle.test.ts` header + `docs/decisions.md` |
| R-40/R-42 "debt is paid", the 43.98% start | `docs/decisions.md` |
| Analyzer `push` rung cost reasoning, 5/15-min numbers | `guardrails.config.json` comment (already there) |
| Bare `stryker run` comma history, `.stryker-tmp` eslint OOM | `testing.md` keeps the rule in one line each; story to `docs/guardrails/` |
| "An hour was spent proving this" (createServerFn wrapper) | `server-function` skill keeps the rule; story deleted |
| 2026-10-09 wait-cost numbers (workflow 7) | global CLAUDE.md + `docs/proposals/2026-10-12-agent-wait-cost.md` |
| Second "Twice in the PR #2–#5 review…" | deleted (kept once, in `schema.md`) |
| Mild-vs-semantic measurement table | `.fallowrc.jsonc` (already there) |

Before deleting any paragraph, grep its destination; if the history isn't
there yet, move it — nothing is lost, only relocated.

### D4. Steps

| step | builds | test | done when |
| --- | --- | --- | --- |
| D4.1 | the 5 rule files, content moved (not rewritten) from CLAUDE.md | every moved paragraph appears in exactly one destination — a script diffs old CLAUDE.md sentences against the union of new files and lists any orphan | orphan list empty, or each orphan is in D3's eliminated list |
| D4.2 | the 3 new skills | each skill's description triggers: a fresh agent given "add a nullable column to garments" loads `schema-change` | trigger observed in transcript |
| D4.3 | the slimmed root + index | `wc -w CLAUDE.md` | ≤ 3,000 words (from 8,434) |
| D4.4 | B8: architecture-test messages point at rule files | `rg -L "\.claude/rules/" test/architecture/*.test.ts` | every test file links one |

### D5. Validate before merging

Spawn fresh agents — one main-session-style, one custom subagent
(`guardrail-fixer`) — each with a small task in one area (db, routes, ui,
server). For each, check the transcript: did the right rule file load? Did it
load **before** the first Edit?

- If custom subagents do not load path-scoped rules: add a `SessionStart`/
  `PreToolUse` hook that injects the matching rule file as `additionalContext`
  (🔒, `.claude/settings.json`), or list the rule files in the fixer agents'
  own prompts.
- If a rule loads only after the first Edit for a newly created file: that
  rule's one-line trap stays in root.

## Sequencing

1. **PR 1** — Phase A + B1–B4, B6, B7 (docs fix + tests that pass today). Small,
   low-risk, independent of approval on anything locked.
2. **PR 2** — B5 triage (and, if needed, its exemption list).
3. **PR 3** — L6 approval, then Phase D + B8 + D5 validation. Land when no lanes
   are mid-flight: every worktree reads `CLAUDE.md`, and a lane that started
   on the old file will rebase into a moved paragraph.
4. **Owner** — L1, L2, L3 (independent; L1 first). L4 upstream. L5 only if B7
   says it's needed. Each one landed lets its root paragraph drop to a line.

## Measures

- Root `CLAUDE.md`: 8,434 → ≤3,000 words.
- After PR 3, watch for two weeks: gate failures on rules that moved out of
  root. A rise for one rule means it goes back in root or gets a check.

## Risks

- **A path-scoped rule loads too late** (after the edit it should have
  prevented). Mitigation: D5 measures it; silent traps keep a root line.
- **Skills don't trigger.** Mitigation: skills hold task checklists, never
  traps; the stop/push gates still catch what they miss.
- **Moving text rots links.** `docs/` and the architecture tests reference
  "CLAUDE.md §X" in places; D4.1 greps for `CLAUDE.md` references and updates
  them in the same PR.
