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

Six steps, each its own PR:

1. **Foundation.** The dependency and `npm run diagrams` /
   `diagrams:check` (validate, format); spec, model and the import flow;
   the skill; `.claude/rules/diagrams.md` (loads on `docs/diagrams/**`), a
   row in CLAUDE.md's table, and workflow item 5 pointed at the model.
2. **Structure is generated, so it cannot drift.** A pure function builds
   `structure.generated.c4` (databases, buckets, queues, crons, modules and
   the imports between them) from `wrangler.jsonc`, `ops/crons.ts`,
   `ops/queues.ts` and the module sources. A test regenerates and
   compares. Hand-written files only extend generated elements, so a story
   naming something removed fails `validate`. A folder with its own
   `index.ts` is drawn as a sub-module, so #796's breakdown appears with
   no generator change. The four Mermaid blocks in
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

6. **A public page.** After step 2, a workflow builds the model on pushes
   to main that touch `docs/diagrams/` and publishes it to GitHub Pages:
   diagrams only, no secret, not a required check. `architecture.md` links
   its views there.

The remaining flows are written by Opus agents under the skill, one PR
each. Those inside the four modules #796 breaks down wait for it (#797);
the rest can follow step 1.

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
generated is committed: reviewers get the PR video, and readers get the
public page (step 6).

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Human-managed files, in `.github/workflows/`: one CI step running
  `diagrams:check`, and step 6's publish workflow. Pages is also switched
  on in the repo's settings. **Owner's changes**; each PR brings the
  workflow as a proposal.
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
- Opens: #799 (the parent), with #800 to #805 for steps 1 to 6 and #797
  for the held flows. Related: #796 (the module breakdown).

## Owner's calls (2026-11-15)

- **Hosting:** GitHub Pages, diagrams only, so the model can be shown to
  people from a public page. The design boards are not published there.
- **Mermaid** leaves `architecture.md` only. Design docs keep the
  template's optional sketch: a proposal drawn once is not a second truth.
- **Order:** build this now; a module move changes source paths and
  parents, not a story's steps, and the anchor test forces that update.

## Step 2 as built (#801)

- **Descriptions come from `docs/diagrams/structure.words.json`.** LikeC4's
  `extend` takes child elements, tags and metadata but not a description,
  so a hand-written file cannot describe a generated element. The
  generator merges the words file in and throws on an id it does not
  generate.
- **Queues are read from `wrangler.jsonc`, not `ops/queues.ts`.** That
  file imports `env`, which a script cannot load, and
  `test/bindings-conformance.test.ts` already holds the two equal. Cron
  names come from `ops/crons.ts`.
- **No arrow between a module and its own sub-module.** LikeC4 refuses a
  parent-to-child relationship; the nesting says it.
- **Two kinds of import arrow, and a view a module.** The whole graph has
  63 arrows and puts 12 of the 13 modules in one cycle. 18 of them exist
  only because a module's wiring (its `functions.ts` and components)
  imports the other module. Those are `-[wiring]->`, and `modules` is the
  map of the other 45; `<module>Imports` shows both for one module
  (owner, 2026-11-15).
- **Arrows carry no names.** A label listing the imported names would
  change with every new import, and parallel lanes would conflict on the
  generated file for no change in structure. The file changes when a pair
  of modules starts or stops importing, or a binding, cron or module
  does.
- **Three of the four Mermaid blocks left `architecture.md`** (owner,
  2026-11-15). The resilience flowchart stays until the flows it draws
  (the outbox, the Gave up table, the export queue, the digest) are
  stories, which wait for #797.
- **Edge caching and the public-photo zone cache are prose**, not
  elements: no kind fits a cache in front of the Worker, and a kind is not
  added for one picture.

## Open questions

1. **Auth and trust boundaries are not drawn** while the security audit's
   findings are open (`.claude/rules/publishing.md`). Proceeding on that.
2. **Frames are marked experimental** in LikeC4's docs. Proceeding with
   the version pinned exactly, and upgrades checked by re-rendering.
