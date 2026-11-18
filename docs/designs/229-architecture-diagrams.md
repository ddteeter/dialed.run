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
  (Moved into `npm run diagrams:check` after step 2; see the follow-up
  below.)
- `diagram-sources.test.ts`: every step has a source comment; every path
  exists and contains the symbol it names. (Built as
  `diagram-sources.node.test.ts`, in the `node` project; see step 3 as
  built.)
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

## Step 2 follow-up: the generator fails on what it cannot read

The comparison test regenerates with the generator's own blind spots, so
a construct the generator skipped was skipped in both copies and nothing
failed. Found after #807 (owner, 2026-11-16): a new kind of binding, an
import through the `#/` or `@/` alias, a dynamic or bare import, or code
in a new folder beside `src/modules` would each have been left out
silently. Crons and queues were already safe:
`test/bindings-conformance.test.ts` holds `wrangler.jsonc` equal to the
registries.

- **Each way in is a closed list** in `scripts/diagrams/structure.ts`:
  the keys of `wrangler.jsonc`, the handlers and exports of its `main`,
  and the top-level entries of `src`. Each entry is drawn or carries the
  reason it is not; anything else throws.
- **Every module file is placed.** A file under `src/modules` in no
  module throws (dependency-cruiser does not require an `index.ts`), and
  so does a `createServerFn(` outside a `functions.ts`, because the
  wiring arrows are read from that file name.
- **Imports are read by dependency-cruiser, not by pattern** (owner,
  2026-11-16). The first version read imports with regexes over
  comment-stripped text, which leaned on the formatter's layout and could
  be thrown by a regex literal or an apostrophe in JSX. dependency-cruiser
  already enforces the module boundaries at the commit gate; its `cruise()`
  API follows every form (static, re-export, bare, dynamic, type-only)
  and the tsconfig aliases, so the diagram and the gate agree on what an
  import is. The rest (main's handlers and exports, `createServerFn`, an
  `import(…)` of a computed path) is read from TypeScript's syntax tree.
  An unresolved local import throws. Run over today's tree, it drew the
  same 65 arrows as the regex version.
- **The stale check moved from `npm test` to `npm run diagrams:check`.**
  Both libraries need the filesystem, which the workers pool lacks.
  `scripts/diagram-structure.ts --check` regenerates in memory and fails
  on a difference; `diagrams:check` is already in CI's required job, and
  `pr-ready`'s final checks now run it. `generateStructure` stays pure and
  is tested in the worker project on facts; `scripts/diagrams/syntax.ts`
  is tested in Node (the `ui` project at first; the `node` project since
  step 3).
- **Email sending is drawn** (owner, 2026-11-16): the `send_email`
  binding generates `cf.emailSending`, an `external`, with
  `cf.app.email`'s arrow to it in `model.c4`. A system we call and do not
  run, though it is bound.

## Step 3 as built (#802)

- **The comment has a form, so it can be checked.** `// source: <path>
<name>, <name> (<note>); <path> …` on the line directly above the step.
  The names are checked and the note is not, so a name that must keep
  resolving goes before the note. A cite needs at least one name: a bare
  path anchors nothing. The two flows' comments were rewritten to it.
  Names that sat inside notes (`(didClaimImport)`) became names. Two cites
  gave a file name with no path (`import-polling.ts`,
  `run-conditions-copy.ts`), and nine cited a path with no name. Each
  now resolves.
- **The steps come from LikeC4's parse tree, not from reading `.c4`
  text** (owner, 2026-11-16). A first version found them line by line with
  regexes and brace counting, and held its count to LikeC4's in
  `diagrams:check`; it was replaced before it merged.
  `scripts/diagrams/model.ts` walks LikeC4's own tree for every step
  statement (frames and `a -> b -> c` chains included) and its line, and
  `anchors.ts` reads only the comment on the line above. LikeC4 has no
  public API for the tree: it is the `langium` member, read as `unknown`
  and parsed node by node, so an upgrade that moves it fails by name. Each
  view's arrows from the tree are held equal to LikeC4's computed view,
  so a step form the walk does not know fails too.
