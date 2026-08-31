# dialed.run — technical plan

Imported from `~/Downloads/dialed-plan.zip`, 2026-08-30. Produced by an agent
focused on the technical/architectural plan. **Not yet reconciled with
[`../design/`](../design/README.md)** — that merge is the next step.

## Layout

The archive contained a flattened copy *and* a nested `dialed-handoff.zip`
holding the same 11 files (byte-identical) with their intended structure.
The structured version is what's preserved here, because the docs
cross-reference `docs/...` paths that only resolve in this layout.

Read paths inside these documents as rooted at `plan/`.

```
plan/
├── proposed-CLAUDE.md        engineering directives (renamed — see caveat below)
└── docs/
    ├── architecture.md       system context, module graph, resilience, launch gate
    ├── contracts.md          entity model, shared TS contracts, route/fragment conventions
    ├── workflow.md           parallel-agent operating manual, review checkpoints
    ├── design-doc-template.md
    └── tasks/
        ├── 000-phase0-bootstrap.md   SERIAL — human pairs, everything depends on it
        ├── 101-wardrobe.md           parallel lane
        ├── 102-import-pipeline.md    parallel lane
        ├── 103-weather.md            parallel lane
        ├── 104-feed-social.md        parallel lane
        └── 105-trust-safety-floor.md LAUNCH GATE — sequential, after 101 + 104
```

## The proposed stack

Marked "fixed — do not substitute" in `proposed-CLAUDE.md`:

TypeScript strict · Cloudflare Workers · Hono with JSX SSR · **htmx + View
Transitions, explicitly no SPA framework** · D1 via Drizzle · R2 for photos ·
Queues and Cron Triggers · Better Auth · zod at trust boundaries · Vitest with
`@cloudflare/vitest-pool-workers`, Playwright in CI.

Architecture rules are machine-enforced via dependency-cruiser.

## Caveats found on import

- **`proposed-CLAUDE.md` arrived as `CLAUDE.md` and was renamed on import.**
  Claude Code auto-loads files named exactly `CLAUDE.md`, so under its
  original name it would have taken effect as live instructions for any work
  under `plan/` — despite being an unreviewed imported artifact carrying hard
  directives ("Stack (fixed — do not substitute)", "Forbidden zones"). The
  rename keeps it inert.

  It is written to become the *repository root* `CLAUDE.md`. Promote it with
  `git mv plan/proposed-CLAUDE.md CLAUDE.md` once the stack is agreed and the
  design/plan merge has settled — at the root, its internal `docs/...`
  references resolve as the author intended. The other imported docs still
  refer to it as "CLAUDE.md"; that is correct for the promoted state and was
  deliberately left unedited.
- **One referenced file is absent from the archive:**
  `docs/live-loop-verification.md`, cited by `docs/workflow.md:11`.

## For the design/plan merge

Points where the two documents will need a decision, noted but not resolved:

- **Rendering model.** The plan mandates htmx + SSR with no SPA framework;
  the design specifies app-like mobile flows with sheets, multi-select, and a
  dial-settling animation on the call. Reconcilable, but it constrains how
  several screens are built.
- **Wardrobe organization.** The plan's entity model organizes apparel *by
  body part*; `design/Product Screens.dc.html` explicitly rejects a body-part
  wizard, filtering the closet by run conditions instead.
- **Coverage.** The plan's lanes (101–105) don't obviously cover onboarding
  O1–O6, the recommendation engine itself, or gear gaps (J) — which is where
  the design concentrates most of its product risk.
