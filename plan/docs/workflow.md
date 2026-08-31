# Dialed — Parallel Agent Workflow (human operating manual)

This is your side of the loop. Agents read CLAUDE.md; you read this.

## Prerequisites (once, before Phase 0)

1. In agentic-guardrails-scaffolding: tag a release (e.g. `v0.1.0`) and ensure
   a `prepare` script builds `dist/` on install, so Dialed can depend on
   `github:ddteeter/agentic-guardrails-scaffolding#v0.1.0` (or commit dist).
2. Run the guardrails live-loop acceptance test
   (`docs/live-loop-verification.md`) once — carry-in #2 says the scope-lock
   has never been observed firing live. Prove it before betting on it.
3. Accounts/keys: Visual Crossing API key, Strava API app (callback URL can
   be workers.dev initially), Google OAuth client, Sentry project (free
   tier), UptimeRobot (or similar) pinging `/health`, Turnstile site key.
   Store all secrets as Wrangler secrets, never in files.

## Steady-state ops (the whole job, by design)

- **Alerting is exception-based**: Sentry emails on new exceptions; the daily
  digest cron emails only when an anomaly threshold trips; UptimeRobot pings
  `/health`. A quiet inbox is the healthy state — there is nothing to check
  proactively.
- **Recovery**: bad deploy → `wrangler rollback`. Bad data → D1 Time Travel
  point-in-time restore (30-day window, zero setup). Photos → originals in
  R2 are the source of truth; derived sizes regenerate.
- **The rule that keeps this true**: any incident that required manual poking
  gets a follow-up micro-task making that failure self-healing or
  self-reporting. Ops debt is paid immediately or it compounds.

## Phase 0 (serial, you're present)

Single session, you pair. Point Claude Code at `docs/tasks/000` and stay
engaged — every decision made here is one agents inherit. Budget an evening
or two. Done criteria include deliberately breaking a branch to watch the
Stop gate + fixer fire on Dialed itself.

## Fan-out (lanes 101–104)

```bash
git worktree add ../dialed-101 -b lane/101-wardrobe
git worktree add ../dialed-102 -b lane/102-import
git worktree add ../dialed-103 -b lane/103-weather
git worktree add ../dialed-104 -b lane/104-feed
# each worktree: npm install, then open Claude Code in it
```

Session-start prompt (paste into each Claude Code instance):

> Read CLAUDE.md, then docs/tasks/<ID>. Follow the workflow in CLAUDE.md:
> write the design doc first using docs/design-doc-template.md, commit it,
> and stop for my review. Do not begin implementation until I say
> "design approved".

Suggested rollout order if you'd rather stagger than run all four at once:
103 (simplest, proves the loop) → 101 + 102 together → 104 (touches the most
seams; benefits from 101/102 conventions existing).

## Your review checkpoints (the only two)

1. **Design doc** (~10 min/lane, phone-friendly by construction). Check:
   contract touches say "none" or are justified; test plan names real tests;
   open questions answered before approval.
2. **PR review**. The gates have already enforced lint/types/dead
   code/boundaries/tests — spend your attention on: product correctness,
   the EXPLAIN output (lane 104), auth scoping tests present, and anything
   the agent flagged in its end-of-task summary.

Between those checkpoints: don't watch. That's what the gates are for.

## Merge discipline

- Lanes rebase on main at least daily (`git fetch && git rebase origin/main`);
  tell the agent to do it and resolve conflicts as part of its work.
- Merge order on simultaneous readiness: 103 → 101 → 102 → 104.
- `src/routes/manifest/<lane>.ts` per-lane files mean manifest merges are
  append-only; `db/schema.ts` never changes in a lane branch, so the two
  classic conflict sources are structurally removed.

## Schema-change protocol (the serialized resource)

When a lane's design doc requests a schema change:

1. You approve/adjust the proposal.
2. Run it as a micro-task **on main** (you or a short dedicated session):
   edit schema.ts → `drizzle-kit generate` → migrate → merge.
3. Affected lanes rebase. Never let a lane branch carry a migration.

## When the loop misbehaves

- Gate escalates repeatedly on one lane → read the recurrence state; it
  usually means the packet under-specified something. Fix the packet, not
  the agent.
- Agent asks a question mid-lane → answer in chat AND fold the answer into
  the packet or CLAUDE.md so the next session doesn't re-ask.
- Two lanes need the same new shared utility → it goes in `lib/` via a
  micro-task on main (like schema), not copy-paste in both lanes.

## After MVP lanes land

**Before opening public sign-ups** (launch-gate checklist):
1. Run Task 105 (trust & safety floor) as a sequential lane on main.
2. Enable Cloudflare's CSAM scanning tool in the dashboard (free; zone
   setting, not code).
3. Confirm observability config: tracing OFF (billable from Oct 2026), logs
   at full sample (`head_sampling_rate: 1` is fine at launch volume; it's
   the dial to turn if the 20M/month bundle ever gets close).

Dogfooding with invited runners is fine before the gate; strangers are not.

Next packets to write (same template): 106 Pick-My-Outfit, 107 affiliate
engine, 108 Polar/Fitbit adapters. The contracts already carry their seams
(`forecast()`, `RunSource`).