- **The anchor test is in a new `node` vitest project**
  (`test/architecture/diagram-sources.node.test.ts`; owner, 2026-11-16).
  LikeC4 cannot load in the workers pool. The first version borrowed `ui`
  for its Node runtime under a `.dom.test.tsx` name, with happy-dom and
  `test/dom-setup.ts` it did not use; `node` is plain Node with no setup,
  and the #812 syntax test moved there too. It stays in `npm test`.
  It reads the cited files from disk, so a cite may name any file in the
  repo.
- **A name resolves when its file holds it as a whole word**; a dotted
  `wrangler.jsonc` key needs each part. That is a text check, not
  "defines it": a name left only in a comment would pass. It catches what
  the step exists to catch, a move or a rename.
- **`npm run diagrams:stale` reports and never fails.** It diffs against
  the merge base with `origin/main`, untracked and uncommitted files
  included, and marks a story whose own file the branch edited. The git
  half is a shell script (`scripts/diagram-stale.sh`), as
  `worktrees-prune.sh` is: the lint config forbids spawning git from
  TypeScript. `pr-ready` runs it, and the PR body answers it under a
  **Diagrams** heading.

## Step 4 as built (#803)

- **The models are read through LikeC4's API, not `export json`.**
  `LikeC4.fromWorkspace` on the merge base (`git archive` into a scratch
  folder) and on head; the computed model's per-view hash is the one
  `export json` writes (checked view by view). Only the site goes through
  the CLI: `likec4 build --output-single-file`, played from a `file:`
  URL with no server. The git half is `scripts/diagram-record.sh`, as for
  `diagrams:stale`.
- **A changed view is a changed hash or changed notes.** LikeC4's hash
  covers what a view draws, labels and element descriptions included,
  but not a step's notes: with likec4 1.61.0, a note edited alone left
  the view's hash as it was. The notes are where a story states its
  guards, so the steps (source, target, kind, label, notes) are compared
  as well.
- **A step is matched by what it says, not by its number.** An inserted
  step marks only itself changed; an edited one counts as new, so the
  opening caption says "N of M steps new or changed", and "K fewer" when
  the story got shorter. A changed step is held for a beat and 150 ms a
  word of its label and note, at most 8 s; an unchanged one for 1 s; a
  story's whole view for 3 s before its walkthrough, and a map of
  structure for 5 s. Removed views are printed for the PR body, since
  head cannot show them.
- **A framed view plays in the sequence layout**, the only one that draws
  frames: one whose computed `flow` holds anything but a bare step, or
  that declares `variant sequence`.
- **Captions, no voice** (superseded: the video is narrated since #851,
  below). The strip is the PR demo's
  (`e2e/support/caption.ts`); `muxArgs` now takes a scene with no spoken
  line. The frame is the demo's desk size, 1280×720.
- **Beside the demo, not joined.** `ship --attach` is already repeatable,
  so a PR with both carries two files, and a docs-only PR carries only
  the diagrams. Joining would need matching frames and a concat step for
  no gain to the reviewer.
- **The output is `diagrams.demo.mp4` at the repo root**: gitignored by
  `*.demo.mp4`, and out of reach of a Playwright run, which empties
  `test-results/`. A run deletes the previous file first, so a stale video
  is never attached.
- **The recorder checks one thing on the page:** after the last step,
  `Next` is disabled, so the viewer and the plan agree on the step count.
  Everything shown comes from LikeC4 itself, so there is nothing else to
  assert.
- Tests: `test/scripts/diagram-record.test.ts` (the plan, worker project)
  and `viewFactsIn` in `test/scripts/diagram-model.node.test.ts`.

## Step 5 as built (#804)

