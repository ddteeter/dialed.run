# Design deltas: one file per entry

New design-deltas entries go here, one file each, instead of being
appended to `docs/design-deltas.md` (#875). Every lane appending to one
shared file made each merge conflict the next PR, and a rebase that only
resolves a conflict pays the whole push gate and CI again.

`docs/design-deltas.md` is the archive through wave 14 (wave 15's two sections are the first files here). It keeps its
preamble (the contracts outrank the artboards) and every section it
holds. A test pins it, so nothing is appended there any more
(`test/architecture/design-deltas-frozen.node.test.ts`).

## What goes in a file

The same sections the archive has, under the same headings:

| entry                                            | file                                                    | written by                     | heading                                               |
| ------------------------------------------------ | ------------------------------------------------------- | ------------------------------ | ----------------------------------------------------- |
| a lane's "Built from …" or "Built for …" section | `<design number>-<slug>.md`, e.g. `241-styling-tail.md` | the lane, in its own PR        | `## Built for the styling tail (wave 15, design 241)` |
| a Design round's rulings                         | `round-<N>.md`, e.g. `round-61.md`                      | the coordinator, at the import | `## Answered in round 61 (imported 2026-11-20)`       |

A lane's design number is its design doc's (`docs/designs/<number>-…`),
so two lanes never pick the same name. A lane with two such sections
puts both in its one file.

Open Design asks are not entries: they are GitHub issues in status
**Needs Design** (`docs/agents/issue-tracker.md`).

## Reading them

- `npm run docs:deltas` prints every entry here as one document, in file
  order, each under a comment naming its file.
- To find a ruling, grep the archive and this folder together:
  `grep -rn "<term>" docs/design-deltas.md docs/design-deltas/`.
