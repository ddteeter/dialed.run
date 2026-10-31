# Roadmap

The one place that lists what we intend to build, at any horizon. Each
entry points to where its detail lives rather than restating it: a plan, a
proposal, an epic, a register row. When the detail moves, the pointer
moves. When the work merges, the entry is struck through with the PR that
finished it.

## Where the rest lives

| what                                  | where                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------- |
| Launch: what is built before users    | `docs/launch/development-plan.md`, `docs/launch/before-public-plan.md` |
| Launch: dashboards, accounts, config  | `docs/launch/deployment-plan.md`                                       |
| Launch: legal                         | `docs/launch/legal-readiness-plan.md`                                  |
| Known defects and postponed decisions | `docs/deferred.md` (the register; it is not a backlog of ideas)        |
| Product epics after the MVP           | `docs/post-mvp.md`                                                     |
| Undrawn surfaces waiting on design    | `docs/design-deltas.md`, the open queue                                |

## Soon: development infrastructure

Not launch requirements, and not product epics. Any time; sooner is better,
because each one makes the rest of the work easier to keep straight.

### 1. Product links, end to end

A runner attaches a product link to a garment, sees what enrichment did with
it, and sees it shown safely wherever a garment or kit appears. The denylist
is enforced in one shared read, not per surface.

- **Why now:** round 22 (AC2b) took the link field off F, because F2a/F2b
  were never drawn. Since then nothing writes `product_url`. `/kit` (PR
  #277) renders links through its own private denylist read, and that
  copy has to become the shared one.
- **Pieces:** design F2a/F2b first, then the field on F, the link on E and
  `/kit`, safety's batched denylist check, and O3 if design rules it in
  (R-55).
- **Status:** a branch has started (`feat/163-product-links`). Its design
  number becomes 164 if #277 (design 163) lands first.

### 2. An architecture map generated from the code (C4)

An interactive, zoomable map (context, then containers, then modules) that
agents keep current without hand-editing.

- **Why:** the module graph in `docs/architecture.md` is a hand-drawn copy
  of what dependency-cruiser already knows ("derive, don't mirror"). With
  13 modules and counting, hand updates will not keep up.
- **Shape:**
  - The module level is generated from dependency-cruiser, with a check
    that fails when the committed map and the code disagree.
  - The context and container levels (the Worker, both D1s, the R2
    buckets, queues, crons, external services) are hand-kept and pinned by
    a test against `wrangler.jsonc`, as `test/bindings-conformance.test.ts`
    pins the bindings.
  - Dynamic views cover the flows that cross many modules: retraction,
    import, enrichment.
  - A rule file (`.claude/rules/architecture.md`) tells agents which layer
    is generated and which is hand-kept. It replaces CLAUDE.md's "update
    the diagram" line.
- **Viewer:** LikeC4 (model as code) builds a static site that a workflow
  can publish. The repo is public, so a GitHub Pages site would be public
  too. If that is unwanted, use Cloudflare Pages behind Access instead.
  Neither tool has been tried here yet.
- **Owner-gated:** any workflow lives in `.github/workflows`, a forbidden
  zone.

### 3. Module layering, enforced

dependency-cruiser keeps modules encapsulated: no one deep-imports another
module's internals, and a new module is covered by pattern the day it
exists. It does not say which modules may depend on which.

- **Baseline (measured 2026-10-31, type-only imports included):** 58
  module-to-module edges out of 156 possible. `feed` reaches 10 of the
  other 12. The two-way pairs are:
  - `account` with `auth`, `feed` and `safety`
  - `feed` with `runs` and `onboarding`
  - `ops` with `runs`, `safety` and `onboarding`

  `no-circular` checks files, so cycles between modules pass.

- **Blind spot:** a module that reads another module's table through
  `db/` is invisible to dependency-cruiser (example: `/kit`'s denylist
  read of `safety`'s `domain_denylist`).
- **Shape:**
  - Write down the intended layers (foundations such as `auth`, `email`
    and `ops` low, features above them, nothing pointing up).
  - Add an allowed-edges rule, with today's violations as a baseline that
    may only shrink.
  - Untangle the two-way pairs over time.
  - Generate item 2's module view from the same graph.
- **Owner-gated:** `.dependency-cruiser.cjs` is a forbidden zone.

Items 2 and 3 are one proposal: the layering, the rule and the map read the
same graph.