- **The readers get what LikeC4 computes, not `.c4` text.**
  `npm run diagrams:audit -- brief <flow>` is the deriving reader's whole
  brief: each story's title, first step and that step's source comment
  (recovery views left out), and every element's id, kind and title. No
  step past a first, no note and no element's description, because a
  description is a claim too (`technology 'off the queue: after 3 failed
retries'`). `-- story <flow>` is the comparing reader's copy: every
  arrow of every view in the file, numbered per view, with its frames,
  notes, source comment (its note included) and the view it opens; the
  words each view gives its elements, `include … with` overrides applied;
  and the other flows' stories, where this one's scope ends. The arrows are
  LikeC4's computed edges, joined to the parse tree's statements in source
  order; a chain `a -> b -> c` gives both arrows the statement's comment. A
  frame type or an arrow the join does not know throws.
- **The deriving reader reads a copy of the code, not the repo.** The
  auditor `git archive`s `src`, `test`, `wrangler.jsonc` and
  `package.json` at the audited SHA into a scratch folder, so a search
  cannot turn up the story's source comments, and both readers read one
  commit. The story is written to the folder only after the deriving reader
  is done.
- **"Due" is counted from PR bodies and record issues.**
  `npm run diagrams:audit -- due` reads the merged PRs whose bodies hold a
  Diagrams section and the issues titled `Diagram audit: <flow file>
(<date>)` (both through `gh`, in `scripts/diagram-audit.sh`, as
  `diagrams:stale` does git). A flow is due when it has no record, or when
  three merged PRs since its newest record name one of its views, as a
  whole word, on a re-read line under **Diagrams** (a heading at any depth,
  or a bold line). One PR counts once per flow. It prints each due flow's
  record title, and any record title it cannot read. `diagrams:stale` and
  `pr-ready` now give the line's form.
- **Every audit files a record, even with nothing found**, so `due` has a
  date to count from. The differences are sub-issues of it, and the record
  closes once they are filed: it is history, and the differences are the
  work. **A view's story differences are one issue**, a checklist, and
  each code bug is its own (owner, 2026-11-17): the trial found thirty in
  one flow, which one lane fixes together.
