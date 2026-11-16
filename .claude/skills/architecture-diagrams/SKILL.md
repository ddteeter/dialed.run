---
name: architecture-diagrams
description: Use when adding or changing dialed.run's architecture diagrams in `docs/diagrams/` — a new flow's story, a flow whose steps, guards or timing changed, or a new queue, cron, bucket, database or entry point. Covers the LikeC4 model's layout, the kinds that carry timing boundaries, how a step states its idempotency guard and its recovery path, the validate-render-look loop, and what not to draw.
---

# Architecture diagrams

The diagrams are one LikeC4 model in `docs/diagrams/`. A reader walks a
flow step by step, and each step says what makes it safe to repeat and
what picks the work up if it is lost. `flows/import.c4` is the worked
example: read it before writing a flow.

| file                     | holds                                                                        |
| ------------------------ | ---------------------------------------------------------------------------- |
| `spec.c4`                | the kinds: what an element or an arrow can be                                |
| `structure.generated.c4` | what is bound and what imports what. Generated, never edited                 |
| `structure.words.json`   | the descriptions of generated elements, by id                                |
| `model.c4`               | the people, the systems we call, each module's entry points, a flow's arrows |
| `overview.c4`            | the views of structure                                                       |
| `flows/<flow>.c4`        | one flow's views: its story, its recovery view, sub-stories                  |

## What is generated

`structure.generated.c4` is written by `npm run diagrams:generate` from
`wrangler.jsonc`, the cron registry and the imports under `src/modules`,
and `test/architecture/diagram-structure.test.ts` fails when it is stale.
It holds:

- every D1 database, R2 bucket, Analytics Engine dataset and queue
  (`cf.coreDb`, `cf.importsBucket`, `cf.importsQueue`, `cf.importsDlq`),
  with each queue's arrow to its dead-letter queue, and each email
  sender (`cf.emailSending`, an `external`: bound, but not ours to run);
- every cron, named for its firing (`cf.app.cronHourly30`), because one
  firing runs several jobs. The step's label says which job;
- every module and sub-module (`cf.app.runs`, `cf.app.runs.parsers`: a
  folder with its own `index.ts`), and an arrow for each pair where one
  imports from the other: `-[imports]->` when its service code does,
  `-[wiring]->` when only its `functions.ts` and components do. The arrows
  carry no names, so the file changes when a pair appears or goes, not
  with every import. Each module has a view of its imports
  (`runsImports`), and `modules` in `overview.c4` is the map of the
  `imports` arrows alone.

You never write these by hand, and never write an `-[imports]->` or
`-[wiring]->` arrow.
Read the file for the ids. When a binding, a cron, a module or a
cross-module import changes, run `npm run diagrams:generate` and commit
the result. If that removes or renames an element a flow names,
`diagrams:check` fails on the flow: that is the flow telling you it needs
re-reading.

