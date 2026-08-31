# dialed.run — Parallel Agent Workflow (human operating manual)

This is your side of the loop. Agents read CLAUDE.md; you read this.
Supersedes `plan/docs/workflow.md` (review model changed per D-22; lanes
renumbered; stack changed per D-03).

## Prerequisites (once, before Phase 0)

1. In agentic-guardrails-scaffolding: tag a release (e.g. `v0.1.0`) and ensure
   a `prepare` script builds `dist/` on install, so dialed can depend on
   `github:ddteeter/agentic-guardrails-scaffolding#v0.1.0` (or commit dist).
2. Run the guardrails live-loop acceptance test once — the scope-lock has
   never been observed firing live. **The referenced
   `live-loop-verification.md` was missing from the imported archive** —
   recreate or locate it in the guardrails repo before betting on the loop.
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

## Launch-gate checklist (before public sign-ups)

1. Run task 106 (trust & safety floor) as a sequential lane on main.
2. Enable Cloudflare's CSAM scanning tool in the dashboard (free; zone
   setting, not code).
3. Confirm observability config: tracing OFF (billable), logs at full sample
   (`head_sampling_rate: 1` is fine at launch volume).
4. Send `docs/design-deltas.md` items 1–6 back through Claude Design if not
   already done — undesigned surfaces shipped on placeholder layouts should
   be reconciled before strangers see them.

Dogfooding with invited runners is fine before the gate; strangers are not.

## After v1

The call epic is next (see `docs/post-mvp.md`); its packets get written the
same way (design doc template, worktree lanes) once the validation study
(090) reports and v1 verdict data exists.
