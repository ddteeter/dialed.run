# dialed.run — Parallel Agent Workflow (human operating manual)

This is your side of the loop. Agents read CLAUDE.md; you read this.
Supersedes `plan/docs/workflow.md` (review model changed per D-22; lanes
renumbered; stack changed per D-03).

## Prerequisites (once, before Phase 0)

1. ✅ Done 2026-09-05: guardrails v0.1.0 is tagged with a working `prepare`
   build — dialed depends on
   `github:ddteeter/agentic-guardrails-scaffolding#v0.1.0`. The CLI bin is
   `agentic-guardrails`; adoption goes through the repo's adoption.md/init
   flow.
2. Run the guardrails live-loop acceptance test
   (`docs/live-loop-verification.md` in the guardrails repo — it exists at
   v0.1.0; the dialed archive merely referenced it) — folded into Phase 0's
   done criteria, which prove the loop on this repo.
3. Accounts/keys: Visual Crossing API key, Strava API app (callback URL can
   be workers.dev initially), Google OAuth client, extraction-model API key — OpenAI presumptive, per D-32 (107's
   extraction rung; the eval may change the vendor), Sentry project (free tier), UptimeRobot (or
   similar) pinging `/health`, Turnstile site key. Store all secrets as
   Wrangler secrets, never in files.

## Steady-state ops (the whole job, by design)

- **Alerting is exception-based**: Sentry emails on new exceptions; the daily
  digest cron emails only when an anomaly threshold trips; UptimeRobot pings
  `/health`. A quiet inbox is the healthy state.
- **Recovery**: bad deploy → `wrangler rollback`. Bad data → D1 Time Travel
  point-in-time restore (30-day window). Photos → originals in R2 are the
  source of truth; derived sizes regenerate.
- **The rule that keeps this true**: any incident that required manual poking
  gets a follow-up micro-task making that failure self-healing or
  self-reporting. Ops debt is paid immediately or it compounds.

## Phase 0 (serial, you're present)

Single session, you pair. Point Claude Code at `docs/tasks/000` and stay
engaged — every decision made here is one agents inherit. Budget an evening
or two. Done criteria include deliberately breaking a branch to watch the
Stop gate + fixer fire on dialed itself.

## Fan-out

```bash
git worktree add ../dialed-101 -b lane/101-closet
git worktree add ../dialed-102 -b lane/102-runs
git worktree add ../dialed-103 -b lane/103-weather
git worktree add ../dialed-104 -b lane/104-feed
# each worktree: npm install, then open Claude Code in it
# lanes 105 (onboarding) and 107 (product intelligence) start after 101 merges:
git worktree add ../dialed-105 -b lane/105-onboarding
git worktree add ../dialed-107 -b lane/107-product-intel
```

Session-start prompt (paste into each Claude Code instance):

> Read CLAUDE.md, then docs/tasks/<ID>. Follow the workflow in CLAUDE.md:
> write the design doc first using docs/design-doc-template.md and commit it,
> then proceed to implementation. I review design docs asynchronously — if I
> comment on yours, reconcile before continuing. Schema changes and new
> bindings always stop for my approval.

Suggested rollout order if you'd rather stagger than run four at once:
103 (simplest, proves the loop) → 101 + 102 together → 104 (touches the most
seams) → 105 + 107 after 101 merges.

Task 090 (validation study) is independent of everything — run it whenever,
ideally early; its output feeds the call epic, not v1.

## Adoption lanes (sequential on main, after the v1 lanes)

Four contracts landed after the v1 lanes were written, and none of them was
adopted by the lanes that shipped under them. They are **sequential, on
main, one at a time** — not a fan-out. Every one rewrites `src/ui/` and most
of `src/modules/*/components/`, and unlike the schema there is no protocol
for component contention: four worktrees here would conflict on nearly every
file.

| #   | lane                                     | why it sits here                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **113** design system port **+ §AG/§AH** | Everything downstream takes its numbers from `tokens.js` and T1. Writing raw px before this means rewriting it after. Round 10/11's two v1 slices — composition on garment detail, colour collection on F — fold in here (owner, 2026-09-18) because §AH edits `GarmentForm` and `garmentBase`, which Part A already rewrites. **Part A lands first and completely; then Part B.** |
| 2   | **114** motion adoption                  | Travel distances are spacing steps.                                                                                                                                                                                                                                                                                                                                                |
| 3   | **112** accessibility                    | The focus outline, 44px targets and 8px gaps are token values — and its reduced-motion requirement is vacuous until 114 gives it something that moves.                                                                                                                                                                                                                             |
| 4   | **115** desktop                          | Consumes all three: `BREAKPOINT`/`MEASURE` from 113, the tab-switch treatment from 114, focus order from 112. Also the only one that crosses every lane's routes, so it runs alone.                                                                                                                                                                                                |
| 5   | **116** composition reconciliation       | The other half of "does the UI match the design". 112–115 make every _value_ enforceable; nothing checks _composition_ — and rounds 6–8 changed it on already-built screens while the repo could not see the drawings. Last, because 113–115 move every screen and 115 adds a second composition at width.                                                                         |