A generated element's description is a line in `structure.words.json`
(LikeC4's `extend` cannot set one). An id there that is not generated
fails the generator.

**The generator throws on what it cannot read.** The comparison test
regenerates with the generator's own blind spots, so anything it skipped
would be skipped in both copies. So each way in is a closed list in
`scripts/diagrams/structure.ts`: the keys of `wrangler.jsonc`, the
handlers and exports of its `main` (`src/server.ts`), and the top-level
entries of `src`. It also throws on a file under `src/modules` in no
module (a folder needs its own `index.ts`), a `createServerFn(` outside a
`functions.ts`, and a dynamic import it cannot resolve. When one of these
fails, draw the new thing, or add it to the list with the reason it is not
drawn. Never widen a check to make it pass.

Imports are read in every form: `import … from`, `export … from`, a bare
`import "./x"`, `import("./x")`, and the `#/` and `@/` aliases (read
from `tsconfig.json`'s `paths`).

**An entry point goes inside the module that owns it**, in `model.c4`:

```
extend cf.app.runs {
  upload = inRequest 'startImport' { … }
}
```

and is named `cf.app.runs.upload` everywhere after.

## Read the code before you draw

A story is a claim about the code, and nothing checks its wording. Read
the flow end to end first: the server function in the module's
`functions.ts` and what it calls, the queue consumer, `src/modules/ops/queues.ts`
and `crons.ts` for what is bound, `src/modules/ops/scheduled.ts` for what a
cron re-drives, and `wrangler.jsonc` for retries and dead-letter queues.

- Put a `// source: <path> <symbol>` comment above every step, naming
  where you read it. A step you cannot source does not go in.
- Never write a number (a grace window, a retry count, a timeout) you did
  not read in the code. Say where it is in the source comment.
- Leave out how sign-in, sessions and the auth gates work inside. The repo
  is public, and a detailed drawing of a trust boundary is not yours to
  publish (`.claude/rules/publishing.md`).

## The kinds

An element's kind says **when its code runs**, which is the timing
boundary. Its `technology` line says it in words.

| kind                          | colour | means                                                  | `technology` reads like                              |
| ----------------------------- | ------ | ------------------------------------------------------ | ---------------------------------------------------- |
| `inRequest`                   | green  | runs in the request; one attempt, someone waits        | `in the request: one attempt, the runner is waiting` |
| `offQueue`                    | blue   | a queue consumer; later, at least once                 | `off the queue: seconds later, at least once`        |
| `onCron`                      | amber  | a cron firing; re-drives what is still owed. Generated | its expression and registry name                     |
| `module`                      | blue   | code called by an entry point, no boundary of its own  | (none)                                               |
| `database`, `bucket`, `queue` | slate  | a D1 database, an R2 bucket, a queue. Generated        | (none)                                               |
| `external`                    | muted  | a system we call and do not run                        | (none)                                               |

An entry point is one element per way in: the server function or the
consumer. A cron's entry point is its generated firing. Two entry points in one module are two
elements, because they run at different times. Two server functions that
run the same path (a create and an update) are one element named for both.

A call into another module is a step on the caller's own element, or a
step to that module's generated element (`cf.app.weather`) when the flow
turns on what it does. Add a `module` element by hand only for one
function inside a module that a flow has to name
(`cf.app.enrichment.request`).

**Elements are shared between flows, so describe them for all of them.**
A database's description says what it holds, never what one flow uses it
for. When a view needs the flow's own words, override them in that view:
`include cf.core with { description 'The products row is the durable marker' }`.

An arrow's kind says what the hop is:

| arrow           | looks        | use for                                                            |
| --------------- | ------------ | ------------------------------------------------------------------ |
| `->`            | grey dashed  | a call the sender waits on                                         |
| `-[async]->`    | amber dotted | a hop across a timing boundary: an enqueue, a delivery             |
| `-[recovery]->` | red solid    | a path that exists to repair: a re-drive, a dead-letter, a give-up |
| `-[imports]->`  | grey solid   | generated only: a module's service code imports from another       |
| `-[wiring]->`   | grey dotted  | generated only: just its server functions and components do        |

Do not add a kind, a colour or a tag for one flow. If a flow seems to need
one, say so in your report and use the nearest existing kind.

## A flow's views

**`<flow>Story`**, a `dynamic view`: the path when everything works, one
step per thing that happens, in order. Labels start with a verb and name
the thing: `inserts the import row: pending`. Ten steps is about right;
past fourteen, move a part into a sub-story and link it with `navigateTo`.

Every step that writes, sends or crosses a boundary carries `notes`. A
note opens with one of these, in bold, and says the mechanism in a
sentence:

- `**Guard: <name>.**` what makes a repeat harmless (a key, a claim, a
  UNIQUE index, a duplicate check).
- `**Not atomic with <the next or previous step>.**` when two systems are
  written in a row and nothing spans them.
- `**If it fails:**` or `**If it is lost:**` what happens then, and what
  the user sees.
- `**Timing boundary: <what changes>.**` on the step where the request
  ends, a consumer starts, or a wait is imposed.
- `**Degrade, don't fail.**` when a secondary step's failure leaves the
  primary action done.
- `**Bounded.**` the limits on a call out: its timeout, its size cap, its
  redirect count.

A failure that splits (one error is terminal, another is retried) goes
under `**If it fails:**`, one sentence each.

A story may hold one frame, `opt '<when>' { … }`, for a branch the working
path sometimes takes (a fallback, a retry that settles the same step).

**`<flow>Recovery`**, a second `dynamic view`: what happens when a step is
lost. It uses frames, and each has one meaning here:

- `try { … } catch '<what went wrong>' { … }`: a hand-off that can be lost,
  and the thing that re-drives it.
- `loop '<how many times>' { … }`: redelivery by the queue.
- `opt '<when>' { … }`: a path taken only in that state: the dead-letter
  queue, a scheduled re-drive of failed work, a give-up, a person's retry.
  Order them from the first thing that happens to the last resort.

Link the story's risky steps to it with `navigateTo <flow>Recovery`. A
flow with no asynchronous hop needs no recovery view. A recovery view has
no step budget; if its sequence render stops being readable, split it by
failure.

**The overview is not yours to grow.** `overview.c4` names what it
includes. A new queue, bucket or database arrives by generation and joins
`platform` on its own; a new external system joins `index`. Render both
and look after either.

## The loop

`likec4` is a dev dependency, pinned exactly. Run the `npx likec4`
commands from `docs/diagrams/`; the npm scripts run from the repo root.

1. `npm run diagrams:check`: it validates with no warnings and checks the
   formatting. `npm run diagrams:format` fixes the formatting (it escapes
   `'` inside `'''` notes as `\'`; the rendered note is unchanged).
2. `npx likec4 export png -o <scratchpad>/png .` and, for the recovery view,
   again with `--seq`. Open the PNGs and read them: a label that wraps
   badly, a step in the wrong order and an arrow of the wrong kind only
   show here.
3. Fix and repeat. Never commit the PNGs or a `dist/` folder.

Lay nothing out by hand. If a view is tangled, it has too many elements:
split it.

## Report

End with: the files you changed; each view's step count; every place the
code surprised you or the conventions above did not fit; and anything you
left out and why.
