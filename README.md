# dialed.run

> Every run has an outfit. Log it.

A virtual wardrobe for runners: log what you wore, on which run, in which
weather — then get told what to wear next time. Social by default, useful
alone.

No application code yet. The **unified plan is reconciled and live** — agents
build from the root docs:

| Where                                            | What                                                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`CLAUDE.md`](CLAUDE.md)                         | Engineering directives: stack, boundaries, resilience laws, workflow.                                                                                   |
| [`docs/product.md`](docs/product.md)             | Product spec: v1 scope, screen→lane map, brand application, lexicon.                                                                                    |
| [`docs/architecture.md`](docs/architecture.md)   | System context, module graph, pipelines, solo-ops posture, launch gate.                                                                                 |
| [`docs/contracts.md`](docs/contracts.md)         | Entity model, shared TS contracts, route/component conventions.                                                                                         |
| [`docs/workflow.md`](docs/workflow.md)           | Human operating manual: prerequisites, fan-out, review checkpoints.                                                                                     |
| [`docs/decisions.md`](docs/decisions.md)         | The design/plan reconciliation decision log (D-01…D-34).                                                                                                |
| [`docs/design-deltas.md`](docs/design-deltas.md) | Work order for Claude Design: revisions the reconciled plan needs.                                                                                      |
| [`docs/post-mvp.md`](docs/post-mvp.md)           | Deferred epics: the call, full social, gear gaps, offline, platform.                                                                                    |
| [`docs/tasks/`](docs/tasks/)                     | Task packets: 000 bootstrap (serial) · 090 validation study · 101–104 parallel lanes · 105 onboarding · 106 T&S launch gate · 107 product intelligence. |

**The stack**: TypeScript strict · TanStack Start (React SSR) on Cloudflare
Workers · D1 via Drizzle · R2 · Queues + Cron · Better Auth · zod at trust
boundaries · Vitest workers-pool + Playwright · guardrails enforcement loop.

**V1 in one line**: closet + log-a-run (5-state verdict) + reference feed
with a conditions-consensus block — every schema recommender-ready so "the
call" lands as the first post-MVP epic without migrations.

## Source archives (read-only — do not build from these)

| Folder                        | What it is                                                                                                                                                            | Origin                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| [`design/`](design/README.md) | Brand system and ~20 hi-fi screens. Revision 2 (2026-08-30) incorporates the first delta round and adds `V1 Screens`; open deltas tracked in `docs/design-deltas.md`. | Claude Design project "Runner Wardrobe App Brief" |
| [`plan/`](plan/README.md)     | The original technical plan (htmx-era). Superseded by root `CLAUDE.md` + `docs/`; kept for the record.                                                                | `dialed-plan.zip`                                 |

Reconciled 2026-08-30. Rationale for every divergence: [`docs/decisions.md`](docs/decisions.md).