**The split they inherit.** `CLAUDE.md` §Design truth divides the bundle:
contracts are truth for values, artboards are truth for composition. Lanes
113–115 make the values enforceable once, by lint rule and pin test, so no
human ever reviews a font size again. **116 is the composition half**, and it
is review rather than enforcement because no rule can check whether a screen
contains the right things in the right order.

**Why they are lanes at all.** `docs/design-deltas.md` carried motion
adoption as something lanes would pick up _"opportunistically, audited at the
launch gate"_. Six lanes shipped and none did: of the doctrine's 12 surfaces,
one is implemented. The same would have happened to the token contract —
93 arbitrary values and 17 `Mono` bypasses accumulated the same way. A
cross-cutting contract with no packet does not get adopted.

Tasks 110 (The Desk) and 111 (dark theme) are separate and unscheduled;
neither blocks this sequence.

## Your review checkpoints (per D-22)

1. **Design docs, batched async** (~10 min/lane, phone-friendly by
   construction). Agents do NOT wait for you — read soon after each lands;
   a comment is an interrupt the agent must reconcile. Check: contract
   touches say "none" or are justified; test plan names real tests; open
   questions are answered (agents guess less when you answer fast).
   **Exception — hard stops that do wait**: schema changes, new
   bindings/queues/crons.
2. **PR review** (the hard gate). The gates have already enforced
   lint/types/dead code/boundaries/tests — spend your attention on: product
   correctness against docs/product.md, the EXPLAIN output (lane 104), auth
   scoping tests present, brand/lexicon adherence, and anything the agent
   flagged in its end-of-task summary.

Between those checkpoints: don't watch. That's what the gates are for.

## Merge discipline

- Lanes rebase on main at least daily (`git fetch && git rebase origin/main`);
  tell the agent to do it and resolve conflicts as part of its work.
- Merge order on simultaneous readiness: 103 → 101 → 102 → 104 → 105 → 107.
- Per-lane route directories (`src/routes/<lane>/`) and untouchable
  `db/schema*.ts` structurally remove the two classic conflict sources.

## Schema-change protocol (the serialized resource)

When a lane's design doc requests a schema change:

1. You approve/adjust the proposal.
2. Run it as a micro-task **on main** (you or a short dedicated session):
   edit schema → `drizzle-kit generate` → migrate → merge.
3. Affected lanes rebase. Never let a lane branch carry a migration.

## When the loop misbehaves

- Gate escalates repeatedly on one lane → read the recurrence state; it
  usually means the packet under-specified something. Fix the packet, not
  the agent.
- Agent asks a question mid-lane → answer in chat AND fold the answer into
  the packet or CLAUDE.md so the next session doesn't re-ask.
- Two lanes need the same new shared utility → it goes in `lib/` (or `ui/`)
  via a micro-task on main, not copy-paste in both lanes.

## Launch: development, then deployment

The launch gate is no longer a list in this file. The production-readiness
audit (`docs/reconciliation/2026-09-25-production-readiness-audit.md`)
replaced it with two plans, and the owner separated them (decision D-37):

1. **`docs/launch/development-plan.md`**: everything that is code, in five
   parallel lanes (tasks 125–129; shared rules in
   `docs/tasks/125-129-launch-development.md`). All of it lands first.
2. **`docs/launch/deployment-plan.md`**: everything that is a dashboard, an
   account, a legal registration or a config edit, run as its own sweep
   afterwards. Its §11 holds the **rollout gates**: the owner alone, then
   invited friends, then the public (decision D-38).

Keep the launch list in those two files only. A third copy here would drift
from them, which is what this section used to do.

Fan-out for the five lanes:

```bash
git worktree add ../dialed-125 -b lane/125-ops-platform
git worktree add ../dialed-127 -b lane/127-strava-logging
git worktree add ../dialed-128 -b lane/128-content-safety
# after PR #104 merges:
git worktree add ../dialed-126 -b lane/126-accounts
# after PR #102 merges:
git worktree add ../dialed-129 -b lane/129-feed
```

Where the old checklist's items went:

| old item                                            | now                                                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1. Run task 106                                     | Done; the audit found its ban mechanics unfinished, which is 128 · SAF-4                              |
| 2. Enable the CSAM scanning tool                    | Deployment plan §8. It only sees public photos once 128 · SAF-7 serves them cacheable (decision D-46) |
| 3. Observability config (tracing off, logs sampled) | Deployment plan §1                                                                                    |
| 4. Design-deltas round trip before strangers        | The development plan's design dependencies, and the D-45 copy pass as a stage-2 gate                  |
| 5. Motion Doctrine sweep                            | Closed by task 114 (design-deltas item 12)                                                            |
| 6. Publish a privacy policy (D-105)                 | 126 · ACC-13 (page and links); deployment plan §9 (the text; PR #109 drafted it)                      |

## After v1

The call epic is next (see `docs/post-mvp.md`); its packets get written the
same way (design doc template, worktree lanes) once the validation study
(090) reports and v1 verdict data exists.
