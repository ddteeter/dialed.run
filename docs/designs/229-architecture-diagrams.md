# Design: 229 architecture diagrams as a maintained model

## Problem

The system's map is four hand-written Mermaid blocks in
`docs/architecture.md`. Nothing checks them against the code, they cannot
be walked step by step, and they do not show what makes a flow safe to
repeat or how it recovers. This replaces them with one LikeC4 model in
`docs/diagrams/` that agents maintain, that a reader drills into and plays
as a story, and whose structure cannot drift from what is bound.

## Approach

**The model** (`docs/diagrams/`, LikeC4, MIT, a dev dependency). `spec.c4`
holds the kinds; an element's kind is its timing boundary (`inRequest`,
`offQueue`, `onCron`) and an arrow's kind is the hop (`async`, `recovery`).
Each flow is a file in `flows/` with a story (the working path, a guard
note on every step that writes or crosses a boundary) and a recovery view
(try/catch, loop and opt frames). Skill `architecture-diagrams` holds the
conventions and the validate, render, look loop.

Five steps, each its own PR:

1. **Foundation.** The dependency and `npm run diagrams` /
   `diagrams:check` (validate, format); spec, model and the import flow;
   the skill; `.claude/rules/diagrams.md` (loads on `docs/diagrams/**`), a
   row in CLAUDE.md's table, and workflow item 5 pointed at the model.
2. **Structure is generated, so it cannot drift.** A pure function builds
   `structure.generated.c4` (databases, buckets, queues, crons, modules and
   the imports between them) from `wrangler.jsonc`, `ops/crons.ts`,
   `ops/queues.ts` and the module sources. A test regenerates and
   compares. Hand-written files only extend generated elements, so a story
   naming something removed fails `validate`. The four Mermaid blocks in
   `architecture.md` are deleted in this PR, each replaced by the name of
   the view that now shows it.
3. **Stories are anchored and flagged.** Every step carries a
   `// source: <path> <symbol>` comment, and a test fails when one does
   not resolve. `npm run diagrams:stale` lists the stories that cite a
   file the branch changed; `pr-ready` runs it, and the PR body says each
   was updated or re-read.
4. **PR videos.** `npm run diagrams:record` exports the model at the merge
   base and at head, records the views whose hash changed (Playwright
   against `likec4 build`, the walkthrough stepped by the recorder, not by
   an agent-written spec) and writes one mp4 for `ship --attach`. `pr-ready`
   asks for it when `docs/diagrams/` changed.
5. **Skill `diagram-audit`.** Wording cannot be tested, so it is audited:
   one reader per flow re-derives the flow from the code without reading
   the story, a second compares the two, and each difference becomes an
   issue. Run in a wave's docs pass and whenever `diagrams:stale` was
   answered "re-read" more than a few times for one flow.

The remaining flows (enrichment, feed reads, exports, public photos) are
then written by Opus agents under the skill, one PR each.

**Opus trial** (2026-11-15). An Opus agent, given only the draft skill and
the import flow, drew enrichment (`flows/enrichment.c4`): three views, 32
steps, valid on the first write, two render passes, about six minutes.
Every number in its notes matches the constant it cites (checked by hand,
with two of its behaviour claims; the remaining steps are unreviewed). It
reported nine places the skill did not fit, now answered in the skill, and
two things this design takes on: a cron element must be named for its
firing, not for one job it runs (step 2), and it found
`architecture.md`'s enrichment prose imprecise on what marks a product
failed, which is the kind of finding step 5 exists for.

**On GitHub.** The interactive viewer cannot render in GitHub Markdown.
`likec4 export markdown` does emit Mermaid, but as a flowchart that loses
step order, notes, frames and the sequence layout, and a committed copy
would be a second truth that parallel lanes conflict on. So nothing
generated is committed: reviewers get the PR video, and readers get a
hosted build (open question 1).

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Human-managed files: one CI step running `diagrams:check` (and the
  publish job, if approved) in `.github/workflows/`. **Owner's change.**
- New dev dependency: `likec4` (pulls its own Vite and React; nothing the
  app ships imports it).

## Test plan

All vitest, `worker` project, in `test/architecture/` (the pool has no
filesystem, so sources arrive as `?raw` imports, as
`bindings-conformance.test.ts` does):

- `diagram-structure.test.ts`: the generated file equals the generator's
  output for today's `wrangler.jsonc`, registries and module imports.
- `diagram-sources.test.ts`: every step has a source comment; every path
  exists and contains the symbol it names.
- Unit tests for the generator, the view-hash diff and the stale-story
  mapping, which are pure functions.
- `likec4 validate` cannot run in the pool; it runs in `diagrams:check`.

## Issues

- Closes: none.
- Opens: one build item per step above, once this doc is approved.

## Open questions

1. **Hosting.** Publish `likec4 build` to GitHub Pages from main, so
   `architecture.md` can link to live views? It is the owner's workflow to
   add. Proceeding without it: the views open with `npm run diagrams`.
2. **Mermaid elsewhere.** This removes it from `architecture.md` only.
   Design docs keep the template's optional sketch: a proposal drawn once
   and never maintained is not a second truth. Veto if it should go too.
3. **Auth and trust boundaries are not drawn** while the security audit's
   findings are open (`.claude/rules/publishing.md`). Proceeding on that.
4. **Frames are marked experimental** in LikeC4's docs. Proceeding with
   the version pinned exactly, and upgrades checked by re-rendering.