- **The trial** (`flows/import.c4` at `856198f7`, record #840): the
  deriving reader found 40 steps against the story's 26 arrows; 8 arrows
  agreed. 27 story differences went into #844–#846, and three code bugs in
  the import consumer into #841–#843. The comparing reader counted one
  difference as the deriving reader's own miss.
- **Two readers, then the auditor.** The deriving reader reads code only
  (`derive.md`); the comparing reader walks the derived account first,
  then the story, and rules on each difference against the code
  (`compare.md`). The auditor re-runs a thin derivation once, opens every
  cited line, skips what is already filed, and shows the owner the public
  differences first. A security-bearing code bug goes to the private home
  and the private Project (never-list item 3); a difference about auth
  internals is asked about.
- **The docs pass runs it** (skill `coordinating-a-wave`, §3). An audit
  changes nothing in the repo; its issues are the next wave's work.
- **Reviewed by Fable before shipping**, as planned: 28 findings, all but
  one applied (the re-read trigger is checked only at a docs pass, not on
  every PR; at the waves' pace that is when it would be acted on).
- Tests: `test/scripts/diagram-audit.test.ts` (worker: frames, the join,
  both texts, the re-read parse, due) and `auditViewsIn`, `elementsIn` and
  `readAudit` over the real model in
  `test/scripts/diagram-model.node.test.ts`.

## Step 6 as built (#805)

- **GitHub Pages from a workflow, not a branch** (owner's grant,
  2026-11-17). `.github/workflows/diagrams-pages.yml` runs on a push to
  `main` that touches `docs/diagrams/`, `package-lock.json` (a likec4 bump
  changes the site) or the workflow itself, and by hand. A `gh-pages`
  branch would commit rendered output and need `contents: write` and a
  third-party action; Cloudflare would need a secret; a job in `ci.yml`
  could not have its own path filter. Not a required check: a failed
  publish leaves the last site up.
- **Two jobs, so the publishing token never meets package code.** `build`
  runs `npm ci` and `npm run diagrams:site` with `contents: read` and
  uploads the Pages artifact; `deploy` holds `pages: write` and
  `id-token: write` and runs only `actions/deploy-pages`. The three new
  GitHub-owned actions are pinned through `actions.lock` (`gh
actions-lock`). actionlint and zizmor pass. No `cache: npm`: the run is
  short and a publishing workflow is where cache poisoning matters.
- **Hash routes.** Pages serves no fallback page, so a path route
  (`/view/importStory`) would 404 on reload; `--use-hash-history` gives
  `#/view/<id>/`, which `docs/architecture.md` links. The base path is the
  repo name. The web component bundle is left out (nothing embeds it).
- **LikeC4's `robots.txt` disallows indexing**, left as it is: the page is
  shown to people by link.
- **Nothing drawn was held back.** The model shows the `auth` module as a
  box, its import arrows, Google as its OAuth provider and Turnstile as
  the bot check; nothing of how sign-in, sessions or the gates work. The
  site shows only what the public `.c4` files already say.
- **Pages is switched on in the repo's settings** (source: GitHub
  Actions; the owner's change), which creates the `github-pages`
  environment, deployable from `main` only. The first publish is a manual
  run after merge.

## #851 as built: the diagram video is narrated

Supersedes step 4's "Captions, no voice". The owner wants these videos
narrated the way PR demos are (2026-11-17), and the near-copy step 4 made
of the demo's mux removed in the same change.

- **What is spoken (owner, 2026-11-18): a changed step's label and its
  whole note.** A note can be all that changed (the hash misses it), so a
  label alone would speak the old words over a new note. The note's `**`
  and backticks are dropped and its paragraphs run together; the label
  becomes a sentence. The opening says "New view:" or "Changed:", the
  view's title, and the step count or the change summary the caption
  shows. An unchanged step is silent, a 1 s beat. Offered and declined:
  the label only (17 s of speech for a new `importStory`, against 101 s),
  and the label plus the note's bold lead-ins (38 s). A PR that edits a
  step or two adds 10 to 25 s.
- **Each shot holds until its line is said:** the longer of step 4's
  planned hold and the line plus its tail. Every line is rendered before
  filming (`spokenLines`, then `voicedPlan`), so a first rendering never
  stalls the take, and the printed length is the voiced one. Review pace,
  the demo's 280 wpm.
- **One copy of the voice and the strip.** `e2e/support/speech.ts`
  renders and caches a line (`speaker`, with `say`, `afinfo`, `security`
  and the network passed in as `SpeechTools`), moved out of the demo
  fixture `demo.ts`, which kept `voiced`, `hosted` and `keyFor` private.
  `e2e/support/caption-strip.ts` renders the caption PNGs for both muxes
  (the font's data URL and the caption loop), and `ffmpegPath` in
  `caption.ts` is the one ffmpeg lookup. `Cue.audio` is optional and
  `Scene` is derived from `Cue`, so the recorder has no `Cue` of its own,
  and its frame is the demo's `DESK` (`e2e/support/bars.ts`).
  `scripts/diagrams/record.ts` uses the speaker's `SpokenLine` type.
- **The narration's shared code joined the mutation ratchet** (owner,
  2026-11-18): one entry for `caption.ts`, `caption-strip.ts`,
  `speech.ts`, `voice.ts` and `scripts/diagrams/record.ts`. Before this,
  e2e/ and scripts/ were under no positive glob, so the push gate
  mutated none of them. Tests: `test/e2e-support/speech.node.test.ts` and
  `caption-strip.node.test.ts` (the `node` project: they write files),
  `ffmpegPath` in `caption.test.ts`, and `stepLine`, `spokenLines` and
  `voicedPlan` in `test/scripts/diagram-record.test.ts`. The glue
  (`demo.ts`, `demo-mux.ts`, `scripts/diagram-record.ts`) stays outside it.
- `playwright.config.ts` still writes the demo's 1280×720 out three times
  rather than reading `DESK`; this change left it alone.

## Open questions

1. **Auth and trust boundaries are not drawn** while the security audit's
   findings are open (`.claude/rules/publishing.md`). Proceeding on that.
2. **Frames are marked experimental** in LikeC4's docs. Proceeding with
   the version pinned exactly, and upgrades checked by re-rendering.
